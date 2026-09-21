/*
 * rpc -- the /oui-rpc JSON dispatch (login/logout/alive/call) and the
 * /_auth endpoint for nginx auth_request.
 *
 * handle_rpc's reply() is a sink bound to the connection fd so that
 * deferred answers (login backoff timer) still reach the client -- a
 * plain return value would be lost once handle_rpc has exited.
 */

import * as uloop from "uloop";
import { log_err, make_token, SID_COOKIE,
         ERR_INVALID_ARGUMENT, ERR_NOT_FOUND, ERR_UNKNOWN } from "util";
import { http_response, cookie_value } from "http";
import { sessions, session_get, login_fail, login_clear_fails, fail_delay } from "sessions";
import { verify_password } from "auth";
import { webui_tls_enabled } from "ucix";
import { rpc_modules } from "rpcmods";

/* functions callable WITHOUT a session (OUI's no-auth concept, minimal):
 * ui.get_locale/get_theme run pre-login (the shell loads them before the
 * login page renders); firstboot_status leaks only "root password unset";
 * firstboot re-checks its precondition (empty hash) inside and refuses
 * afterwards. */
const RPC_NO_AUTH = {
	"ui.get_locale": 1,
	"ui.get_theme": 1,
	"webui.firstboot_status": 1,
	"webui.firstboot": 1
};

/* auth_request target: original client addr + cookie only */
function handle_auth(env) {
	let sid = cookie_value(env.HTTP_COOKIE, SID_COOKIE);
	if (sid && session_get(sid, env.REMOTE_ADDR ?? ""))
		return http_response(204, null);
	return http_response(403, null);
}

function rpc_login(params, addr, reply) {
	let user = params?.username;
	let password = params?.password;

	if (type(user) != "string" || type(password) != "string" ||
	    !user || !password) {
		reply(http_response(400, '{"error":{"code":-2,"message":"username and password required"}}'));
		return;
	}

	/* single admin account for v1 (plan §3): root only */
	if (user != "root") {
		reply(http_response(401, '{"error":{"code":-3,"message":"not permitted"}}'));
		return;
	}

	let verdict = verify_password(user, password);
	if (verdict == "empty") {
		/* first boot: no root password set -- the login page switches to
		 * its set-password flow (webui.firstboot); no rate-limit burn */
		reply(http_response(401,
			'{"error":{"code":-1001,"message":"firstboot: set a root password"}}'));
		return;
	}
	if (verdict != "ok") {
		login_fail(addr);

		/* non-blocking backoff: answer late, never block the loop */
		let delay_ms = fail_delay(addr) * 1000;
		uloop.timer(delay_ms, () => {
			reply(http_response(401,
				`{"error":{"code":-3,"message":"login failed"}}`));
		});
		return;
	}

	login_clear_fails(addr);

	let sid = make_token();
	sessions[sid] = { user: user, addr: addr ?? "", last: time() };

	let body = sprintf("%J", { sid: sid });
	let cookie = `Set-Cookie: ${SID_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict` +
		(webui_tls_enabled() ? "; Secure" : "");
	reply(http_response(200, body, "application/json", [cookie]));
}

function rpc_call(params, addr) {
	if (type(params) != "array" || length(params) < 3)
		return http_response(400,
			'{"error":{"code":-2,"message":"call expects [sid, mod, func, params]"}}');

	let sid = params[0], mod = params[1], func = params[2], args = params[3] ?? {};
	if (RPC_NO_AUTH[`${mod}.${func}`] == null && !session_get(sid, addr ?? ""))
		return http_response(401, '{"error":{"code":-3,"message":"unauthorized"}}');

	let m = rpc_modules[mod];
	if (!m || !m[func])
		return http_response(404,
			`{"error":{"code":-1,"message":"no such module function ${mod}.${func}"}}`);

	let r;
	try {
		r = m[func](args);
	} catch (e) {
		log_err("rpc %s.%s threw: %s", [mod, func, e?.message ?? e]);
		return http_response(500, '{"error":{"code":-6,"message":"internal error"}}');
	}

	/* modules may return { error: {...} } (soft) or plain data */
	return http_response(200, sprintf("%J", { result: r ?? {} }));
}

function handle_rpc(env, body, reply) {
	let req;
	try {
		req = json(body);
	} catch (e) {
		log_err("json parse failed: %s [body: %s]", [e?.message ?? e, body]);
		reply(http_response(400, '{"error":{"code":-2,"message":"bad JSON"}}'));
		return;
	}
	if (type(req) != "object") {
		reply(http_response(400, '{"error":{"code":-2,"message":"bad request"}}'));
		return;
	}

	let addr = env.REMOTE_ADDR ?? "";

	switch (req.method) {
		case "login":
			rpc_login(req.params, addr, reply);
			break;

		case "logout":
			if (req.params?.sid)
				delete sessions[req.params.sid];
			reply(http_response(200, sprintf("%J", {})));
			break;

		case "alive":
			let alive = !!(req.params?.sid &&
				session_get(req.params.sid, addr));
			reply(http_response(200, sprintf("%J", { alive: alive })));
			break;

		case "call":
			reply(rpc_call(req.params, addr));
			break;

		default:
			reply(http_response(404,
				`{"error":{"code":-1,"message":"unknown method ${req.method}"}}`));
	}
}

export { handle_rpc, handle_auth };
