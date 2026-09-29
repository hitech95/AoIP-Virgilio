#!/bin/sh
# Host-side test suite for camilladsp-genconf (ucode, named-section schema).
#
# Runs the real generator (target ucode binary via qemu-user against
# output/target, no OpenWrt VM needed) against uci plain-text files:
#   1. positive: protected 2-way uci renders semantically identical to
#      configs/camilladsp_protected_2way.yaml (+ .policy.yml)
#   2. negative: misconfigurations refuse to render (message greps)
#   3. user steps in editable slots render after the placeholder and
#      never leak into the policy
#   4. legacy: no-policy config renders, every route gain carries an
#      explicit "scale": "linear", no policy emitted
#   5. labels: step label -> description, filter description rendered
#   6. inferno env sidecar: TX wire depth mapped from uci format
#
# Needs: qemu-arm, output/<variant>/target (from scripts/build.sh),
# python3+yaml. Run from anywhere: sh scripts/genconf-test/run.sh

set -e
T=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=$(dirname "$(dirname "$T")")
WORK=${WORK:-/tmp/genconf-test}
GENCONF=$REPO/br-external/package/camilladsp/files/usr/bin/camilladsp-genconf
VARIANT=${VARIANT:-rk3506qemu}
TARGET=$REPO/output/$VARIANT/target
UCODE=$TARGET/usr/bin/ucode
UCODE_LIB=$TARGET/usr/lib/ucode

[ -x "$UCODE" ] || { echo "missing $UCODE -- run scripts/build.sh first"; exit 2; }
command -v qemu-arm >/dev/null || { echo "missing qemu-arm (qemu-user)"; exit 2; }

rm -rf "$WORK"
mkdir -p "$WORK/config" "$WORK/out"

# genconf <configdir> <outfile>  -- the generator under test
genconf() {
	UCI_CONFIG_DIR="$1" qemu-arm -L "$TARGET" "$UCODE" -L "$UCODE_LIB" \
		-S "$GENCONF" "$2" 2>"$WORK/stderr.txt"
}

pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1"; fail=$((fail+1)); }

# compare <yaml-expected> <json-actual>: semantically equal?
semcmp() {
	python3 -c "
import sys, json, yaml
a = yaml.safe_load(open('$1'))
b = json.load(open('$2'))
def norm(x):
    if isinstance(x, dict): return {k: norm(v) for k, v in sorted(x.items())}
    if isinstance(x, list): return [norm(v) for v in x]
    return x
def eq(a, b, p=''):
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b): print(f'keys differ at {p}: {set(a)^set(b)}'); return False
        return all(eq(a[k], b[k], p+'.'+k) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): print(f'len differs at {p}'); return False
        return all(eq(x, y, f'{p}[{i}]') for i, (x, y) in enumerate(zip(a, b)))
    if a != b and not (isinstance(a,(int,float)) and isinstance(b,(int,float)) and not isinstance(a,bool) and not isinstance(b,bool) and a==b):
        print(f'value differs at {p}: {a!r} vs {b!r}'); return False
    return True
sys.exit(0 if eq(norm(a), norm(b)) else 1)
"
}

# ---- 1. positive: protected 2-way ----------------------------------------
cp "$T/protected-2way.uci" "$WORK/config/camilladsp"
genconf "$WORK/config" "$WORK/out/camilladsp.yml"
if semcmp "$REPO/configs/camilladsp_protected_2way.yaml" "$WORK/out/camilladsp.yml"; then
	ok "protected 2-way yml semantically identical"
else
	bad "protected 2-way yml differs"
fi
if semcmp "$REPO/configs/camilladsp_protected_2way.policy.yml" "$WORK/out/camilladsp.policy"; then
	ok "protected 2-way policy semantically identical"
else
	bad "protected 2-way policy differs"
fi

# ---- 2. negative cases ------------------------------------------------------
neg() {
	name="$1"; expect="$2"
	rm -rf "$WORK/neg"; mkdir -p "$WORK/neg"; cp "$T/protected-2way.uci" "$WORK/neg/camilladsp"
	shift 2
	( cd "$WORK/neg" && "$@" ) >/dev/null 2>&1
	rc=0; genconf "$WORK/neg" "$WORK/neg.yml" || rc=$?
	out=$(cat "$WORK/stderr.txt")
	if [ "$rc" -ne 0 ] && echo "$out" | grep -q "$expect"; then
		ok "$name"
	else
		bad "$name (rc=$rc: $(echo "$out" | head -1))"
	fi
}

# policy removed from one step while others carry one
neg "step without policy" "has no policy" \
	sed -i "s|option policy 'child'|option policy ''|" camilladsp

neg "locked conv outside vendor path" "coeffs" \
	sed -i "s|/usr/share/camilladsp/coeffs/wf_fir.txt|/opt/user_data/x.txt|" camilladsp

# allow list stripped from the first child step (user_in0)
neg "child missing allow" "needs allow" \
	sed -i "1,/option max_steps '8'/{/list allow/d}" camilladsp

# order list references an undefined step
neg "order references unknown step" "references unknown step" \
	sed -i "s|list step 'wf_tail'|list step 'ghost'|" camilladsp

# defined step missing from the order list
neg "step missing from order" "not listed in the pipeline order" \
	sed -i "/list step 'user_in1'/d" camilladsp

# duplicate order entry
neg "duplicate order entry" "more than once" \
	sh -c "printf \"\tlist step 'user_in0'\n\" >> camilladsp"

# order section removed entirely
neg "order missing" "pipeline order missing" \
	sed -i "/^config pipeline\$/,\$d" camilladsp

# last order entry is editable (nothing may follow the protection tail)
neg "last step not locked" "must be locked" \
	sh -c "printf \"\tlist step 'user_end'\n\" >> camilladsp && printf \"\nconfig pipeline_step 'user_end'\n\toption policy 'child'\n\tlist channels '0'\n\tlist allow 'gain'\n\" >> camilladsp"

# editable step carrying a type
neg "editable step with type" "must not carry a type" \
	sed -i "s|option policy 'child'|option policy 'child'\n\toption type 'Filter'|" camilladsp

# free step anchored on a non-locked step (inserted mid-order so the
# last-step-locked check does not shadow the anchor error)
neg "free with non-locked anchor" "not locked" \
	sh -c "sed -i \"/list step 'wf_tail'/a list step 'user_x'\" camilladsp && printf \"\nconfig pipeline_step 'user_x'\n\toption policy 'free'\n\tlist channels '0'\n\tlist allow 'gain'\n\tlist allowed_after 'user_in0'\n\" >> camilladsp"

# ---- 2b. user steps in editable slots (webui filters page) ------------------
rm -rf "$WORK/user"; mkdir -p "$WORK/user"; cp "$T/protected-2way.uci" "$WORK/user/camilladsp"
(
	cd "$WORK/user"
	printf "\nconfig filter 'u_eq100'\n\toption type 'peak'\n\toption f '100'\n\toption gain '3.0'\n\toption q '1.0'\nconfig filter 'u_pad'\n\toption type 'gain'\n\toption gain '-2.0'\n" >> camilladsp
	sed -i "s|option policy 'child'|option policy 'child'\n\tlist names 'u_eq100'\n\tlist names 'u_pad'|" camilladsp
)
rc=0; genconf "$WORK/user" "$WORK/user.yml" || rc=$?
if [ "$rc" -eq 0 ] && python3 -c "
import json, sys
c = json.load(open('$WORK/user.yml'))
names = [s['names'] for s in c['pipeline'] if s['type'] == 'Filter' and 'user_slot_user_in0' in s.get('names', [])][0]
sys.exit(0 if names == ['user_slot_user_in0', 'u_eq100', 'u_pad'] else 1)
"; then
	ok "user steps render after placeholder"
else
	bad "user steps render (rc=$rc: $(head -1 "$WORK/stderr.txt"))"
fi
if python3 -c "
import json, sys
p = json.load(open('$WORK/user.policy'))
sys.exit(0 if 'u_eq100' not in json.dumps(p) else 1)
"; then
	ok "policy unchanged by user steps"
else
	bad "user steps leaked into the policy"
fi

neg "user filter type not allowed" "not in allow list" \
	sh -c "printf \"\nconfig filter 'u_lp'\n\toption type 'lrlp'\n\toption f '100'\n\" >> camilladsp && sed -i \"s|option policy 'child'|option policy 'child'\n\tlist names 'u_lp'|\" camilladsp"

neg "user steps exceed max_steps" "exceed max_steps" \
	sh -c "for i in 1 2 3 4 5 6 7 8 9; do printf \"\nconfig filter 'u_g\$i'\n\toption type 'gain'\n\toption gain '0'\n\" >> camilladsp; done; sed -i \"s|option policy 'child'|option policy 'child'\n\tlist names 'u_g1'\n\tlist names 'u_g2'\n\tlist names 'u_g3'\n\tlist names 'u_g4'\n\tlist names 'u_g5'\n\tlist names 'u_g6'\n\tlist names 'u_g7'\n\tlist names 'u_g8'\n\tlist names 'u_g9'|\" camilladsp"

neg "user filter undefined" "is not defined" \
	sed -i "s|option policy 'child'|option policy 'child'\n\tlist names 'u_ghost'|" camilladsp

# mixer step referencing an unknown mixer
neg "unknown mixer reference" "references unknown mixer" \
	sed -i "s|option mixer 'srcmix'|option mixer 'nope'|" camilladsp

# ---- 3. legacy: no policies ------------------------------------------------
rm -rf "$WORK/legacy"; mkdir -p "$WORK/legacy"
cp "$T/legacy.uci" "$WORK/legacy/camilladsp"
genconf "$WORK/legacy" "$WORK/out/legacy.yml"
if python3 -c "
import json, sys
c = json.load(open('$WORK/out/legacy.yml'))
routes = [s for m in c.get('mixers', {}).values() for s in m['mapping'] for s in s['sources']]
sys.exit(0 if routes and all(r.get('scale') == 'linear' for r in routes) else 1)
"; then
	ok "legacy render (explicit linear gains)"
else
	bad "legacy render (routes missing scale linear)"
fi
if [ ! -e "$WORK/out/legacy.policy" ] && [ ! -e "$WORK/legacy.policy" ]; then
	ok "legacy render emits no policy"
else
	bad "legacy render emitted a policy"
fi

# ---- 3b. no pipeline at all: pass-through ---------------------------------
# only `config camilladsp 'main'`: capture maps straight to playback,
# the rendered config carries no pipeline key
rm -rf "$WORK/passthrough"; mkdir -p "$WORK/passthrough"
printf "%s\n" \
	"config camilladsp 'main'" \
	"	option samplerate '48000'" \
	"	option channels '2'" \
	"	option output_channels '2'" \
	"	option chunksize '1024'" \
	"	option format 'S16_LE'" \
	"	option capture 'RawFile:/dev/zero'" \
	"	option playback 'File:/dev/null'" \
	> "$WORK/passthrough/camilladsp"
rc=0; genconf "$WORK/passthrough" "$WORK/passthrough.yml" || rc=$?
if [ "$rc" -eq 0 ] && python3 -c "
import json, sys
c = json.load(open('$WORK/passthrough.yml'))
assert 'pipeline' not in c, c.get('pipeline')
assert 'devices' in c
" && [ ! -e "$WORK/passthrough.policy" ]; then
	ok "no pipeline renders pass-through (no pipeline key)"
else
	bad "pass-through render (rc=$rc: $(head -1 "$WORK/stderr.txt"))"
fi

# ---- 4. labels/descriptions render into the config ---------------------
rm -rf "$WORK/labels"; mkdir -p "$WORK/labels"; cp "$T/protected-2way.uci" "$WORK/labels/camilladsp"
(
	cd "$WORK/labels"
	sed -i "s|option policy 'child'|option policy 'child'\n\toption label 'Front EQ'|" camilladsp
	sed -i "s|option type 'notch'|option type 'notch'\n\toption description '10k notch'|" camilladsp
)
rc=0; genconf "$WORK/labels" "$WORK/labels.yml" || rc=$?
if [ "$rc" -eq 0 ] && python3 -c "
import json, sys
c = json.load(open('$WORK/labels.yml'))
slot = [s for s in c['pipeline'] if 'user_slot_user_in0' in s.get('names', [])][0]
assert slot.get('description') == 'Front EQ', slot
assert c['filters']['tw_notch10k'].get('description') == '10k notch', c['filters']['tw_notch10k']
"; then
	ok "step label -> description, filter description rendered"
else
	bad "label/description rendering (rc=$rc: $(head -1 "$WORK/stderr.txt"))"
fi

# ---- 5. free subchain renders its gaps by anchor name -------------------
rm -rf "$WORK/free"; mkdir -p "$WORK/free"; cp "$T/protected-2way.uci" "$WORK/free/camilladsp"
(
	cd "$WORK/free"
	printf "\nconfig filter 'uf1'\n\toption type 'gain'\n\toption gain '1'\n" >> camilladsp
	sed -i "s|option policy 'child'|option policy 'free'\n\tlist allowed_after 'src_sel'\n\tlist names 'uf1'|" camilladsp
)
rc=0; genconf "$WORK/free" "$WORK/free.yml" || rc=$?
if [ "$rc" -eq 0 ] && python3 -c "
import json, sys
c = json.load(open('$WORK/free.yml'))
p = json.load(open('$WORK/free.policy'))
free = [s for s in p['subchains'] if s['policy'] == 'free'][0]
assert free['gaps'] == ['src_sel'], free
assert free['max_steps'] == 8, free
slot = [s for s in c['pipeline'] if 'user_slot_user_in0' in s.get('names', [])][0]
assert slot['names'] == ['user_slot_user_in0', 'uf1'], slot
"; then
	ok "free subchain renders gaps by anchor name"
else
	bad "free subchain rendering (rc=$rc: $(head -1 "$WORK/stderr.txt"))"
fi

# ---- 6. inferno env sidecar: TX wire depth from uci format ------------------
# one depth case per format value (+ garbage/unset/RX-only). want is the
# expected depth number, or NONE when no depth line may be emitted.
depth_case() {
	name="$1"; fmt="$2"; want="$3"
	rm -rf "$WORK/depth"; mkdir -p "$WORK/depth"
	cp "$T/protected-2way.uci" "$WORK/depth/camilladsp"
	if [ "$fmt" = "-" ]; then
		sed -i "/option format/d" "$WORK/depth/camilladsp"
	else
		sed -i "s|option format '.*'|option format '$fmt'|" "$WORK/depth/camilladsp"
	fi
	rm -f "$WORK/depth.env"
	rc=0; genconf "$WORK/depth" "$WORK/depth.yml" || rc=$?
	depth=""
	if [ -f "$WORK/depth.env" ] && grep -q "^INFERNO_TX_BITS_PER_SAMPLE=" "$WORK/depth.env"; then
		depth=$(sed -n "s/^INFERNO_TX_BITS_PER_SAMPLE=//p" "$WORK/depth.env")
	fi
	if [ "$rc" -eq 0 ] && [ "$depth" = "$want" ]; then
		ok "sidecar depth $name"
	else
		bad "sidecar depth $name (rc=$rc depth='$depth' want='$want': $(head -1 "$WORK/stderr.txt"))"
	fi
}

depth_case "S16_LE -> 16"    "S16_LE"   "16"
depth_case "S24_LE -> 24"    "S24_LE"   "24"
depth_case "S24_3LE -> 24"   "S24_3LE"  "24"
depth_case "S24_3_LE -> 24"  "S24_3_LE" "24"
depth_case "S32_LE -> 32"    "S32_LE"   "32"
depth_case "garbage -> 24"   "FLOAT64"  "24"
depth_case "unset -> no line" "-"       ""

# RX-only box (capture Inferno, playback File): sidecar exists but never
# carries a depth line -- wire depth is remote-transmitter territory
rm -rf "$WORK/rxonly"; mkdir -p "$WORK/rxonly"
cp "$T/protected-2way.uci" "$WORK/rxonly/camilladsp"
sed -i "s|option playback 'Inferno'|option playback 'File:/dev/null'|" "$WORK/rxonly/camilladsp"
rm -f "$WORK/rxonly.env"
rc=0; genconf "$WORK/rxonly" "$WORK/rxonly.yml" || rc=$?
if [ "$rc" -eq 0 ] && [ -f "$WORK/rxonly.env" ] \
	&& grep -q "^INFERNO_RX_CHANNELS=" "$WORK/rxonly.env" \
	&& ! grep -q "INFERNO_TX_BITS_PER_SAMPLE" "$WORK/rxonly.env"; then
	ok "RX-only sidecar has no depth line"
else
	bad "RX-only sidecar (rc=$rc: $(head -1 "$WORK/stderr.txt"))"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
