/* mods_uci -- generic uci bridge (plan §4): read any config, write only
 * the allowlist enforced by ucix. */

import * as uci from "uci";
import { ERR_INVALID_ARGUMENT, ERR_PERMISSION_DENIED } from "util";
import { uci_write_ok, uci_load_config } from "ucix";

function denied(config) {
	return { error: { code: ERR_PERMISSION_DENIED, message: `config ${config} not writable` } };
}

const uci_module = {
	load: (params) => {
		if (type(params?.config) != "string")
			return { error: { code: ERR_INVALID_ARGUMENT, message: "config required" } };
		return uci_load_config(params.config);
	},
	get: (params) => {
		let c = uci.cursor();
		return c.get(params?.config, params?.section, params?.option);
	},
	set: (params) => {
		if (!uci_write_ok(params?.config))
			return denied(params?.config);
		let c = uci.cursor();
		c.load(params.config);
		for (let opt in (params?.values ?? {}))
			c.set(params.config, params.section, opt, params.values[opt]);
		c.commit(params.config);
		return {};
	},
	add: (params) => {
		if (!uci_write_ok(params?.config))
			return denied(params?.config);
		let c = uci.cursor();
		c.load(params.config);   /* add() on an unloaded cursor loses its delta */
		let name = c.add(params.config, params?.type ?? "section");
		for (let opt in (params?.values ?? {}))
			c.set(params.config, name, opt, params.values[opt]);
		c.commit(params.config);
		return { name: name };
	},
	"delete": (params) => {
		if (!uci_write_ok(params?.config))
			return denied(params?.config);
		let c = uci.cursor();
		c.load(params.config);
		if (params?.options)
			for (let opt in params.options)
				c.delete(params.config, params.section, opt);
		else
			c.delete(params.config, params.section);
		c.commit(params.config);
		return {};
	}
};

export { uci_module };
