/* mods_system -- BE module of webui-app-system: zone table
 * [[name, POSIX TZ], ...] -- data file on the device (the LuCI model:
 * the app never embeds the table). Cached. */

import { readfile } from "fs";

let timezones = null;   /* cached zone table for system.get_timezones */

const system_module = {
	system: {
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
	}
};

export { system_module };
