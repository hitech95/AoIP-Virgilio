/*
 * dsp -- protected-pipeline editing (plan/webui.md §9): filters/mix on
 * the uci subchain model. Three validation layers:
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
/* Root-owned path only: a fixed name under /tmp would be symlink-able by
 * any local user (genconf writes through it as root -> file clobber). */
const CDSP_CHECK = "/run/webui/camilladsp.yml.check";

/* slot model: { <subchain>: { policy, channels, allow, max_steps,
 *   step: section id, names: [current user filters] } } */
function filters_slots() {
	let slots = {};
	for (let sc in uci_sections("camilladsp", "subchain")) {
		let allow = (type(sc.allow) == "array") ? sc.allow : split(sc.allow ?? "", /\s+/);
		slots[sc.name] = {
			policy: sc.policy,
			channels: sc.channels,
			allow: allow,
			max_steps: sc.max_steps,
			step: null,
			names: []
		};
	}
	for (let st in uci_sections("camilladsp", "step")) {
		if (st.subchain && slots[st.subchain] && !slots[st.subchain].step) {
			slots[st.subchain].step = st[".section"];
			let nm = st.names ?? [];
			/* the rendered placeholder anchor is implicit -- the uci list
			 * holds only user filters */
			slots[st.subchain].names = (type(nm) == "array") ? nm : [nm];
		}
	}
	return slots;
}

function filters_by_name() {
	let out = {};
	for (let f in uci_sections("camilladsp", "filter"))
		out[f.name] = f;
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
		if (slot.policy == "locked") {
			locked[sc] = slot.names;
		} else {
			editable[sc] = {
				policy: slot.policy,
				channels: slot.channels,
				allow: slot.allow,
				max_steps: slot.max_steps,
				filters: filter_params(slot.names, flt)
			};
		}
	}
	let user_gains = [];
	for (let m in uci_sections("camilladsp", "mixer"))
		if (m.user_gains == "1")
			push(user_gains, m.name);
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

	apply();                       /* uci writes + commit */

	let err = genconf_check();
	if (err) {
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

		let ordered = uci_sections("camilladsp", "step");
		sort(ordered, (a, b) => (+a.index) - (+b.index));
		if (free.index < 0 || free.index >= length(ordered))
			return { error: { code: ERR_NOT_FOUND, message: "pipeline index out of range" } };
		let st = ordered[free.index];
		if (st.type != "Filter")
			return { error: { code: ERR_INVALID_ARGUMENT,
				message: `pipeline step ${free.index} is not a Filter block` } };

		return camilladsp_txn(() => {
			let c = uci.cursor();
			c.load("camilladsp");

			let old = st.names ?? [];
			if (type(old) != "array")
				old = [old];
			for (let n in old)
				if (substr(n, 0, 2) == "u_")
					c.delete("camilladsp", n);

			let names = [];
			let i = 0;
			for (let f in free.filters) {
				i++;
				let fname = `u_free_${i}`;
				let sec = c.add("camilladsp", "filter");
				c.set("camilladsp", sec, "name", fname);
				for (let k in f)
					if (k != "name")
						c.set("camilladsp", sec, k, f[k]);
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

		/* drop previous user filters of every touched slot */
		for (let sc in steps) {
			for (let old in slots[sc].names)
				c.delete("camilladsp", old);

			/* create the new filter sections + the slot's name list */
			let names = [];
			let i = 0;
			for (let f in steps[sc]) {
				i++;
				let fname = `u_${sc}_${i}`;
				let sec = c.add("camilladsp", "filter");
				c.set("camilladsp", sec, "name", fname);
				for (let k in f)
					if (k != "name")
						c.set("camilladsp", sec, k, f[k]);
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
			if (r.mixer == m.name)
				push(routes, r);
		let one = 0, mix = 0;
		for (let r in routes) {
			let g = +r.gain;
			if (g == 1.0)
				one++;
			else if (g == 0.5)
				mix++;
		}
		out[m.name] = (one == length(routes)) ? "last"
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

const DSP_OPTIONS = [
	"samplerate", "chunksize", "format", "channels", "output_channels",
	"capture", "playback", "gain"
];

function dsp_settings_get() {
	let c = uci.cursor();
	let out = {};
	for (let key in DSP_OPTIONS)
		out[key] = c.get("camilladsp", "main", key);
	let selected_sources = values(mix_get());
	out.source = (length(selected_sources) && selected_sources[0] != "custom")
		? selected_sources[0] : "mix";
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
					exposed_mixers[mixer.name] = true;
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

/* Policy-safe pipeline model for the UI. Locked subchains deliberately
 * expose no filter names, parameters, or internal topology: one opaque
 * node is the entire protected stage. */
function dsp_pipeline_get() {
	let slots = filters_slots();
	let stages = [];
	let steps = uci_sections("camilladsp", "step");
	/* genconf sorts `option index` numerically before rendering. Match it. */
	sort(steps, (a, b) => (+a.index) - (+b.index));

	/* The browser reads actual blocks/channels from GetConfigJson. This reply
	 * is only the policy map that classifies each runtime pipeline index. */
	for (let i = 0; i < length(steps); i++) {
		let st = steps[i];
		let name = st.subchain;
		let slot = name ? slots[name] : null;
		if (!slot) {
			/* No manifest/subchain policy: this is a normal upstream
			 * CamillaDSP configuration. The websocket is the authority and
			 * its blocks are fully editable (not merely readable). */
			push(stages, { index: i, kind: "free", label: st.type ?? "DSP block" });
			continue;
		}
		/* A mixer whose route gains are explicitly exposed by policy is
		 * represented as one source-selection node, still without exposing
		 * the rest of its protected routing structure. */
		if (st.user_gains == "1") {
			push(stages, {
				index: i,
				kind: "mixer",
				label: "Source mixer: " + st.name
			});
		} else if (slot.policy == "locked") {
			push(stages, {
				index: i,
				kind: "locked",
				label: "Protected: " + name
			});
		} else {
			push(stages, {
				index: i,
				kind: "editable",
				label: name,
				channels: slot.channels,
				filters: length(slot.names),
				max_steps: slot.max_steps
			});
		}
	}

	return { stages: stages };
}

export {
	filters_slots, filters_schema, filters_set, mix_set, mix_get,
	dsp_settings_get, dsp_settings_set, dsp_pipeline_get
};
