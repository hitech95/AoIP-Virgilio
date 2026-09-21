/*
 * scgix -- generic non-blocking SCGI server on uloop (the ptp-monitor
 * socket pattern). Route injection keeps this file free of any
 * application imports: scgi_serve(sock_path, route) where
 *
 *   route(env, body, reply, uri) -> response-string | null
 *
 * (null = the route answered asynchronously via the reply sink, e.g.
 * the login backoff timer; exceptions inside route are caught here and
 * answered 500 -- a handler bug never kills the daemon).
 */

import * as socket from "socket";
import * as uloop from "uloop";
import { unlink, popen } from "fs";
import { atoi, shq, log_err, MAX_BODY, MAX_UPLOAD } from "util";
import { http_response } from "http";

/* connection table: fileno -> { conn, buf, out, parsed, rd_handle, wr_handle } */
let conns = {};

function conn_close(fd) {
	let c = conns[fd];
	if (!c)
		return;
	if (c.rd_handle)
		c.rd_handle.delete();
	if (c.wr_handle)
		c.wr_handle.delete();
	try { c.conn.close(); } catch (e) {}
	delete conns[fd];
}

function conn_flush(fd) {
	let c = conns[fd];
	if (!c)
		return;

	while (length(c.out) > 0) {
		let n;
		try {
			n = c.conn.send(c.out);
		} catch (e) {
			break;                       /* EAGAIN: rearm WRITE below */
		}
		if (!n || n <= 0)
			break;                       /* would block: rearm below */
		c.out = substr(c.out, n);
	}

	if (length(c.out) > 0 && !c.wr_handle) {
		c.wr_handle = uloop.handle(fd, (events) => {
			if (events & uloop.ULOOP_WRITE)
				conn_flush(fd);
		}, uloop.ULOOP_WRITE);
	} else if (length(c.out) == 0) {
		conn_close(fd);                /* Connection: close semantics */
	}
}

function conn_send(fd, data) {
	let c = conns[fd];
	if (!c)
		return;
	c.out += data;
	conn_flush(fd);
}

/* parse "len:KEY\0VALUE\0..." netstring into { env, total }
 * where total = netstring extent + CONTENT_LENGTH body bytes */
function scgi_parse(buf) {
	let colon = index(buf, ":");
	if (colon < 0)
		return null;

	let hlen = atoi(substr(buf, 0, colon));
	if (hlen <= 0 || length(buf) < colon + 1 + hlen + 1)
		return null;                  /* headers not fully received */

	let start = colon + 1;
	let end = start + hlen;
	if (substr(buf, end, 1) != ",")
		return null;

	let env = {};
	let cur = "";
	for (let i = start; i < end; i++) {
		if (substr(buf, i, 1) == "\x00") {
			/* key scanned; find value up to next NUL */
			let v = index(substr(buf, i + 1), "\x00");
			if (v < 0)
				return null;
			env[cur] = substr(buf, i + 1, v);
			i = i + 1 + v;
			cur = "";
		} else {
			cur += substr(buf, i, 1);
		}
	}

	let clen = atoi(env.CONTENT_LENGTH ?? "0");
	let total = end + 1 + clen;
	return { env: env, total: total, body_len: clen };
}

function make_conn_readable(route) {
	return function(fd) {
		let c = conns[fd];
		if (!c)
			return;

		let d;
		try {
			d = c.conn.recv(16384);
		} catch (e) {
			return;                     /* EAGAIN / spurious wakeup */
		}
		if (d == null || length(d) == 0) {  /* EOF: peer closed */
			conn_close(fd);
			return;
		}
		c.buf += d;

		if (length(c.buf) > MAX_UPLOAD + 65536) {
			conn_send(fd, http_response(413, '{"error":{"code":-2,"message":"too large"}}'));
			return;
		}

		if (c.parsed)
			return;                     /* body still streaming in */

		let p = scgi_parse(c.buf);
		if (!p)
			return;                     /* need more bytes */
		c.parsed = true;

		let uri_early = p.env.DOCUMENT_URI ?? p.env.PATH_INFO ?? "";
		let cap = (uri_early == "/oui-upload") ? MAX_UPLOAD : MAX_BODY;
		if (p.body_len > cap) {
			conn_send(fd, http_response(413, '{"error":{"code":-2,"message":"too large"}}'));
			return;
		}
		if (length(c.buf) < p.total)
			return;                     /* body incomplete */

		let body = substr(c.buf, p.total - p.body_len, p.body_len);
		let uri = p.env.DOCUMENT_URI ?? p.env.PATH_INFO ?? "";

		/* dispatch guarded: a handler bug answers 500, never kills us */
		let resp;
		try {
			let reply = (r) => conn_send(fd, r);   /* connection-bound sink */
			resp = route(p.env, body, reply, uri);
		} catch (e) {
			log_err("dispatch %s threw: %s", [uri, e?.message ?? e]);
			resp = http_response(500, '{"error":{"code":-6,"message":"internal error"}}');
		}

		if (resp != null)
			conn_send(fd, resp);
	};
}

/* bind + listen + uloop registration; returns the listener socket */
function scgi_serve(sock_path, route) {
	try { unlink(sock_path); } catch (e) {}

	let srv = socket.create(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_NONBLOCK);
	srv.bind(sock_path);
	srv.listen(16);

	/* nginx workers run www-data (gid 33): 0660 root:www-data */
	try {
		let p = popen(`chown 0:33 ${shq(sock_path)}`, "r");
		if (p) p.close();
		let q = popen(`chmod 660 ${shq(sock_path)}`, "r");
		if (q) q.close();
	} catch (e) {
		log_err("cannot set socket ownership: %s", [e?.message ?? e]);
	}

	let conn_readable = make_conn_readable(route);

	uloop.handle(srv.fileno(), (events) => {
		if (events & uloop.ULOOP_READ) {
			let conn;
			try {
				conn = srv.accept(null, socket.SOCK_NONBLOCK);
			} catch (e) {
				return;
			}
			if (!conn)
				return;

			let fd = conn.fileno();
			let c = { conn: conn, buf: "", out: "", parsed: false, rd_handle: null, wr_handle: null };
			conns[fd] = c;
			c.rd_handle = uloop.handle(fd, (events) => {
				if (events & uloop.ULOOP_READ)
					conn_readable(fd);
			}, uloop.ULOOP_READ);
		}
	}, uloop.ULOOP_READ);

	return srv;
}

export { scgi_serve };
