#!/usr/bin/env python3
"""Minimal SCGI client for testing webuid (speaks what nginx scgi_pass sends)."""
import socket, sys, json

def scgi_request(sock_path, uri, method="POST", body=b"", headers=None):
    env = {
        "CONTENT_LENGTH": str(len(body)),
        "CONTENT_TYPE": "application/json",
        "DOCUMENT_URI": uri,
        "GATEWAY_INTERFACE": "SCGI/1.0",
        "QUERY_STRING": "",
        "REMOTE_ADDR": "127.0.0.1",
        "REQUEST_METHOD": method,
        "REQUEST_URI": uri,
        "SERVER_PROTOCOL": "HTTP/1.1",
    }
    env.update(headers or {})
    payload = b"".join(k.encode() + b"\0" + v.encode() + b"\0" for k, v in env.items())
    netstring = str(len(payload)).encode() + b":" + payload + b","
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(10)
    s.connect(sock_path)
    s.sendall(netstring + body)
    out = b""
    while True:
        try:
            d = s.recv(65536)
        except socket.timeout:
            break
        if not d:
            break
        out += d
        # naive: read until connection closes (Connection: close)
    s.close()
    return out

if __name__ == "__main__":
    sock = sys.argv[1]
    uri = sys.argv[2]
    method = sys.argv[3] if len(sys.argv) > 3 else "POST"
    data = sys.stdin.buffer.read() if not sys.stdin.isatty() else b""
    hdrs = {}
    if len(sys.argv) > 4:
        hdrs["HTTP_COOKIE"] = sys.argv[4]
    resp = scgi_request(sock, uri, method, data, hdrs)
    sys.stdout.write(resp.decode(errors="replace"))
