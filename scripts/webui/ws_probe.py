#!/usr/bin/env python3
"""Raw WebSocket handshake probe: sends GET with Upgrade headers to
host:port/path (+ optional Cookie) and prints the HTTP status line."""
import socket, sys

host, port, path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cookie = sys.argv[4] if len(sys.argv) > 4 else None

req = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\n"
       "Upgrade: websocket\r\nConnection: Upgrade\r\n"
       "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
       "Sec-WebSocket-Version: 13\r\n"
       + (f"Cookie: {cookie}\r\n" if cookie else "")
       + "\r\n")

s = socket.create_connection((host, port), timeout=10)
s.sendall(req.encode())
s.settimeout(10)
try:
    data = s.recv(4096)
except socket.timeout:
    data = b"<timeout>"
print(data.split(b"\r\n")[0].decode(errors="replace") if data else "<empty>")
s.close()
