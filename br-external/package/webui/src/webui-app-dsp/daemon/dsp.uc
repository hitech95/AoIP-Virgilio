/*
 * dsp -- BE module for webui-app-dsp: generic/basic DSP configuration
 * (settings, protected-pipeline editing, mixers, runtime pipeline map).
 * The FE apps webui-app-dsp (configuration/profiles) and webui-app-dsp-live
 * depend on this module (they call dsp.* over RPC; nothing else does).
 *
 * Protected-pipeline editing (plan/webui.md §9): filters/mix on the uci
 * subchain model. Three validation layers:
 *   1. here (allow list, max_steps, locked subchains)
 *   2. genconf dry-run (transactional: restore on failure)
 *   3. camilladsp manifest enforcement (patch 0003) at SIGHUP
 */

import * as uci from "uci";
import { readfile, writefile, unlink, popen, mkdir } from "fs";
import { shq, ERR_INVALID_ARGUMENT, ERR_NOT_FOUND, ERR_PERMISSION_DENIED } from "util";
import { uci_sections } from "ucix";

const GENCONF = "/usr/bin/camilladsp-genconf";
const CDSP_CONFIG = "/etc/config/camilladsp";
/* Root-owned dir only: a fixed name under /tmp would be symlink-able by
 * any local user (genconf writes through it as root -> file clobber). */
const CDSP_CHECK = "/run/webui/camilladsp.yml.check";

/* slot model: { <step name>: { policy, channels, allow, max_steps,
 *   step: section id, names: [current user filters] } } -- the editable
 * (child/free) pipeline_step sections (named-section uci schema) */

/* pipeline order: the 'list step' entries of `config pipeline`
 * (anonymous section), in order */
function pipeline_order() {
	for (let st in uci_sections("camilladsp", "pipeline")) {
		if (type(st.step) == "array") return st.step;
		if (st.step != null) return [ st.step ];
	}
	return [];
}

/* pipeline_step sections by section name */
function pipeline_steps() {
	let out = {};
	for (let st in uci_sections("camilladsp", "pipeline_step"))
		out[st[".name"]] = st;
	return out;
}

function filters_slots() {
	let slots = {};
	for (let st in uci_sections("camilladsp", "pipeline_step")) {
		if (st.policy != "child" && st.policy != "free")
			continue;
		slots[st[".name"]] = {
			policy: st.policy,
			channels: (type(st.channels) == "array") ? join(" ", st.channels) : (st.channels ?? ""),
			allow: (type(st.allow) == "array") ? st.allow : split(st.allow ?? "", /\s+/),
			max_steps: st.max_steps,
			step: st[".section"],
			/* the rendered placeholder anchor is implicit -- the uci list
			 * holds only user filters */
			names: (type(st.names) == "array") ? st.names : ((st.names != null) ? [st.names] : [])
		};
	}
	return slots;
}

function filters_by_name() {
	let out = {};
	for (let f in uci_sections("camilladsp", "filter"))
		out[f[".name"]] = f;
	return out;
}

/* filter sections -> plain param objects (drop uci metadata) */
function filter_params(names, flt) {
	let out = [];
	for (let n in (names ?? [])) {
		let f = flt[n];
		if (!f)
			continue;
		let o = { name: n };
		for (let k in f)
			if (substr(k, 0, 1) != ".")
				o[k] = f[k];
		push(out, o);
	}
	return out;
}

/* schema for the filters page: editable slots + locked context +
 * user_gains mixers. The policy IS the page schema (plan §9). */
function filters_schema() {
	let slots = filters_slots();
	let flt = filters_by_name();
	let editable = {}, locked = {};
	for (let sc in slots) {
		let slot = slots[sc];
		editable[sc] = {
			policy: slot.policy,
			channels: slot.channels,
			allow: slot.allow,
			max_steps: slot.max_steps,
			filters: filter_params(slot.names, flt)
		};
	}
	/* locked steps: the fixed chains, names only */
	for (let st in uci_sections("camilladsp", "pipeline_step"))
		if (st.policy == "locked")
			locked[st[".name"]] = (type(st.names) == "array") ? st.names : ((st.names != null) ? [st.names] : []);
	let user_gains = [];
	for (let m in uci_sections("camilladsp", "mixer"))
		if (m.user_gains == "1")
			push(user_gains, m[".name"]);
	return { editable: editable, locked: locked, user_gains: user_gains };
}

/* run genconf on the candidate uci; non-empty stderr (or rc!=0) = reject */
function genconf_check() {
	try { mkdir("/run/webui", 0700); } catch (e) {}
	let p = popen(`${GENCONF} ${shq(CDSP_CHECK)} 2>&1`, "r");
	if (!p)
		return "genconf not runnable";
	let err = p.read(4096) ?? "";
	p.close();
	unlink(CDSP_CHECK);
	let lines = trim(err);
	return (length(lines) > 0) ? lines : null;
}

/* backup + commit + dry-run + restore-or-reload */
function camilladsp_txn(apply) {
	let backup = readfile(CDSP_CONFIG);

	/* a throw inside apply() must not skip the restore below */
	let failed = null;
	try {
		apply();                   /* uci writes + commit */
	} catch (e) {
		failed = `uci write failed: ${e}`;
	}

	if (failed == null)
		failed = genconf_check();

	if (failed) {
		/* render failed: restore the previous config atomically */
		if (backup != null)
			writefile(CDSP_CONFIG, backup);
		let q = popen("/etc/init.d/camilladsp reload >/dev/null 2>&1", "r");
		if (q) q.close();
		return { error: { code: ERR_INVALID_ARGUMENT, message: err } };
	}

	/* genconf rendered clean: let the service pick it up (manifest regen +
	 * SIGHUP; camilladsp re-validates against the manifest = layer 3) */
	let q = popen("/etc/init.d/camilladsp reload >/dev/null 2>&1", "r");
	if (q) q.close();
	return {};
}

function filters_set(params) {
	let steps = params?.steps ?? {};
	let free = params?.pipeline;

	if (type(steps) != "object" && free == null)
		return { error: { code: ERR_INVALID_ARGUMENT, message: "steps object required" } };

	/* Free edit: the pipeline step has no subchain policy (or none is
	 * available). Write the user filters straight into the uci step section
	 * rendered at this pipeline position -- no allow/max_steps constraints,
	 * still behind the genconf dry-run + manifest layers. Only user-owned
	 * (u_*) filters are replaced; anything else stays untouched. */
	if (free != null) {
		if (type(free) != "object" || free.index == null ||
		    type(free.filters) != "array")
			return { error: { code: ERR_INVALID_ARGUMENT,
				message: "pipeline object { index, filters } required" } };

		let ordered = pipeline_order();
		if (free.index < 0 || free.index >= length(ordered))
			return { error: { code: ERR_NOT_FOUND, message: "pipeline index out of range" } };
		let name = ordered[free.index];
		let st = pipeline_steps()[name];
		if (!st)
			return { error: { code: ERR_NOT_FOUND, message: `no pipeline step ${free.index}` } };
		if (st.policy == "locked")
			return { error: { code: ERR_PERMISSION_DENIED, message: `${name} is locked` } };
		if (st.type != "Filter")
			return { error: { code: ERR_INVALID_ARGUMENT,
				message: `pipeline step ${free.index} is not a Filter block` } };

		return camilladsp_txn(() => {
			let c = uci.cursor();
			c.load("camilladsp");

			let old = (type(st.names) == "array") ? st.names : ((st.names != null) ? [st.names] : []);
			for (let n in old)
				if (substr(n, 0, 2) == "u_")
					c.delete("camilladsp", n);

			let names = [];
			let i = 0;
			for (let f in free.filters) {
				i++;
				let fname = `u_free_${i}`;
				/* NB: this ucode has no named cursor.add() -- create the
				 * named section via the 3-arg set() form */
				c.set("camilladsp", fname, "filter");
				for (let k in f)
					if (k != "name")
						c.set("camilladsp", fname, k, f[k]);
				push(names, fname);
			}
			c.set("camilladsp", st[".section"], "names", names);
			c.commit("camilladsp");
		});
	}

	let slots = filters_slots();

	/* layer 1 validation, before any write */
	for (let sc in steps) {
		let slot = slots[sc];
		if (!slot)
			return { error: { code: ERR_NOT_FOUND, message: `unknown sub chain ${sc}` } };
		if (slot.policy == "locked")
			return { error: { code: ERR_PERMISSION_DENIED, message: `${sc} is locked` } };
		let list = steps[sc];
		if (type(list) != "array")
			return { error: { code: ERR_INVALID_ARGUMENT, message: `${sc}: array of filters required` } };
		if (length(list) > (slot.max_steps ?? 255))
			return { error: { code: ERR_INVALID_ARGUMENT,
				message: `${sc}: ${length(list)} steps exceed max_steps=${slot.max_steps}` } };
		/* An empty/unset allow list means the slot is unrestricted. */
		let allow_str = (length(slot.allow) > 0) ? ` ${join(" ", slot.allow)} ` : null;
		for (let f in list) {
			if (!f?.type)
				return { error: { code: ERR_INVALID_ARGUMENT, message: `${sc}: filter type missing` } };
			if (allow_str != null && index(allow_str, ` ${f.type} `) < 0)
				return { error: { code: ERR_PERMISSION_DENIED,
					message: `${sc}: filter type '${f.type}' not allowed (allow: ${join(" ", slot.allow)})` } };
		}
	}

	return camilladsp_txn(() => {
		let c = uci.cursor();
		c.load("camilladsp");   /* stage on a loaded cursor or add() is lost */

		/* drop previous user filters of every touched slot (named
		 * sections: the filter section id IS its name) */
		for (let sc in steps) {
			for (let old in slots[sc].names)
				c.delete("camilladsp", old);

			/* create the new filter sections + the slot's name list */
			let names = [];
			let i = 0;
			for (let f in steps[sc]) {
				i++;
				let fname = `u_${sc}_${i}`;
				/* NB: this ucode has no named cursor.add() -- create the
				 * named section via the 3-arg set() form */
				c.set("camilladsp", fname, "filter");
				for (let k in f)
					if (k != "name")
						c.set("camilladsp", fname, k, f[k]);
				push(names, fname);
			}
			c.set("camilladsp", slots[sc].step, "names", names);
		}

		c.commit("camilladsp");
	});
}

/* source-select presets for user_gains mixers (srcmix): every route's
 * gain set by source contribution -- '0' (all ch0), '1' (all ch1),
 * 'mix' (equal blend, 0.5 linear) */
function mix_set(params) {
	let mixer = params?.mixer;
	let source = params?.source;
	let valid_src = false;
	for (let s in [ "0", "1", "mix" ])
		if (s == source)
			valid_src = true;
	if (!valid_src)
		return { error: { code: ERR_INVALID_ARGUMENT, message: "source must be 0, 1 or mix" } };

	let routes = [];
	for (let r in uci_sections("camilladsp", "mixroute"))
		if (r.mixer == mixer)
			push(routes, r);
	if (length(routes) == 0)
		return { error: { code: ERR_NOT_FOUND, message: `mixer ${mixer} has no routes` } };

	return camilladsp_txn(() => {
		let c = uci.cursor();
		c.load("camilladsp");
		for (let r in routes) {
			let g;
			if (source == "mix")
				g = 0.5;
			else
				g = (r.source == source) ? 1.0 : 0.0;
			c.set("camilladsp", r[".section"], "gain", `${g}`);
			c.set("camilladsp", r[".section"], "mute", "");
		}
		c.commit("camilladsp");
	});
}

/* current source selection per user_gains mixer, derived from the
 * mixroute gains (both dests fed from one source = that source;
 * equal blend = mix; anything else = custom) */
function mix_get() {
	let out = {};
	for (let m in uci_sections("camilladsp", "mixer")) {
		if (m.user_gains != "1")
			continue;
		let routes = [];
		for (let r in uci_sections("camilladsp", "mixroute"))
			if (r.mixer == m[".name"])
				push(routes, r);
		let one = 0, mix = 0;
		for (let r in routes) {
			let g = +r.gain;
			if (g == 1.0)
				one++;
			else if (g == 0.5)
				mix++;
		}
		out[m[".name"]] = (one == length(routes)) ? "last"
			: (mix == length(routes)) ? "mix"
			: (one > 0) ? "one"
			: "custom";
	}
	/* "last"/"one" both mean a single source is selected; refine to 0/1 */
	for (let m in out) {
		if (out[m] != "one" && out[m] != "last")
			continue;
		let sel = null;
		for (let r in uci_sections("camilladsp", "mixroute")) {
			if (r.mixer != m)
				continue;
			if (+r.gain == 1.0)
				sel = r.source;
		}
		out[m] = sel ?? "custom";
	}
	return out;
}

/* detailed view for the mixer tab: per user_gains mixer the derived
 * state, channel labels (uci lists in_label/out_label, UI-only metadata
 * genconf ignores), route gains (linear) + mute/inverted flags, and
 * whether the channel counts are policy-locked (the mixer is referenced
 * by a subchain step -> topology is provisioned). */
function mixers_get() {
	let states = mix_get();
	let managed = {};
	for (let st in uci_sections("camilladsp", "pipeline_step"))
		if (st.policy == "locked" && st.type == "Mixer")
			managed[st.mixer] = true;
	let out = [];
	for (let m in uci_sections("camilladsp", "mixer")) {
		if (m.user_gains != "1")
			continue;
		let routes = [];
		for (let r in uci_sections("camilladsp", "mixroute"))
			if (r.mixer == m[".name"])
				push(routes, { dest: r.dest, source: r.source, gain: +r.gain,
					mute: (r.mute == "1"), inverted: (r.inverted == "1") });
		sort(routes, (a, b) => (+a.dest != +b.dest)
			? (+a.dest - +b.dest) : (+a.source - +b.source));
		/* free route fields per the policy (gain implied; "mute" gates
		 * the live-matrix destination mutes) */
		let allow = filter(map((type(m.allow) == "array") ? m.allow : words(m.allow ?? ""),
			(a) => lc(`${a}`)), (a) => a == "mute");
		push(allow, "gain");
		push(out, {
			name: m[".name"],
			state: states[m[".name"]] ?? "custom",
			routes: routes,
			in: +m.in ?? 2,
			out: +m.out ?? 2,
			in_label: (type(m.in_label) == "array") ? m.in_label : [],
			out_label: (type(m.out_label) == "array") ? m.out_label : [],
			channels_locked: managed[m[".name"]] == 1,
			allow: allow
		});
	}
	return { mixers: out };
}

function mixers_managed(mixer) {
	for (let st in uci_sections("camilladsp", "pipeline_step"))
		if (st.policy == "locked" && st.type == "Mixer" && st.mixer == mixer)
			return true;
	return false;
}

/* mixer metadata: channel labels (always writable) and channel counts
 * (only for free mixers -- a policy-managed mixer's topology is
 * provisioned). Changing in/out rebuilds the routes as a diagonal
 * identity mapping; gains/labels survive only where positions do. */
function mix_set_meta(params) {
	let mixer = params?.mixer;
	let exposed = {};
	for (let m in uci_sections("camilladsp", "mixer"))
		if (m.user_gains == "1")
			exposed[m[".name"]] = m;
	if (!exposed[mixer])
		return { error: { code: ERR_PERMISSION_DENIED, message: `mixer ${mixer} not exposed` } };

	for (let k in [ "in_label", "out_label" ]) {
		let v = (params ?? {})[k];
		if (v != null && type(v) != "array")
			return { error: { code: ERR_INVALID_ARGUMENT, message: `${k} must be a list` } };
		for (let l in (v ?? []))
			if (type(l) != "string" || length(l) > 16)
				return { error: { code: ERR_INVALID_ARGUMENT,
					message: `${k} entries: strings up to 16 chars` } };
	}

	let nin = params?.in, nout = params?.out;
	if ((nin != null || nout != null) && mixers_managed(mixer))
		return { error: { code: ERR_PERMISSION_DENIED,
			message: "channel counts are locked by the pipeline policy" } };
	if (nin != null && (type(nin) != "int" || nin < 1 || nin > 16))
		return { error: { code: ERR_INVALID_ARGUMENT, message: "in must be 1..16" } };
	if (nout != null && (type(nout) != "int" || nout < 1 || nout > 16))
		return { error: { code: ERR_INVALID_ARGUMENT, message: "out must be 1..16" } };

	return camilladsp_txn(() => {
		let c = uci.cursor();
		c.load("camilladsp");
		for (let k in [ "in_label", "out_label" ]) {
			let v = (params ?? {})[k];
			if (v != null)
				c.set("camilladsp", mixer, k, v);
		}
		if (nin != null || nout != null) {
			c.set("camilladsp", mixer, "in", `${nin ?? exposed[mixer].in}`);
			c.set("camilladsp", mixer, "out", `${nout ?? exposed[mixer].out}`);
			/* rebuild: diagonal identity routes */
			for (let r in uci_sections("camilladsp", "mixroute"))
				if (r.mixer == mixer)
					c.delete("camilladsp", r[".section"]);
			let n = (nin != null) ? nin : +exposed[mixer].in;
			for (let i = 0; i < n && i < ((nout != null) ? nout : +exposed[mixer].out); i++) {
				let sec = c.add("camilladsp", "mixroute");
				c.set("camilladsp", sec, "mixer", mixer);
				c.set("camilladsp", sec, "dest", `${i}`);
				c.set("camilladsp", sec, "source", `${i}`);
				c.set("camilladsp", sec, "gain", "1.0");
			}
		}
		c.commit("camilladsp");
	});
}


/* manual gain set for one user_gains mixer ("Other" in the UI): gains
 * follow the existing locked route topology -- no route may be added
 * or dropped, only the values change. Gains are LINEAR (0..10). */
function mix_set_gains(params) {
	let mixer = params?.mixer;
	let routes = params?.routes;

	if (type(routes) != "array" || length(routes) == 0)
		return { error: { code: ERR_INVALID_ARGUMENT, message: "routes array required" } };

	let exposed = {};
	for (let m in uci_sections("camilladsp", "mixer"))
		if (m.user_gains == "1")
			exposed[m[".name"]] = true;
	if (!exposed[mixer])
		return { error: { code: ERR_PERMISSION_DENIED, message: `mixer ${mixer} not exposed` } };

	let wanted = {};
	for (let r in routes) {
		let g = +r?.gain;
		if (r?.dest == null || r?.source == null || g != g || g < 0 || g > 10)
			return { error: { code: ERR_INVALID_ARGUMENT,
				message: "routes[] of {dest, source, gain 0..10} required" } };
		wanted[`${r.dest}:${r.source}`] = {
			gain: g,
			mute: (r.mute == 1 || r.mute == true) ? "1" : ""
		};
	}

	let existing = {};
	for (let r in uci_sections("camilladsp", "mixroute"))
		if (r.mixer == mixer)
			existing[`${r.dest}:${r.source}`] = r[".section"];
	if (length(existing) != length(wanted))
		return { error: { code: ERR_INVALID_ARGUMENT, message: "routes must match the mixer topology" } };
	for (let k in wanted)
		if (!existing[k])
			return { error: { code: ERR_INVALID_ARGUMENT, message: `unknown route ${k}` } };

	return camilladsp_txn(() => {
		let c = uci.cursor();
		c.load("camilladsp");
		for (let k in wanted) {
			c.set("camilladsp", existing[k], "gain", `${wanted[k].gain}`);
			c.set("camilladsp", existing[k], "mute", wanted[k].mute);
		}
		c.commit("camilladsp");
	});
}


/* set the optional human label of one pipeline block (uci pipeline_step
 * option 'label'; UI-only metadata rendered as the step description by
 * genconf). index = position in the `config pipeline` order. */
function block_set_label(params) {
	let idx = params?.index;
	let label = params?.label ?? "";

	if (type(idx) != "int" || idx < 0)
		return { error: { code: ERR_INVALID_ARGUMENT, message: "index required" } };
	if (type(label) != "string" || length(label) > 32 ||
	    (length(label) > 0 && !match(label, /^[a-zA-Z0-9 _.-]+$/)))
		return { error: { code: ERR_INVALID_ARGUMENT,
			message: "label must be [a-zA-Z0-9 _.-] up to 32 chars" } };

	let order = pipeline_order();
	let name = order[idx];
	if (!name || !pipeline_steps()[name])
		return { error: { code: ERR_NOT_FOUND, message: `no pipeline step ${idx}` } };

	let c = uci.cursor();
	c.load("camilladsp");
	c.set("camilladsp", name, "label", label);
	c.commit("camilladsp");
	return {};
}

const DSP_OPTIONS = [
	"samplerate", "chunksize", "format", "channels", "output_channels",
	"capture", "playback", "gain"
];

function dsp_settings_get() {
	let c = uci.cursor();
	let out = {};
	for (let key in DSP_OPTIONS)
		out[key] = c.get("camilladsp", "main", key);
	/* honest aggregate of the user_gains mixers: the common selection,
	 * or "custom" when they disagree / gains are manual (the General
	 * tab shows that as the read-only "Other" state) */
	let vals = values(mix_get());
	let src = length(vals) ? vals[0] : "mix";
	for (let v in vals)
		if (v != src)
			src = "custom";
	out.source = src;
	return out;
}

function dsp_settings_set(values) {
	if (type(values) != "object")
		return { error: { code: ERR_INVALID_ARGUMENT, message: "settings object required" } };

	let source = values.source;
	if (source != null && source != "0" && source != "1" && source != "mix")
		return { error: { code: ERR_INVALID_ARGUMENT, message: "source must be 0, 1 or mix" } };

	let result = camilladsp_txn(() => {
		let c = uci.cursor();
		c.load("camilladsp");
		for (let key in values) {
			if (index(" " + join(" ", DSP_OPTIONS) + " ", " " + key + " ") >= 0)
				c.set("camilladsp", "main", key, values[key]);
		}
		if (source != null) {
			let exposed_mixers = {};
			for (let mixer in uci_sections("camilladsp", "mixer"))
				if (mixer.user_gains == "1")
					exposed_mixers[mixer[".name"]] = true;
			for (let route in uci_sections("camilladsp", "mixroute")) {
				if (!exposed_mixers[route.mixer])
					continue;
				let gain = (source == "mix") ? 0.5 : ((route.source == source) ? 1.0 : 0.0);
				c.set("camilladsp", route[".section"], "gain", "" + gain);
			}
		}
		c.commit("camilladsp");
	});

	/* -g is read only on process start, unlike the rendered config. */
	if (!result.error && values.gain != null) {
		let p = popen("/etc/init.d/camilladsp restart >/dev/null 2>&1", "r");
		if (p) p.close();
	}
	return result;
}

/* Policy-safe pipeline model for the UI. Locked steps deliberately
 * expose no filter names, parameters, or internal topology: one opaque
 * node is the entire protected stage. */
function dsp_pipeline_get() {
	let slots = filters_slots();
	let mixers = {};
	for (let m in uci_sections("camilladsp", "mixer"))
		mixers[m[".name"]] = m;
	let order = pipeline_order();
	let steps = pipeline_steps();

	/* protected when any pipeline_step carries a policy; a plain config
	 * (no policies) renders everything fully editable */
	let protected_cfg = false;
	for (let n, st in steps)
		if ((st.policy ?? "") != "")
			protected_cfg = true;

	/* The browser reads actual blocks/channels from GetConfigJson. This reply
	 * is only the policy map that classifies each runtime pipeline index. */
	let stages = [];
	for (let i = 0; i < length(order); i++) {
		let name = order[i];
		let st = steps[name] ?? {};
		/* optional uci `option label`: a human name for the block, shown
		 * by the UIs (the step name stays authoritative in `label` so
		 * the EQ save mapping keeps working) */
		let disp = st.label ? st.label : null;
		if (!protected_cfg) {
			/* No policy: this is a normal upstream CamillaDSP
			 * configuration. The websocket is the authority and its
			 * blocks are fully editable (not merely readable). */
			push(stages, { index: i, kind: "free", label: st.label ?? st.type ?? "DSP block", name: disp });
			continue;
		}
		/* A mixer whose route gains are explicitly exposed by policy is
		 * represented as one source-selection node, still without exposing
		 * the rest of its protected routing structure. */
		if (st.policy == "locked" && st.type == "Mixer" &&
		    mixers[st.mixer]?.user_gains == "1") {
			push(stages, {
				index: i,
				kind: "mixer",
				label: "Source mixer: " + st.mixer,
				name: disp
			});
		} else if (st.policy == "locked") {
			push(stages, {
				index: i,
				kind: "locked",
				/* plain name: the UIs mark locked stages with a
				 * Protected tag, a text prefix would duplicate it */
				label: name,
				name: disp
			});
		} else {
			let slot = slots[name] ?? {};
			push(stages, {
				index: i,
				kind: "editable",
				label: name,
				name: disp,
				channels: slot.channels,
				filters: length(slot.names),
				max_steps: slot.max_steps
			});
		}
	}

	return { stages: stages };
}

export {
	pipeline_order, pipeline_steps, filters_slots, filters_schema,
	filters_set, mix_set, mix_get, mixers_get, mix_set_gains,
	mix_set_meta, block_set_label, dsp_settings_get, dsp_settings_set,
	dsp_pipeline_get
};
