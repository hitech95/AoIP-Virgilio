/*
 * util -- shared helpers and constants (no external state).
 *
 * ucode notes (pinned rev):
 *  - `export function` is broken; use plain declarations + `export { .. }`.
 *  - json(str) parses; serialization is sprintf("%J", obj).
 */

const ERR_NOT_FOUND = -1;
const ERR_INVALID_ARGUMENT = -2;
const ERR_UNAUTHORIZED = -3;
const ERR_PERMISSION_DENIED = -4;
const ERR_UNKNOWN = -6;

import { open, popen } from "fs";

const SID_COOKIE = "webui_sid";
const TOKEN_LEN = 32;
const MAX_BODY = 1 << 20;            /* 1 MiB JSON cap (/oui-rpc) */
const MAX_UPLOAD = 16 * 1024 * 1024; /* nginx client_max_body_size */

function atoi(s) {
	let v = 0;
	for (let i = 0; i < length(s); i++) {
		let c = ord(substr(s, i, 1));
		if (c < 48 || c > 57)
			return v;
		v = v * 10 + c - 48;
	}
	return v;
}

/* POSIX single-quote escaping for the popen(/bin/sh) string form (the
 * pinned ucode has no argv-array popen): ' -> '\'' inside '...' */
function shq(s) {
	return "'" + replace(s ?? "", "'", "'\\''") + "'";
}

function log_err(fmt, args) {
	printf("webuid: " + fmt + "\n", ...(args ?? []));
}

/* 32-char token from /dev/urandom, mapped onto [0-9a-zA-Z] */
function make_token() {
	const alpha = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
	let f = open("/dev/urandom", "r");
	if (!f)
		die("cannot open /dev/urandom\n");
	let bytes = f.read(TOKEN_LEN);
	f.close();

	let tok = "";
	for (let i = 0; i < TOKEN_LEN; i++)
		tok += substr(alpha, ord(substr(bytes, i, 1)) % 62, 1);
	return tok;
}

export {
	ERR_NOT_FOUND, ERR_INVALID_ARGUMENT, ERR_UNAUTHORIZED,
	ERR_PERMISSION_DENIED, ERR_UNKNOWN,
	SID_COOKIE, MAX_BODY, MAX_UPLOAD,
	atoi, shq, log_err, make_token
};
