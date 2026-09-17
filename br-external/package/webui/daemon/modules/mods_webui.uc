/* mods_webui -- daemon identity, password change, firstboot flow,
 * factory reset. */

import { popen } from "fs";
import { ERR_PERMISSION_DENIED, ERR_INVALID_ARGUMENT } from "util";
import { set_root_password, firstboot_set, firstboot_pending } from "auth";

/* restore packaged /etc/config defaults (tarball built at image time),
 * optionally wipe /opt/user_data, then reboot. Passwords and all uci
 * state return to the shipped state. */
function factory_reset(params) {
	let wipe = (params?.wipe_user_data == true);
	let def = "/usr/share/webui/defaults/etc-config.tar";

	let q = popen(`tar -tf ${def} >/dev/null 2>&1 && echo TAR-OK`, "r");
	let ok = q ? (q.read(64) ?? "") : "";
	if (q) q.close();
	if (index(ok, "TAR-OK") < 0)
		return { error: { code: -1, message: `defaults archive ${def} missing` } };

	/* the actual restore+reboot happens slightly detached so the HTTP
	 * reply (and the confirm dialog) complete first */
	let p = popen(`(sleep 1; tar -C / -xf ${def}; ` +
		(wipe ? `rm -rf /opt/user_data/*; ` : "") +
		`reboot) >/dev/null 2>&1 &`, "r");
	if (p) p.close();

	return {};
}

const webui_module = {
	board: (params) => ({
		daemon: "webuid",
		contract: 1,
		milestone: "M5"
	}),
	set_password: (params) => set_root_password(params?.old, params?.new),
	firstboot_status: (params) => firstboot_pending(),
	firstboot: (params) => firstboot_set(params?.new),
	factory_reset: (params) => factory_reset(params)
};

export { webui_module };
