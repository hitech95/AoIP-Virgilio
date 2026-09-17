/* ubusx -- persistent ubus connection with one-shot reconnect.
 *
 * Void methods (network reload, service event) reply with an empty
 * blob -> ucode null. That is SUCCESS, not failure. */

import * as ubus from "ubus";

let conn = null;

function ubus_call(object, method, params) {
	for (let attempt = 0; attempt < 2; attempt++) {
		if (!conn) {
			try { conn = ubus.connect(); } catch (e) { conn = null; }
			if (!conn)
				return null;
		}
		try {
			return conn.call(object, method, params ?? {}) ?? {};
		} catch (e) {
			conn = null;   /* stale connection or bad call: retry once */
		}
	}
	return null;
}

export { ubus_call };
