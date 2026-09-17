/* menus -- merge /usr/share/webui/menu.d/*.json (later files win). */

import { readfile, lsdir } from "fs";
import { log_err } from "util";

const MENU_DIR = "/usr/share/webui/menu.d";

function load_menus() {
	let menus = {};
	let names = [];
	try { names = lsdir(MENU_DIR); } catch (e) { return menus; }
	for (let name in sort(names)) {
		if (substr(name, length(name) - 5) != ".json")
			continue;
		let data = readfile(MENU_DIR + "/" + name);
		if (!data)
			continue;
		try {
			let m = json(data);
			/* no Object.assign in the pinned ucode */
			if (type(m) == "object")
				for (let k in m)
					menus[k] = m[k];
		} catch (e) {
			log_err("bad menu file %s: %s", [name, e?.message ?? e]);
		}
	}
	return menus;
}

export { load_menus };
