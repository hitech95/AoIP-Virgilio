/*
 * auth -- /etc/shadow login, password change and the firstboot flow.
 *
 * Verify: busybox `cryptpw PASSWORD SALT` (SALT = full stored hash, so
 * crypt() derives the method from the $6$ prefix). Commands go through
 * /bin/sh -c strings -- shq() escaping everywhere.
 */

import { readfile, popen } from "fs";
import { shq, log_err,
         ERR_INVALID_ARGUMENT, ERR_UNAUTHORIZED, ERR_UNKNOWN } from "util";
import { session_reset } from "sessions";

let shadow_path = "/etc/shadow";

function init(path) {
	if (path)
		shadow_path = path;
}

/* hash field for `user`: "" = no password, null = no such account */
function shadow_hash(user) {
	let data = readfile(shadow_path);
	if (!data)
		return null;

	for (let line in split(data, "\n")) {
		let f = split(line, ":");
		if (length(f) > 1 && f[0] == user)
			return f[1];
	}
	return null;
}

/* verdict: ok | bad | empty (no password set) | noent | error */
function verify_password(user, password) {
	let hash = shadow_hash(user);
	if (hash == null)
		return "noent";
	if (hash == "" || hash == "!")
		return "empty";

	let p = popen(`cryptpw ${shq(password)} ${shq(hash)}`, "r");
	if (!p)
		return "error";
	let out = p.read(256);
	p.close();

	return (trim(out) == hash) ? "ok" : "bad";
}

/* hash + write a new root password; drops every session on success */
function write_new_root_password(newpw) {
	if (type(newpw) != "string" || length(newpw) < 6)
		return { error: { code: ERR_INVALID_ARGUMENT, message: "new password too short (min 6)" } };

	let p = popen(`mkpasswd -m sha512 ${shq(newpw)}`, "r");
	if (!p)
		return { error: { code: ERR_UNKNOWN, message: "mkpasswd failed" } };
	let hash = trim(p.read(256) ?? "");
	p.close();

	if (length(hash) < 20 || substr(hash, 0, 3) != "$6$")
		return { error: { code: ERR_UNKNOWN, message: "mkpasswd returned garbage" } };

	/* replace root's hash field in place (delimiter #: hash charset is [./a-zA-Z0-9$]) */
	p = popen(`sed -i ${shq("s#^root:[^:]*:#root:" + hash + ":#")} ${shq(shadow_path)}`, "r");
	if (p) p.close();

	/* invalidate every existing session: force re-login with the new secret */
	session_reset();
	return {};
}

function set_root_password(oldpw, newpw) {
	let verdict = verify_password("root", oldpw ?? "");
	if (verdict != "ok")
		return { error: { code: ERR_UNAUTHORIZED, message: "current password wrong" } };

	return write_new_root_password(newpw);
}

/* firstboot allowed ONLY while the root hash is empty (re-checked) */
function firstboot_set(newpw) {
	let h = shadow_hash("root");
	if (h == null || !(h == "" || h == "!"))
		return { error: { code: -4, message: "root password already set" } };
	return write_new_root_password(newpw);
}

function firstboot_pending() {
	let h = shadow_hash("root");
	if (h == null) {
		/* unreadable shadow: cannot be a working login either -- surface
		 * it loudly rather than silently showing the login form */
		return { firstboot: false, error: "cannot read " + shadow_path };
	}
	/* "", "!", "*": no usable password set -> wizard */
	return { firstboot: (h == "" || h == "!" || h == "*") };
}

export { init, shadow_hash, verify_password, set_root_password,
         write_new_root_password, firstboot_set, firstboot_pending };
