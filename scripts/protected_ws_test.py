#!/usr/bin/env python3
"""Protected-pipeline websocket tamper matrix (plan/protected-xover-pipeline.md §8.2).

Runs against a LIVE camilladsp started with --manifest and the example
protected 2-way config (configs/camilladsp_protected_2way.yaml rendered
by camilladsp-genconf). Every case sends a candidate config through the
websocket SetConfig command (the same path a third-party tool would
use) and checks that the manifest gate accepts or rejects it.

Candidates are built by editing the PARSED running config (fetched via
GetConfig), so the matrix is independent of YAML formatting.

Usage (QEMU rig, port forwarded to the host):
    python3 scripts/protected_ws_test.py [--host 127.0.0.1] [--port 5000]

Exit status: 0 = all cases passed, 1 = failures.
Requires PyYAML; the websocket client is stdlib-only.
"""

import argparse
import base64
import copy
import json
import os
import socket
import struct
import sys

import yaml

# ----------------------------------------------------------------------------
# Minimal RFC6455 websocket client (text frames only, no extensions)
# ----------------------------------------------------------------------------


class WsClient:
    def __init__(self, host, port, timeout=5.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("handshake EOF")
            resp += chunk
        if b" 101 " not in resp.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"handshake refused: {resp[:120]!r}")

    def send_text(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytearray([0x81])  # FIN + text
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("EOF")
            buf += chunk
        return buf

    def recv_text(self):
        while True:
            h = self._recv_exact(2)
            opcode = h[0] & 0x0F  # opcode: low nibble of the FIRST byte
            n = h[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            payload = self._recv_exact(n) if n else b""
            if opcode == 0x1:  # text
                return payload.decode()
            if opcode == 0x8:  # close
                raise ConnectionError("server closed")
            if opcode == 0x9:  # ping -> pong
                mask = os.urandom(4)
                pong = bytearray([0x8A, 0x80 | len(payload)]) + mask
                pong += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                self.sock.sendall(bytes(pong))

    def command(self, obj):
        self.send_text(json.dumps(obj))
        return json.loads(self.recv_text())

    def get_config(self):
        reply = self.command("GetConfig")
        if "value" not in reply.get("GetConfig", {}):
            raise RuntimeError(f"GetConfig failed: {reply}")
        return reply["GetConfig"]["value"]

    def set_config(self, yaml_text):
        """Returns (ok, message)."""
        reply = self.command({"SetConfig": yaml_text})
        res = reply.get("SetConfig", {}).get("result", "?")
        if isinstance(res, str):
            return res == "Ok", ""
        # errors arrive as {"ConfigValidationError": "..."} etc.
        if isinstance(res, dict) and res:
            kind, msg = next(iter(res.items()))
            return False, f"{kind}: {msg}"
        return False, str(res)


# ----------------------------------------------------------------------------
# Tamper matrix (structural edits of the parsed running config)
# ----------------------------------------------------------------------------

EQ1 = {
    "type": "Biquad",
    "parameters": {"type": "Peaking", "freq": 1000, "gain": 3, "q": 1},
}
EQ2 = {"type": "Gain", "parameters": {"gain": -2}}
LIM = {"type": "Limiter", "parameters": {"clip_limit": 0.5}}


def find_step(cfg, pred):
    for i, step in enumerate(cfg["pipeline"]):
        if pred(step):
            return i
    raise RuntimeError("step not found in running config")


def idx_mixer(cfg):
    return find_step(cfg, lambda s: s["type"] == "Mixer")


def idx_ph(cfg, name):
    return find_step(
        cfg, lambda s: s["type"] == "Filter" and s.get("names", [None])[0] == f"user_slot_{name}"
    )


def idx_tail(cfg, first_filter):
    return find_step(
        cfg, lambda s: s["type"] == "Filter" and first_filter in s.get("names", [])
    )


def cases(base):
    """Return [(name, expect_ok, error_substr, candidate_yaml)]."""
    b = yaml.safe_load(base)

    def variant(mut):
        c = copy.deepcopy(b)
        mut(c)
        return yaml.safe_dump(c, sort_keys=False)

    out = []
    out.append(("pristine config re-applied", True, "", variant(lambda c: None)))

    def lock_freq(c):
        c["filters"]["wf_lp"]["parameters"]["freq"] = 2500

    out.append(("locked param edited (wf_lp freq)", False, "wf_tail", variant(lock_freq)))

    def fir_path(c):
        c["filters"]["wf_fir"]["parameters"]["filename"] = "/opt/user_data/evil.txt"

    out.append(("locked FIR path swapped", False, "", variant(fir_path)))

    def del_tail(c):
        del c["pipeline"][idx_tail(c, "tw_hp")]

    out.append(("locked step deleted (tw_tail)", False, "", variant(del_tail)))

    def bypass(c):
        c["pipeline"][idx_tail(c, "wf_lp")]["bypassed"] = True

    out.append(("locked step bypassed", False, "", variant(bypass)))

    def move_locked(c):
        i, j = idx_ph(c, "user_in0"), idx_mixer(c)
        pl = c["pipeline"]
        pl[i], pl[j] = pl[j], pl[i]

    out.append(("locked step moved before user step", False, "", variant(move_locked)))

    def move_user_after_mixer(c):
        pl = c["pipeline"]
        i = idx_ph(c, "user_in0")
        ph = pl.pop(i)
        pl.insert(idx_mixer(c) + 1, ph)

    out.append(
        ("user slot moved after mixer (position lock)", False, "", variant(move_user_after_mixer))
    )

    def swap_inputs(c):
        pl = c["pipeline"]
        i, j = idx_ph(c, "user_in0"), idx_ph(c, "user_in1")
        pl[i]["names"], pl[j]["names"] = pl[j]["names"], pl[i]["names"]
        pl[i]["channels"], pl[j]["channels"] = pl[j]["channels"], pl[i]["channels"]

    out.append(("input slots swapped within slot 0", True, "", variant(swap_inputs)))

    def processor_in_slot(c):
        # a Processor step spliced into the user slot (with definition)
        c["processors"] = {
            "comp1": {
                "type": "Compressor",
                "parameters": {
                    "channels": 2, "attack": 5, "release": 50,
                    "threshold": -10, "factor": 4,
                },
            }
        }
        c["pipeline"].insert(idx_ph(c, "user_in0") + 1, {"type": "Processor", "name": "comp1"})

    out.append(("processor step added in slot", False, "", variant(processor_in_slot)))

    def after_tail(c):
        c["filters"]["user_eq2"] = dict(EQ2)
        c["pipeline"].append({"type": "Filter", "channels": [1], "names": ["user_eq2"]})

    out.append(("step appended after locked tail", False, "after the last locked", variant(after_tail)))

    def mixer_gain(c):
        # route gains are free user state (source-mix selection)
        c["mixers"]["srcmix"]["mapping"][0]["sources"][0]["gain"] = 1.0
        c["mixers"]["srcmix"]["mapping"][0]["sources"][1]["gain"] = 0.0

    out.append(("mixer route gains changed (source select)", True, "", variant(mixer_gain)))

    def mixer_structure(c):
        # structure is pinned: dropping a source route is rejected
        del c["mixers"]["srcmix"]["mapping"][1]["sources"][1]

    out.append(("mixer route removed (structure lock)", False, "mixers", variant(mixer_structure)))


    def user_eq(c):
        c["filters"]["user_eq1"] = copy.deepcopy(EQ1)
        c["pipeline"][idx_ph(c, "user_in0")]["names"].append("user_eq1")

    out.append(("user EQ in slot (legit)", True, "", variant(user_eq)))

    def wrong_channel(c):
        c["filters"]["user_eq1"] = copy.deepcopy(EQ1)
        c["pipeline"][idx_ph(c, "user_in0")]["names"].append("user_eq1")
        c["pipeline"][idx_ph(c, "user_in0")]["channels"] = [1]

    out.append(("user EQ on wrong channel", False, "", variant(wrong_channel)))

    def limiter_in_slot(c):
        c["filters"]["user_lim"] = copy.deepcopy(LIM)
        c["pipeline"][idx_ph(c, "user_in0")]["names"].append("user_lim")

    out.append(
        ("disallowed filter type in slot (Limiter)", False, "not allowed", variant(limiter_in_slot))
    )

    def omitted_channels(c):
        c["filters"]["user_eq1"] = copy.deepcopy(EQ1)
        c["pipeline"].insert(
            idx_ph(c, "user_in0") + 1, {"type": "Filter", "names": ["user_eq1"]}
        )

    out.append(("user step with omitted channels", False, "", variant(omitted_channels)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5000)
    args = ap.parse_args()

    ws = WsClient(args.host, args.port)
    base = ws.get_config()
    print(f"connected, running config: {len(base)} bytes")

    failures = 0
    matrix = cases(base)
    for name, expect_ok, substr, candidate in matrix:
        ok, msg = ws.set_config(candidate)
        good = ok == expect_ok and (ok or substr in msg)
        # after an accepted edit, restore the pristine running config
        if ok:
            rok, rmsg = ws.set_config(base)
            if not rok:
                print(f"FAIL {name}: restore rejected: {rmsg}")
                failures += 1
                continue
        print(f"{'PASS' if good else 'FAIL'} {name}: accepted={ok} {msg[:90]}")
        if not good:
            failures += 1

    # the running config must be semantically untouched after all the
    # rejections (raw text may differ: map key order is not stable)
    if yaml.safe_load(ws.get_config()) != yaml.safe_load(base):
        print("FAIL running config changed after rejected edits")
        failures += 1
    else:
        print("PASS running config unchanged after the matrix")

    print(f"{len(matrix) + 1 - failures} passed, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
