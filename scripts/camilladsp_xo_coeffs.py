#!/usr/bin/env python3
"""
Generate CamillaDSP Freeform-biquad coefficients replicating the passive
crossover of the SB Acoustics SB12PACR25-4-COAX coaxial driver, for an
arbitrary sample rate.

Passive network (from schematic):
  Tweeter: C1 5.6uF (series) -> L2 180uH/0.38R (shunt) -> C3 15uF (series) -> tweeter
  Woofer : L1 560uH/0.21R (series) -> C2 12uF (shunt) -> woofer
  R1 560R across the amplifier output is electrically negligible (not modelled).

Driver load models:  woofer Re=3.1 + Le=0.25mH,  tweeter Re=3.0 (Le unspecified).

Analog transfer functions (voltage divider, s in rad/s):

  Woofer  H_W(s) = Zp/(ZL1 + Zp),  Zp = Zw || ZC2
         = (ReW + s*LeW) / (d3 s^3 + d2 s^2 + d1 s + d0)
    d3 = L1*LeW*C2
    d2 = RL1*LeW*C2 + L1*ReW*C2
    d1 = RL1*ReW*C2 + L1 + LeW
    d0 = RL1 + ReW

  Tweeter H_T(s) = ZA/(ZC1 + ZA),  ZA = (ZC3 + Rt) || ZL2
         = C1*(n1 s + n2 s^2 + n3 s^3) / (1 + d1 s + d2 s^2 + d3 s^3)
    n1 = C1*RL2
    n2 = C1*(RL2*Rt*C3 + L2)
    n3 = C1*L2*Rt*C3
    d1 = Rt*C3 + RL2*C3 + C1*RL2
    d2 = L2*C3 + C1*(RL2*Rt*C3 + L2)
    d3 = C1*L2*Rt*C3

Factorisation into biquad sections (poles/zeros via np.roots):

  Woofer: zero at wz = ReW/LeW, real pole wp1, complex pair (w0, Q), DC gain g
    W1(s) = (1 + s/wz)/(1 + s/wp1)                       (1st-order shelf, padded)
    W2(s) = g/(1 + s/(Q*w0) + (s/w0)^2)                  (2nd-order lowpass)
  Tweeter: real pole pt, quadratic num/den after division by (s+pt)
    T1(s) = s/(s+pt)                                      -> native HighpassFO @ pt/2pi
    T2(s) = (b0q + b1q s + s^2)/(a0q + a1q s + s^2)

Bilinear transform s -> K(z-1)/(z+1), K = 2*fs; each s-domain section
N(s)/D(s) of degree m maps to N'(z) = sum_i c_i K^i (z-1)^i (z+1)^(m-i).
Degree<2 polynomials are padded with (z+1) factors (exact cancellation).
Biquad form: H(z) = (b0 + b1 z^-1 + b2 z^-2)/(1 + a1 z^-1 + a2 z^-2).

Frequency pre-warping: CamillaDSP's NATIVE biquad types (HighpassFO etc.)
pre-warp internally (biquad.rs: k = tan(omega/2)), which lands their corner
exactly at the requested frequency but tilts the level of everything below
it when mixed with plain-bilinear sections. For a consistent replica ALL
sections therefore use the SAME plain bilinear map (features land at
digital frequency 2*atan(w/K), relative levels and the branch sum are
preserved). t1 is thus emitted as a Freeform biquad (b2=a2=0), NOT as a
native HighpassFO. --prewarp is available for experimenting with per-root
pre-warping (all sections pre-warped consistently), but is not recommended
for this network.
"""
import argparse
import numpy as np

# ---------------- passive network + driver model (edit here) ----------------
C1, C3, L2, RL2 = 5.6e-6, 15e-6, 180e-6, 0.38      # tweeter branch
C2, L1, RL1 = 12e-6, 560e-6, 0.21                  # woofer branch
RE_W, LE_W = 3.1, 0.25e-3                          # woofer Re [ohm], Le [H]
RE_T, LE_T = 3.0, 0.0                              # tweeter Re, Le (not in datasheet)

DEFAULT_FS = [44100, 48000, 88200, 96000, 176400, 192000]


def woofer_tf():
    num = np.array([RE_W, LE_W])
    den = np.array([
        RL1 + RE_W,
        RL1 * RE_W * C2 + L1 + LE_W,
        RL1 * LE_W * C2 + L1 * RE_W * C2,
        L1 * LE_W * C2,
    ])
    return num, den


def tweeter_tf():
    n1 = C1 * RL2
    n2 = C1 * (RL2 * RE_T * C3 + L2)
    n3 = C1 * L2 * RE_T * C3
    num = np.array([0.0, n1, n2, n3])
    den = np.array([
        1.0,
        RE_T * C3 + RL2 * C3 + C1 * RL2,
        L2 * C3 + C1 * (RL2 * RE_T * C3 + L2),
        n3,
    ])
    return num, den


def polyval_asc(coeffs, x):
    return sum(c * x**i for i, c in enumerate(coeffs))


def mag_db(num, den, f):
    s = 1j * 2 * np.pi * np.asarray(f, dtype=float)
    return 20 * np.log10(np.abs(polyval_asc(num, s) / polyval_asc(den, s)))


def factorise():
    """Split both branch TFs into documented first/second-order sections."""
    wnum, wden = woofer_tf()
    wz = wnum[0] / wnum[1]                                  # real zero [rad/s]
    wp_roots = np.roots(wden[::-1])
    real_p = wp_roots[np.abs(wp_roots.imag) < 1e-6].real[0]
    pair = [r for r in wp_roots if abs(r.imag) >= 1e-6][0]
    w0, qw = abs(pair), abs(pair) / (2 * abs(pair.real))
    g_dc = wnum[0] / wden[0]
    W1 = (np.array([1.0, 1.0 / wz]), np.array([1.0, 1.0 / (-real_p)]))
    W2 = (np.array([g_dc * w0**2]), np.array([w0**2, w0 / qw, 1.0]))

    tnum, tden = tweeter_tf()
    tp_roots = np.roots(tden[::-1])
    real_t = tp_roots[np.abs(tp_roots.imag) < 1e-6].real[0]
    pt = -real_t
    # synthetic division of den by (s + pt), descending, normalised monic
    d_desc = tden[::-1] / tden[-1]
    q1 = d_desc[1] - pt
    q0 = d_desc[2] - pt * q1
    rem = d_desc[3] - pt * q0
    assert abs(rem) < 1e-6 * abs(d_desc[3]), "tweeter division remainder"
    qn_asc = np.array([tnum[1] / tnum[3], tnum[2] / tnum[3], 1.0])
    T2 = (qn_asc, np.array([q0, q1, 1.0]))

    info = dict(
        wz=wz, wp1=-real_p, w0=w0, qw=qw, g_dc=g_dc, pt=pt,
        wzeros=np.roots(tnum[::-1]),
    )
    return (W1, W2), (None, T2), info


def _pow(base, p):
    out = np.array([1.0])
    for _ in range(p):
        out = np.convolve(out, base)
    return out


def warp(w, fs):
    """Pre-warp an angular frequency so it lands exactly at w/fs digitally."""
    K = 2.0 * fs
    return K * np.tan(np.asarray(w, dtype=float) / K)


def build_sections(fs, prewarp=True):
    """Return (W1, W2, T2, pt) sections for coefficient generation at fs.

    With prewarp=True every root frequency is warped by K*tan(w/K) so the
    bilinear-transformed biquad matches the analog response at that
    frequency exactly (CamillaDSP-native HighpassFO convention).
    """
    (W1, W2), (_, T2), info = SECTIONS
    if not prewarp:
        return (W1, W2, T2), info["pt"]
    wz_p = warp(info["wz"], fs)
    wp1_p = warp(info["wp1"], fs)
    w0_p = warp(info["w0"], fs)
    W1p = (np.array([1.0, 1.0 / wz_p]), np.array([1.0, 1.0 / wp1_p]))
    W2p = (np.array([info["g_dc"] * w0_p**2]),
           np.array([w0_p**2, w0_p / info["qw"], 1.0]))
    z1, z2 = sorted(abs(z.real) for z in info["wzeros"] if abs(z) > 1e-9)
    z1p, z2p = warp(z1, fs), warp(z2, fs)
    wq_p = warp(np.sqrt(T2[1][0]), fs)
    T2p = (np.array([z1p * z2p, z1p + z2p, 1.0]),
           np.array([wq_p**2, wq_p / (np.sqrt(T2[1][0]) / T2[1][1]), 1.0]))
    return (W1p, W2p, T2p), warp(info["pt"], fs)


def bilinear(section, fs):
    """Bilinear-transform an s-domain section to Freeform biquad coefficients."""
    K = 2.0 * fs

    def transform(cs):
        m = len(cs) - 1
        out = np.zeros(m + 1)
        for i, c in enumerate(cs):
            out = out + c * K**i * np.convolve(_pow([-1.0, 1.0], i), _pow([1.0, 1.0], m - i))
        return out

    nz, dz = transform(section[0]), transform(section[1])
    while len(nz) < 3:
        nz = np.convolve(nz, [1.0, 1.0])
    while len(dz) < 3:
        dz = np.convolve(dz, [1.0, 1.0])
    k = 1.0 / dz[-1]
    return dict(b=k * nz[::-1], a1=k * dz[1], a2=k * dz[0])


def t1_biquad(pt_w, fs):
    """Bilinear biquad of s/(s+pt_w). With pt_w = warp(pt) this equals
    CamillaDSP's native HighpassFO at pt/2pi exactly (same k=tan(w/2) form)."""
    K = 2.0 * fs
    g = K / (K + pt_w)
    return dict(b=np.array([g, -g, 0.0]), a1=(pt_w - K) / (pt_w + K), a2=0.0)


def biquad_cplx(c, f, fs):
    z = np.exp(-1j * 2 * np.pi * np.asarray(f, dtype=float) / fs)
    num = c["b"][0] + c["b"][1] * z + c["b"][2] * z**2
    den = 1.0 + c["a1"] * z + c["a2"] * z**2
    return num / den


def analog_response(f):
    wnum, wden = woofer_tf()
    tnum, tden = tweeter_tf()
    s = 1j * 2 * np.pi * np.asarray(f, dtype=float)
    return (polyval_asc(wnum, s) / polyval_asc(wden, s),
            polyval_asc(tnum, s) / polyval_asc(tden, s))


def digital_response(fs, f, prewarp=True):
    """Complex responses (woofer, tweeter) of the biquad cascade at fs."""
    (W1, W2, T2), pt_w = build_sections(fs, prewarp)
    w = biquad_cplx(bilinear(W1, fs), f, fs) * biquad_cplx(bilinear(W2, fs), f, fs)
    t = biquad_cplx(t1_biquad(pt_w, fs), f, fs) * biquad_cplx(bilinear(T2, fs), f, fs)
    return w, t


def crossings_3db(num, den, flo=20.0, fhi=20000.0):
    f = np.logspace(np.log10(flo), np.log10(fhi), 4000)
    y = mag_db(num, den, f) + 3.0
    out = []
    for i in range(len(f) - 1):
        if y[i] * y[i + 1] < 0:
            t = y[i] / (y[i] - y[i + 1])
            out.append(f[i] * (f[i + 1] / f[i]) ** t)
    return out


def fmt(x, nd=6):
    return f"{x:.{nd}g}"


def native_params():
    """Derive Fs-independent native CamillaDSP filter parameters.

    Mapping (from CamillaDSP biquad.rs formulas):
      W1 (s+z)/(s+p)            -> HighshelfFO: corner = sqrt(p*z)/2pi,
                                   gain = 20*log10(p/z)
      W2 pair + DC gain g       -> Lowpass{f0, Q} + Gain 20*log10(g)
      T1 real pole p            -> HighpassFO{p/2pi}
      T2 (s+z1)(s+z2)/(pair)    -> Highpass{f0q,Qq} + two LowshelfFO
                                   (each factor (1+w/s): zero at w, LF gain
                                   G_dB -> pole = w/10^(G/10),
                                   corner = w/10^(G/20))
    Shelf LF gains chosen: 20 dB (upper), 6 dB (lower) -> saturation poles
    at 353.7 Hz / 168.4 Hz, far below the tweeter passband.
    """
    info = SECTIONS[2]
    (W1, W2), (_, T2), _ = SECTIONS
    _, _, qden = W2[1][0], W2[1][1], W2[1][2]
    f0w, qw = info["w0"] / 2 / np.pi, info["qw"]
    wp1, wz = info["wp1"], info["wz"]
    z1, z2 = sorted(abs(z.real) for z in info["wzeros"] if abs(z) > 1e-9)
    f0q = np.sqrt(T2[1][0])
    Qq = f0q / T2[1][1]
    g2, g1 = 20.0, 6.0
    a2 = 10 ** (g2 / 40.0)
    a1 = 10 ** (g1 / 40.0)
    return dict(
        w1=dict(freq=np.sqrt(wp1 * wz) / 2 / np.pi,
                gain=20 * np.log10(wp1 / wz)),
        w2=dict(freq=f0w, q=qw, gain=20 * np.log10(info["g_dc"])),
        t1=dict(freq=info["pt"] / 2 / np.pi),
        t2_hp=dict(freq=f0q / 2 / np.pi, q=Qq),
        t2_shelf2=dict(freq=z2 / a2 / 2 / np.pi, gain=g2, pole=z2 / a2**2 / 2 / np.pi),
        t2_shelf1=dict(freq=z1 / a1 / 2 / np.pi, gain=g1, pole=z1 / a1**2 / 2 / np.pi),
    )


def report(fs_list):
    wnum, wden = woofer_tf()
    tnum, tden = tweeter_tf()
    (W1, W2), (_, T2), info = SECTIONS

    print("=" * 74)
    print("Analog transfer functions (coefficients ascending in s)")
    print("=" * 74)
    print(f"Woofer  num: {[fmt(v) for v in wnum]}")
    print(f"Woofer  den: {[fmt(v) for v in wden]}")
    print(f"Tweeter num: {[fmt(v) for v in tnum]}")
    print(f"Tweeter den: {[fmt(v) for v in tden]}\n")

    print("Poles / zeros")
    print(f"  Woofer : zero  {info['wz']/2/np.pi:9.1f} Hz")
    print(f"            pole  {info['wp1']/2/np.pi:9.1f} Hz (real)")
    print(f"            pair  {info['w0']/2/np.pi:9.1f} Hz  Q={info['qw']:.4f}")
    print(f"            DC gain {20*np.log10(info['g_dc']):+.3f} dB")
    print(f"  Tweeter: pole  {info['pt']/2/np.pi:9.1f} Hz (real -> HighpassFO)")
    print(f"            quad zeros: {['%.1f Hz' % (abs(z)/2/np.pi) for z in info['wzeros'] if abs(z) > 1e-9]}"
           f" (+ zero at DC)")
    qden = T2[1]
    print(f"            quad den : f0={np.sqrt(qden[0])/2/np.pi:.1f} Hz  Q={np.sqrt(qden[0])/qden[1]:.4f}\n")

    print("Woofer -3 dB crossings:", [f"{f:.0f} Hz" for f in crossings_3db(wnum, wden)])
    print("Tweeter -3 dB crossings:", [f"{f:.0f} Hz" for f in crossings_3db(tnum, tden)])
    n = native_params()
    print("\nNative (Fs-independent) filter parameters:")
    print(f"  w1_shelf  HighshelfFO freq={n['w1']['freq']:.1f} gain={n['w1']['gain']:+.2f}")
    print(f"  w2_lp     Lowpass     freq={n['w2']['freq']:.1f} q={n['w2']['q']:.4f}")
    print(f"  w_gain    Gain        {n['w2']['gain']:+.2f} dB")
    print(f"  t1_hp     HighpassFO  freq={n['t1']['freq']:.1f}")
    print(f"  t2_hp     Highpass    freq={n['t2_hp']['freq']:.1f} q={n['t2_hp']['q']:.4f}")
    print(f"  t2_shelf2 LowshelfFO  freq={n['t2_shelf2']['freq']:.1f} gain={n['t2_shelf2']['gain']:+.1f}"
          f"  (pole {n['t2_shelf2']['pole']:.1f} Hz)")
    print(f"  t2_shelf1 LowshelfFO  freq={n['t2_shelf1']['freq']:.1f} gain={n['t2_shelf1']['gain']:+.1f}"
          f"  (pole {n['t2_shelf1']['pole']:.1f} Hz)")
    fchk = [100, 500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 10000, 20000]
    print("\nAnalog response [dB] (f, woofer, tweeter, in-phase sum):")
    for f in fchk:
        w = mag_db(wnum, wden, f)[()]
        t = mag_db(tnum, tden, f)[()]
        s = 20 * np.log10(np.abs(polyval_asc(wnum, 1j*2*np.pi*f)/polyval_asc(wden, 1j*2*np.pi*f)
                                 + polyval_asc(tnum, 1j*2*np.pi*f)/polyval_asc(tden, 1j*2*np.pi*f)))
        print(f"  {f:6d} Hz  {w:8.2f}  {t:8.2f}  {s:8.2f}")

    for fs in fs_list:
        print("\n" + "=" * 74)
        print(f"Coefficients @ fs = {fs} Hz  (prewarp={'on' if PREWARP else 'off'})")
        print("=" * 74)
        (W1, W2, T2), pt_w = build_sections(fs, PREWARP)
        c1_ = bilinear(W1, fs)
        c2_ = bilinear(W2, fs)
        c3_ = bilinear(T2, fs)
        c0_ = t1_biquad(pt_w, fs)
        print(f"w1_shelf (Freeform): b0={fmt(c1_['b'][0])} b1={fmt(c1_['b'][1])} "
              f"b2={fmt(c1_['b'][2])} a1={fmt(c1_['a1'])} a2={fmt(c1_['a2'])}")
        print(f"w2_lp    (Freeform): b0={fmt(c2_['b'][0])} b1={fmt(c2_['b'][1])} "
              f"b2={fmt(c2_['b'][2])} a1={fmt(c2_['a1'])} a2={fmt(c2_['a2'])}")
        print(f"t1_hp    (Freeform, 1st order): b0={fmt(c0_['b'][0])} b1={fmt(c0_['b'][1])} "
              f"b2=0 a1={fmt(c0_['a1'])} a2=0  [pole {SECTIONS[2]['pt']/2/np.pi:.1f} Hz]")
        print(f"t2_hp    (Freeform): b0={fmt(c3_['b'][0])} b1={fmt(c3_['b'][1])} "
              f"b2={fmt(c3_['b'][2])} a1={fmt(c3_['a1'])} a2={fmt(c3_['a2'])}")
        print("verify digital-vs-analog [dB] @ (1k, 2k, 4k, 10k):")
        fv = np.array([1000.0, 2000.0, 4000.0, 10000.0])
        wd, td = digital_response(fs, fv, PREWARP)
        wd_db, td_db = 20 * np.log10(np.abs(wd)), 20 * np.log10(np.abs(td))
        wa = mag_db(wnum, wden, fv)
        ta = mag_db(tnum, tden, fv)
        print(f"  woofer : dig {[f'{v:+.2f}' for v in wd_db]}  ana {[f'{v:+.2f}' for v in wa]}")
        print(f"  tweeter: dig {[f'{v:+.2f}' for v in td_db]}  ana {[f'{v:+.2f}' for v in ta]}")
        fgrid = np.logspace(np.log10(20), np.log10(min(20000.0, 0.48 * fs)), 2000)
        wa_g, ta_g = analog_response(fgrid)
        wd_g, td_g = digital_response(fs, fgrid, PREWARP)
        esum = 20 * np.log10(np.abs((wd_g + td_g) / (wa_g + ta_g)))
        print(f"  max |sum err| 20 Hz..{fgrid[-1]/1000:.1f} kHz: {np.abs(esum).max():.3f} dB")


def yaml_config(fs, full=False):
    (W1, W2, T2), pt_w = build_sections(fs, PREWARP)
    c1_, c2_, c3_ = bilinear(W1, fs), bilinear(W2, fs), bilinear(T2, fs)
    c0_ = t1_biquad(pt_w, fs)
    L = []
    if full:
        L += [
            "devices:",
            "  samplerate: %d" % fs,
            "  chunksize: 1024",
            "  capture:",
            "    type: Stdin",
            "    channels: 2",
            "  playback:",
            "    type: Alsa",
            "    channels: 4",
            '    device: "hw:YourDAC"',
            "mixers:",
            "  split4:",
            "    type: Mixer",
            "    channels:",
            "      in: 2",
            "      out: 4",
            "    parameters:",
            "      mapping:",
        ]
        for dst, src in [(0, 0), (1, 0), (2, 1), (3, 1)]:
            L += [
                "        - dest: %d" % dst,
                "          sources:",
                "            - channel: %d" % src,
                "              gain: 0.0",
                "              inverted: false",
            ]
        L += ["filters:"]
        ind = "  "
    else:
        L += ["filters:"]
        ind = ""

    def free(name, c):
        return [
            f"{ind}{name}:",
            f"{ind}  type: Biquad",
            f"{ind}  parameters:",
            f"{ind}    type: Freeform",
            f"{ind}    b0: {c['b'][0]:.9g}",
            f"{ind}    b1: {c['b'][1]:.9g}",
            f"{ind}    b2: {c['b'][2]:.9g}",
            f"{ind}    a1: {c['a1']:.9g}",
            f"{ind}    a2: {c['a2']:.9g}",
        ]

    L += free("w1_shelf", c1_)
    L += free("w2_lp", c2_)
    L += [
        f"{ind}t1_hp:",
        f"{ind}  type: Biquad",
        f"{ind}  parameters:",
        f"{ind}    type: Freeform",
        f"{ind}    b0: {c0_['b'][0]:.9g}",
        f"{ind}    b1: {c0_['b'][1]:.9g}",
        f"{ind}    b2: 0.0",
        f"{ind}    a1: {c0_['a1']:.9g}",
        f"{ind}    a2: 0.0",
    ]
    L += free("t2_hp", c3_)
    L += [
        "pipeline:",
        "  - type: Mixer",
        "    name: split4",
        "  - type: Filter",
        "    channel: 0",
        "    names: [w1_shelf, w2_lp]",
        "  - type: Filter",
        "    channel: 1",
        "    names: [t1_hp, t2_hp]",
        "  - type: Filter",
        "    channel: 2",
        "    names: [w1_shelf, w2_lp]",
        "  - type: Filter",
        "    channel: 3",
        "    names: [t1_hp, t2_hp]",
    ]
    return "\n".join(L)


FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
FREQ_LABELS = ["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"]


def set_freq_axis(ax):
    ax.set_xticks(FREQ_TICKS)
    ax.set_xticklabels(FREQ_LABELS)
    ax.grid(True, which="major", alpha=0.5)
    ax.grid(True, which="minor", alpha=0.15)
    ax.set_xlim(20, 20000)


def plots(outdir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    f = np.logspace(np.log10(20), np.log10(20000), 1200)
    wa, ta = analog_response(f)
    wa_db, ta_db = 20 * np.log10(np.abs(wa)), 20 * np.log10(np.abs(ta))
    sa_db = 20 * np.log10(np.abs(wa + ta))

    fig, axes = plt.subplots(3, 1, figsize=(9, 10), sharex=True)
    panels = [
        (wa_db, None, "Woofer branch  (L1 560uH + C2 12uF into Re 3.1 + Le 0.25mH)"),
        (ta_db, 1, "Tweeter branch  (C1 5.6uF + L2 180uH + C3 15uF into Re 3.0)"),
        (sa_db, "sum", "In-phase voltage sum of both branches (resistive-load model)"),
    ]
    for ax, (ya, which, title) in zip(axes, panels):
        ax.semilogx(f, ya, "k-", lw=2, label="analog (passive)")
        for fs, style in [(44100, "--"), (96000, "-.")]:
            wd, td = digital_response(fs, f, PREWARP)
            if which is None:
                yd = 20 * np.log10(np.abs(wd))
            elif which == 1:
                yd = 20 * np.log10(np.abs(td))
            else:
                yd = 20 * np.log10(np.abs(wd + td))
            ax.semilogx(f, yd, style, lw=1.2, label=f"digital @ {fs/1000:.1f} kHz")
        ax.set_title(title, fontsize=10)
        ax.set_ylabel("dB")
        ax.set_ylim(-40, 5)
        set_freq_axis(ax)
        ax.legend(fontsize=8, loc="lower left")
    axes[-1].set_xlabel("Frequency [Hz]")
    fig.suptitle("SB12PACR25-4-COAX passive crossover vs CamillaDSP replica", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    p1 = f"{outdir}/xo_comparison.png"
    fig.savefig(p1, dpi=140)
    print("wrote", p1)

    fig2, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(9, 9.5), sharex=True)
    for fs in [44100, 48000, 88200, 96000, 192000]:
        wd, td = digital_response(fs, f, PREWARP)
        ax1.semilogx(f, 20 * np.log10(np.abs(wd / wa)), label=f"{fs/1000:g} kHz")
        ax2.semilogx(f, 20 * np.log10(np.abs(td / ta)), label=f"{fs/1000:g} kHz")
        ax3.semilogx(f, 20 * np.log10(np.abs((wd + td) / (wa + ta))),
                     label=f"{fs/1000:g} kHz")
    for ax, name in [(ax1, "Woofer branch ratio (w1_shelf + w2_lp)\n(stopband errors here barely affect the sound)"),
                     (ax2, "Tweeter branch ratio (t1_hp + t2_hp)"),
                     (ax3, "Branch SUM (acoustically relevant)")]:
        ax.axhline(0, color="k", lw=0.8, alpha=0.6)
        ax.axhline(0.1, color="gray", lw=0.6, ls=":", alpha=0.7)
        ax.axhline(-0.1, color="gray", lw=0.6, ls=":", alpha=0.7)
        ax.set_title(name, fontsize=10)
        ax.set_ylabel("digital vs analog [dB]")
        set_freq_axis(ax)
        ax.legend(fontsize=8, loc="lower left")
    ax1.set_ylim(-4, 4)
    ax2.set_ylim(-1.5, 1.5)
    ax3.set_ylim(-1.5, 1.5)
    ax3.set_xlabel("Frequency [Hz]")
    mode = ("per-root pre-warped" if PREWARP else "plain bilinear, all sections consistent")
    fig2.suptitle(f"Replica magnitude error ({mode})", fontsize=12)
    fig2.tight_layout(rect=(0, 0, 1, 0.96))
    p2 = f"{outdir}/xo_error.png"
    fig2.savefig(p2, dpi=140)
    print("wrote", p2)


def mermaid(npts=14):
    wnum, wden = woofer_tf()
    tnum, tden = tweeter_tf()
    f = np.logspace(2, np.log10(20000), npts)
    wa = mag_db(wnum, wden, f)
    ta = mag_db(tnum, tden, f)
    sa = 20 * np.log10(np.abs(
        polyval_asc(wnum, 1j*2*np.pi*f)/polyval_asc(wden, 1j*2*np.pi*f)
        + polyval_asc(tnum, 1j*2*np.pi*f)/polyval_asc(tden, 1j*2*np.pi*f)))
    xf = "[" + ", ".join(f"{v:.0f}" for v in f) + "]"
    for name, y in [("Woofer branch [dB]", wa), ("Tweeter branch [dB]", ta),
                    ("Sum [dB]", sa)]:
        print(f"xychart-beta\n    title \"{name}\"\n    x-axis \"Hz\" {xf}\n"
              f"    y-axis \"dB\" -40 --> 5\n    line [{', '.join(f'{v:.1f}' for v in y)}]\n")


SECTIONS = factorise()
PREWARP = False

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-f", "--fs", type=str, default=",".join(map(str, DEFAULT_FS)),
                    help="comma-separated sample rates (default: all common rates)")
    ap.add_argument("--full", action="store_true",
                    help="emit a complete CamillaDSP config instead of filters only")
    ap.add_argument("--plot", type=str, default=None, metavar="DIR",
                    help="write comparison PNG plots to DIR")
    ap.add_argument("--mermaid", action="store_true",
                    help="print mermaid xychart data for the docs")
    ap.add_argument("--prewarp", action="store_true",
                    help="per-root frequency pre-warping (not recommended for this network)")
    args = ap.parse_args()

    if args.prewarp:
        PREWARP = True

    fs_list = [int(x) for x in args.fs.split(",")]
    if len(fs_list) == 1:
        print(yaml_config(fs_list[0], full=args.full))
    else:
        report(fs_list)
    if args.plot:
        plots(args.plot)
    if args.mermaid:
        mermaid()
