/* http -- raw HTTP response building (SCGI apps speak full HTTP back
 * to nginx) and cookie parsing. */

function http_response(status, body, type, extra_headers) {
	const reason = {
		"200": "OK", "204": "No Content", "400": "Bad Request",
		"401": "Unauthorized", "403": "Forbidden", "404": "Not Found",
		"405": "Method Not Allowed", "413": "Payload Too Large",
		"500": "Internal Server Error"
	};

	if (body == null)
		body = "";

	let head = `HTTP/1.1 ${status} ${reason["" + status] ?? "Error"}\r\n` +
		`Content-Type: ${type ?? "application/json"}\r\n` +
		`Content-Length: ${length(body)}\r\n` +
		`Connection: close\r\n`;
	for (let h in extra_headers ?? [])
		head += h + "\r\n";
	return head + "\r\n" + body;
}

function cookie_value(cookie_hdr, name) {
	for (let part in split(cookie_hdr ?? "", ";")) {
		let kv = split(trim(part), "=");
		if (length(kv) == 2 && kv[0] == name)
			return kv[1];
	}
	return null;
}

export { http_response, cookie_value };
