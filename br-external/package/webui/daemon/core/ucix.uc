/*
 * ucix -- uci access: read any config, write only the allowlist
 * (generic set on arbitrary configs would be config injection).
 *
 * ucode-uci quirks honored here:
 *  - foreach(config, cb) silently no-ops: the callback lands in the
 *    type-filter slot; the correct form is foreach(config, null, cb).
 *  - mutations need c.load(config) BEFORE staging, or add()/set()
 *    deltas are silently lost at commit().
 */

import * as uci from "uci";
import { ERR_NOT_FOUND } from "util";

const UCI_WRITABLE = { system: 1, network: 1, camilladsp: 1, inferno: 1, webui: 1, dropbear: 1 };

function uci_write_ok(config) {
	return UCI_WRITABLE[config] == 1;
}

/* sections of one type as an array; ".section" carries the section id */
function uci_sections(config, type) {
	let c = uci.cursor();
	let out = [];
	try {
		c.foreach(config, type, (s) => {
			s[".section"] = s[".name"];
			push(out, s);
		});
	} catch (e) {}
	return out;
}

/* whole config as {sectionid: {options}} (RPC uci.load) */
function uci_load_config(config) {
	let c = uci.cursor();
	let out = {};
	try {
		c.foreach(config, null, (s) => {
			out[s[".name"]] = s;
		});
	} catch (e) {
		return { error: { code: ERR_NOT_FOUND, message: `cannot load ${config}` } };
	}
	return out;
}

/* TLS-aware cookie: append Secure while https is on */
function webui_tls_enabled() {
	try {
		let c = uci.cursor();
		return c.get("webui", "tls", "enable") == "1";
	} catch (e) {
		return false;
	}
}

export { uci_write_ok, uci_sections, uci_load_config, webui_tls_enabled };
