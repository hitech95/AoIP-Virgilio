#!/usr/bin/env python3
"""Minimal expect-style driver for a QEMU guest telnet serial console.

Drives guests started with `run-qemu.sh --console telnet:PORT` (tests must
not need root and must survive headless/CI runs — plan.md §10 "tests must
not need root"). Protocol on stdout for the orchestrating shell:

    @@BEGIN <name> <rc|TIMEOUT>
    ...captured console output...
    @@END <name>

Script file (one command per line, '#' comments allowed):

    ready  <token> <total_timeout_s>   # poll-send `echo <token>` until the
                                       # login shell round-trips it (handles
                                       # input lost before askconsole spawns)
    await  <regex> <timeout_s>         # wait for the regex in the stream
    sleep  <seconds>
    send   <raw line>                  # send a line, no sentinel
    exec   <name> <timeout_s> <cmd...> # run cmd, capture output + rc via an
                                       # `echo __VRC<n>__=$?` sentinel

Sentinel safety: the echoed command line contains `__VRC<n>__=$?` while the
result line contains digits, so only the result matches ^__VRC<n>__=<digits>.
"""

import argparse
import re
import socket
import sys
import time

IAC = 0xFF


class Console:
    def __init__(self, port, connect_timeout=90, transcript=None):
        self.buf = ""
        self.raw = b""
        self.deadline = time.monotonic() + connect_timeout
        self.sock = None
        last_err = None
        while time.monotonic() < self.deadline:
            try:
                s = socket.create_connection(("127.0.0.1", port), timeout=3)
                s.settimeout(0.5)
                self.sock = s
                break
            except OSError as e:
                last_err = e
                time.sleep(0.5)
        if self.sock is None:
            raise SystemExit(f"qemu_console: cannot connect to 127.0.0.1:{port}: {last_err}")
        self.tf = open(transcript, "ab") if transcript else None

    # -- telnet filtering ----------------------------------------------------
    def _pump(self):
        try:
            data = self.sock.recv(65536)
        except socket.timeout:
            return
        except OSError:
            return
        if not data:
            return
        if self.tf:
            self.tf.write(data)
            self.tf.flush()
        self.raw += data
        # strip telnet IAC sequences (QEMU sends a few at connect time)
        out = bytearray()
        i = 0
        n = len(self.raw)
        while i < n:
            b = self.raw[i]
            if b == IAC:
                if i + 1 >= n:
                    break  # partial sequence: wait for more bytes
                c = self.raw[i + 1]
                if c == IAC:
                    out.append(IAC)
                    i += 2
                elif c in (0xFB, 0xFC, 0xFD, 0xFE):  # WILL/WONT/DO/DONT
                    i += 3 if i + 2 < n else n  # tolerate partial
                else:
                    i += 2
            else:
                out.append(b)
                i += 1
        self.raw = self.raw[i:]
        self.buf += out.decode("latin-1")

    def wait_re(self, pattern, timeout):
        rx = re.compile(pattern)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            m = rx.search(self.buf)
            if m:
                return m
            self._pump()
            time.sleep(0.1)
        return None

    def send(self, line):
        try:
            self.sock.sendall(line.encode("latin-1") + b"\n")
        except OSError as e:
            raise SystemExit(f"qemu_console: console closed (QEMU/guest died?): {e}")

    def run(self, name, cmd, timeout):
        self._exec_n = getattr(self, "_exec_n", 0) + 1
        n = self._exec_n
        start = len(self.buf)
        sent = f"{cmd}; echo __VRC{n}__=$?"
        self.send(sent)
        m = self.wait_re(rf"__VRC{n}__=([0-9]+)", timeout)
        if m is None:
            print(f"@@BEGIN {name} TIMEOUT")
            print(self.buf[start:][-2000:])
            print(f"@@END {name}")
            return False
        out = self.buf[start:m.start()]
        # normalize console line endings (\r\n / wrapped \r) for consumers
        out = out.replace("\r\n", "\n").replace("\r", "")
        # drop the echoed command (first line) if it is still at the top
        if out.startswith(cmd.split(";")[0][:40]):
            nl = out.find("\n")
            if nl > 0:
                out = out[nl + 1:]
        print(f"@@BEGIN {name} {m.group(1)}")
        print(out.rstrip("\r\n"))
        print(f"@@END {name}")
        sys.stdout.flush()
        return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--script", required=True)
    ap.add_argument("--transcript")
    args = ap.parse_args()

    con = Console(args.port, transcript=args.transcript)

    for raw in open(args.script):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 3)
        op = parts[0]
        if op == "ready":
            token, total = parts[1], float(parts[2])
            deadline = time.monotonic() + total
            ok = False
            while time.monotonic() < deadline:
                con.send(f"echo {token}")
                # response line is the bare token (the echoed command line
                # starts with "echo", so it cannot match)
                if con.wait_re(rf"(?m)^{token}\r?$", 4):
                    ok = True
                    break
            if not ok:
                raise SystemExit("qemu_console: shell never became ready")
            print(f"@@READY {token}")
        elif op == "await":
            rest = line.split(None, 1)[1]
            pat, tmo = rest.rsplit(None, 1)
            if con.wait_re(pat, float(tmo)) is None:
                raise SystemExit(f"qemu_console: await timeout: {pat}")
            print(f"@@AWAITED {pat}")
        elif op == "sleep":
            time.sleep(float(parts[1]))
        elif op == "send":
            con.send(line.split(None, 1)[1])
        elif op == "exec":
            name, tmo, cmd = parts[1], float(parts[2]), parts[3]
            if not con.run(name, cmd, tmo):
                raise SystemExit(f"qemu_console: exec timed out: {name}")
        else:
            raise SystemExit(f"qemu_console: unknown op: {op}")


if __name__ == "__main__":
    main()
