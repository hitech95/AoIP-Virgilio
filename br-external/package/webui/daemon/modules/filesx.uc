/*
 * filesx -- user uploads (FIR coefficients, EQ files) under
 * /opt/user_data/filters (UBIFS on hardware, survives factory reset).
 * Files are inert data until a conv filter references them.
 */

import { writefile, lsdir, unlink, mkdir, stat, basename } from "fs";
import { MAX_UPLOAD, ERR_INVALID_ARGUMENT } from "util";
import { http_response } from "http";

const UPLOAD_DIR = "/opt/user_data/filters";

function upload_dir_ensure() {
	try { mkdir(UPLOAD_DIR, 0755); } catch (e) {}
}

function sanitize_name(name) {
	let base = basename(name ?? "");
	let safe = "";
	for (let i = 0; i < length(base); i++) {
		let ch = substr(base, i, 1);
		if (index("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-", ch) >= 0)
			safe += ch;
	}
	safe = trim(safe, ".");
	return (length(safe) > 0 && length(safe) <= 128) ? safe : null;
}

/* parse multipart/form-data -> [{name, filename, content}] */
function multipart_parse(body, content_type) {
	let b = match(content_type ?? "", /boundary=(.+)/);
	if (!b)
		return null;
	let delim = "--" + b[1];
	let parts = split(body, delim);
	let out = [];
	for (let i = 1; i < length(parts) - 1; i++) {
		let seg = parts[i];
		if (substr(seg, 0, 2) == "\r\n")
			seg = substr(seg, 2);
		let hdr_end = index(seg, "\r\n\r\n");
		if (hdr_end < 0)
			continue;
		let headers = substr(seg, 0, hdr_end);
		let content = substr(seg, hdr_end + 4);
		/* trailing \r\n belongs to the delimiter */
		if (substr(content, length(content) - 2) == "\r\n")
			content = substr(content, 0, length(content) - 2);
		let f = match(headers, /filename="([^"]*)"/);
		let n = match(headers, /name="([^"]*)"/);
		push(out, {
			name: n ? n[1] : null,
			filename: f ? f[1] : null,
			content: content
		});
	}
	return out;
}

/* POST /oui-upload handler (reply is the connection-bound sink) */
function handle_upload(env, body, reply) {
	let parts = multipart_parse(body, env.CONTENT_TYPE);
	if (!parts || length(parts) == 0) {
		reply(http_response(400, '{"error":{"code":-2,"message":"multipart body required"}}'));
		return;
	}

	let saved = [], errors = [];
	for (let part in parts) {
		if (!part.filename)
			continue;
		let safe = sanitize_name(part.filename);
		if (!safe) {
			push(errors, `${part.filename}: bad name`);
			continue;
		}
		if (length(part.content) > MAX_UPLOAD) {
			push(errors, `${safe}: too large`);
			continue;
		}
		upload_dir_ensure();
		if (writefile(UPLOAD_DIR + "/" + safe, part.content) === false) {
			push(errors, `${safe}: write failed`);
			continue;
		}
		push(saved, { name: safe, size: length(part.content) });
	}

	let r = { saved: saved, errors: errors };
	reply(http_response(200, sprintf("%J", { result: r })));
}

function files_list() {
	upload_dir_ensure();
	let out = [];
	for (let name in sort(lsdir(UPLOAD_DIR))) {
		if (name == "." || name == "..")
			continue;
		let st = stat(UPLOAD_DIR + "/" + name);
		push(out, { name: name, size: st?.size ?? 0 });
	}
	return { files: out };
}

function files_delete(params) {
	let safe = sanitize_name(params?.name);
	if (!safe)
		return { error: { code: ERR_INVALID_ARGUMENT, message: "bad name" } };
	try { unlink(UPLOAD_DIR + "/" + safe); } catch (e) {}
	return {};
}

export { handle_upload, files_list, files_delete };
