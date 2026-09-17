/*
 * sessions -- RAM session store + login backoff state.
 *
 * The `sessions` object identity NEVER changes (modules hold references
 * from import time): resets DELETE keys instead of replacing the object.
 */

const SESSION_TTL = 300;         /* seconds, sliding (SPA pings alive/5s) */
const SESSION_SWEEP_MS = 15000;
const MAX_FAIL_DELAY = 8;        /* seconds, exponential per-address cap */

let sessions = {};               /* token -> { user, addr, last } */
let login_fails = {};            /* addr -> { fails } */

function session_get(sid, addr) {
	let s = sessions[sid];
	if (!s)
		return null;
	if (s.addr != addr) {
		delete sessions[sid];
		return null;
	}
	s.last = time();
	return s;
}

function session_sweep() {
	let now = time();
	for (let sid in sessions)
		if (now - sessions[sid].last > SESSION_TTL)
			delete sessions[sid];
}

/* drop every session (password change / firstboot): key-delete keeps the
 * exported object identity stable for importers */
function session_reset() {
	for (let sid in sessions)
		delete sessions[sid];
	for (let addr in login_fails)
		delete login_fails[addr];
}

function login_fail(addr) {
	let f = login_fails[addr] ?? { fails: 0 };
	f.fails++;
	login_fails[addr] = f;
	return f;
}

function login_clear_fails(addr) {
	delete login_fails[addr];
}

function fail_delay(addr) {
	let f = login_fails[addr];
	if (!f)
		return 0;
	return (f.fails == 0) ? 0 : (1 << (f.fails - 1) > MAX_FAIL_DELAY)
		? MAX_FAIL_DELAY : (1 << (f.fails - 1));
}

export {
	SESSION_SWEEP_MS,
	sessions, session_get, session_sweep, session_reset,
	login_fail, login_clear_fails, fail_delay
};
