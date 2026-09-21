/* mods_inferno -- BE module of webui-app-inferno: the few AoIP (inferno)
 * settings -- the advertised device name (empty = follow the system
 * hostname) and the bind interface. Both are consumed by
 * camilladsp-genconf when camilladsp (re)starts; saving optionally
 * restarts camilladsp to apply. */

import * as uci from "uci";
import { lsdir, popen } from "fs";
import { ERR_INVALID_ARGUMENT } from "util";
import { ubus_call } from "ubusx";

function link_interfaces() {
	let out = [];
	try {
		for (let n in sort(lsdir("/sys/class/net")))
			if (n != "lo")
				push(out, n);
	} catch (e) {}
	return out;
}

const inferno_module = {
	inferno: {
		get: (params) => {
			let c = uci.cursor();
			let name = c.get("inferno", "main", "name") ?? "";
			let board = ubus_call("system", "board");
			return {
				name: name,
				use_hostname: (length(name) == 0),
				interface: c.get("inferno", "main", "interface") ?? "",
				interfaces: link_interfaces(),
				hostname: board?.hostname ?? ""
			};
		},

		save: (params) => {
			let name = params?.name ?? "";
			let iface = params?.interface;

			if (type(name) != "string" || length(name) > 64 ||
			    (length(name) > 0 && !match(name, /^[a-zA-Z0-9._-]+$/)))
				return { error: { code: ERR_INVALID_ARGUMENT,
					message: "bad name (empty, or [a-zA-Z0-9._-], max 64)" } };

			let interfaces = link_interfaces();
			if (!iface || index(" " + join(" ", interfaces) + " ", " " + iface + " ") < 0)
				return { error: { code: ERR_INVALID_ARGUMENT,
					message: `interface must be one of: ${join(", ", interfaces)}` } };

			let c = uci.cursor();
			c.load("inferno");
			c.set("inferno", "main", "name", name);
			c.set("inferno", "main", "interface", iface);
			c.commit("inferno");

			/* apply: genconf re-reads inferno on camilladsp (re)start.
			 * Detached so the RPC reply is not blocked by the restart. */
			if (params?.apply != false) {
				let p = popen("(sleep 1; /etc/init.d/camilladsp restart) >/dev/null 2>&1 &", "r");
				if (p) p.close();
			}
			return {};
		}
	}
};

export { inferno_module };
