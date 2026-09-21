/* mods_logs -- BE module of webui-app-logs: RAM ring buffer tail via
 * logread, polled by the logs view. */

import { popen } from "fs";

function read_logs(n) {
	/* logread dumps the RAM ring buffer; tail the last n lines */
	let p = popen(`logread`, "r");
	if (!p)
		return "";
	let out = p.read(256 * 1024);
	p.close();
	let lines = split(out ?? "", "\n");
	if (length(lines) > n)
		lines = slice(lines, length(lines) - n);
	return join("\n", lines);
}

const logs_module = {
	logs: {
		read: (params) => read_logs(min(params?.n ?? 200, 1000))
	}
};

export { logs_module };
