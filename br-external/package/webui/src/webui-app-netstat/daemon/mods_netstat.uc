/* mods_netstat -- BE module of webui-app-netstat (also used by the home
 * dashboard): management interface status. This box has no WAN -- the
 * lan/eth0 segment IS the uplink. */

import { ubus_call } from "ubusx";

const netstat_module = {
	network: {
		get_lan_networks: (params) => {
			let st = ubus_call("network.interface.lan", "status");
			return (st && st.up != null) ? { networks: [st] } : { networks: [] };
		}
	}
};

export { netstat_module };
