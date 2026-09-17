/* mods_* -- the RPC module tables (one file per family), assembled by
 * rpcmods.uc. Each table maps to the frozen contract in plan/webui.md §4. */

import { readfile, popen } from "fs";
import { atoi, ERR_UNKNOWN } from "util";
import { ubus_call } from "ubusx";
import { load_menus } from "menus";

function read_logs(n) {
	/* logread dumps the RAM ring buffer; tail the last n lines */
	let p = popen(`logread`, "r");
	if (!p)
		return "";
	let out = p.read(256 * 1024);
	p.close();
	let lines = split(out ?? "", "\n");
	if (length(lines) > n)
		lines = slice(lines, length(lines) - n);
	return join("\n", lines);
}

let timezones = null;   /* cached zone table for system.get_timezones */

const core_modules = {
	ui: {
		get_locale: (params) => ({ locale: "auto" }),
		get_theme:  (params) => ({ theme: "light" }),
		get_menus:  (params) => ({ menus: load_menus() })
	},

	logs: {
		read: (params) => read_logs(min(params?.n ?? 200, 1000))
	},

	dsp: {
		volume_set: (params) => {
			let r = ubus_call("camilladsp", "volume_set",
				{ volume: params?.volume ?? 0 });
			return (r == null)
				? { error: { code: ERR_UNKNOWN, message: "camilladsp not reachable" } }
				: (r ?? {});
		}
	},

	ubus: {
		call: (params) => {
			let r = ubus_call(params?.object, params?.method, params?.params);
			return (r == null) ? { error: { code: ERR_UNKNOWN, message: "ubus call failed" } }
			                   : r;
		}
	},

	status: {
		/* one reply, one poll -- the /status page fan-in (plan §8).
		 * ptp-monitor publishes its object as "ptp" (see its header). */
		all: (params) => ({
			ptp:  ubus_call("ptp", "status"),
			dsp:  ubus_call("camilladsp", "status"),
			board: ubus_call("system", "board")
		})
	},

	system: {
		/* /proc/stat cpuN lines -> {cpu: [u,n,s,i,...], ...} (OUI shape,
		 * consumed by the home dashboard's usage gauges) */
		get_cpu_time: (params) => {
			let times = {};
			for (let line in split(readfile("/proc/stat") ?? "", "\n")) {
				let f = split(line, /\s+/);
				if (length(f) < 5 || substr(f[0], 0, 3) != "cpu")
					continue;
				let t = [];
				for (let i = 1; i < length(f); i++)
					push(t, atoi(f[i]));
				times[f[0]] = t;
			}
			return { times: times };
		},

		/* zone table [[name, POSIX TZ], ...] -- data file on the device
		 * (the LuCI model: the app never embeds the table). Cached. */
		get_timezones: (params) => {
			if (timezones == null) {
				try {
					timezones = json(readfile("/usr/share/webui/zoneinfo.json")) ?? [];
				} catch (e) {
					timezones = [];
				}
			}
			return { timezones: timezones };
		}
	},

	network: {
		/* management interface status for the home dashboard (this box
		 * has no WAN -- the lan/eth0 segment IS the uplink) */
		get_lan_networks: (params) => {
			let st = ubus_call("network.interface.lan", "status");
			return (st && st.up != null) ? { networks: [st] } : { networks: [] };
		}
	}
};

export { core_modules };
