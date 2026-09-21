/* mods_home -- BE module of webui-app-home: /proc/stat cpu times for
 * the dashboard usage gauges (OUI shape). */

import { readfile } from "fs";
import { atoi } from "util";

const home_module = {
	system: {
		/* /proc/stat cpuN lines -> {cpu: [u,n,s,i,...], ...} */
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
		}
	}
};

export { home_module };
