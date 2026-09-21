/* mods_status -- BE module of webui-app-status: one reply, one poll --
 * the /status page fan-in (plan §8). ptp-monitor publishes its object
 * as "ptp" (see its header). */

import { ubus_call } from "ubusx";

const status_module = {
	status: {
		all: (params) => ({
			ptp:  ubus_call("ptp", "status"),
			dsp:  ubus_call("camilladsp", "status"),
			board: ubus_call("system", "board")
		})
	}
};

export { status_module };
