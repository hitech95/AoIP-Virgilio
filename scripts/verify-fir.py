#!/usr/bin/env python3
"""Verify the M3 file->file FIR pipeline output (see plan/plan.md M3 DoD).

Expected chain (mirrors /etc/config/camilladsp test settings):
  test.wav (S16LE stereo) -> Gain(-3 dB, f32) -> Conv(fir.txt, f32) -> out.wav (F32_LE)

Usage: verify-fir.py OUT.wav [GAIN_DB]
Exit 0 = PASS (max abs diff within tolerance).
"""
import struct
import sys

import numpy as np

HERE = "br-external/board/rk3506qemu/rootfs-overlay/usr/share/camilladsp"
TOL = 5e-4  # camilladsp uses FFT convolution (f32); allow small numeric slack


def read_wav(path):
    """Minimal RIFF parser: returns (channels, dtype, data) for PCM16/float32."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file")
    pos = 12
    fmt = None
    data = None
    while pos + 8 <= len(raw):
        cid, sz = struct.unpack_from("<4sI", raw, pos)
        body = raw[pos + 8 : pos + 8 + sz]
        if cid == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", body)
        elif cid == b"data":
            data = body
        pos += 8 + sz + (sz & 1)
    if fmt is None or data is None:
        raise ValueError("missing fmt/data chunk")
    tag, ch, _rate, _bps, _blk, bits = fmt
    if tag == 1 and bits == 16:
        return ch, "<i2", data
    if tag == 3 and bits == 32:
        return ch, "<f4", data
    raise ValueError(f"unsupported wav: tag={tag} bits={bits}")


def main():
    out_path = sys.argv[1]
    gain_db = float(sys.argv[2]) if len(sys.argv) > 2 else -3.0

    ch, dtype, raw = read_wav(f"{HERE}/test.wav")
    assert ch == 2 and dtype == "<i2"
    x = np.frombuffer(raw, dtype="<i2").reshape(-1, 2).astype(np.float32) / 32768.0

    fir = np.loadtxt(f"{HERE}/fir.txt").astype(np.float32)
    g = np.float32(10.0 ** (gain_db / 20.0))

    # reference: gain then direct convolution, float32 accumulation
    ref = np.empty_like(x)
    for c in range(2):
        v = (x[:, c] * g).astype(np.float32)
        ref[:, c] = np.convolve(v, fir).astype(np.float32)[: len(v)]

    nch, dtype, raw = read_wav(out_path)
    y = np.frombuffer(raw, dtype=dtype).reshape(-1, nch).astype(np.float32)
    if dtype == "<i2":
        y /= np.float32(32768.0)

    n = min(len(y), len(ref))
    if n == 0 or abs(len(y) - len(ref)) > 2048:
        print(f"FAIL: length mismatch: got {len(y)}, expected {len(ref)}")
        return 1
    d = np.abs(y[:n] - ref[:n])
    print(f"samples={n}/{len(ref)} ch={nch} dtype={dtype} maxdiff={d.max():.3e} rms={np.sqrt((d**2).mean()):.3e}")
    if d.max() > TOL:
        print("FAIL: max diff above tolerance", TOL)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
