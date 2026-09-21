/* mods_core -- the CORE RPC module tables: shell services (ui, ubus
 * bridge). App-owned modules live next to their FE in the per-app
 * daemon folders and are merged in by rpcmods.uc. */

import { ERR_UNKNOWN } from "util";
import { ubus_call } from "ubusx";
import { load_menus } from "menus";

const core_modules = {
	ui: {
		get_locale: (params) => ({ locale: "auto" }),
		get_theme:  (params) => ({ theme: "light" }),
		get_menus:  (params) => ({ menus: load_menus() })
	},

	ubus: {
		call: (params) => {
			let r = ubus_call(params?.object, params?.method, params?.params);
			return (r == null) ? { error: { code: ERR_UNKNOWN, message: "ubus call failed" } }
			                   : r;
		}
	}
};

export { core_modules };
