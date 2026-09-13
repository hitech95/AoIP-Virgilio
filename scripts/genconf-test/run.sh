#!/bin/sh
# Host-side test suite for camilladsp-genconf (no OpenWrt needed).
#
# Uses functions.sh, a minimal stub of /lib/functions.sh, to run the
# real genconf script against uci plain-text files. Checks:
#   1. positive: protected 2-way uci renders byte-identical to
#      configs/camilladsp_protected_2way.yaml (+ .policy.yml)
#   2. negative: 8 misconfigurations refuse to render
#   3. legacy:   no-subchain config renders like the previous genconf
#                (only the intended mixer gain/scale fixes differ)
#
# Run from anywhere: sh scripts/genconf-test/run.sh

set -e
T=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(dirname "$(dirname "$T")")
WORK=${WORK:-/tmp/genconf-test}
GENCONF=$REPO/br-external/board/rk3506qemu/rootfs-overlay/usr/bin/camilladsp-genconf

rm -rf "$WORK"
mkdir -p "$WORK/config" "$WORK/out"

# genconf copy sourcing the stub instead of /lib/functions.sh
cp "$GENCONF" "$WORK/genconf"
sed -i "s|^\. /lib/functions\.sh$|. $T/functions.sh|" "$WORK/genconf"
chmod +x "$WORK/genconf"

pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1"; fail=$((fail+1)); }

# ---- 1. positive: protected 2-way ----------------------------------------
cp "$T/protected-2way.uci" "$WORK/config/camilladsp"
UCI_CONFIG_DIR="$WORK/config" "$WORK/genconf" "$WORK/out/camilladsp.yml"
sed -e 's/[[:space:]]*#.*$//' -e '/^\s*$/d' \
	"$REPO/configs/camilladsp_protected_2way.yaml" > "$WORK/expected.yml"
if diff -q "$WORK/expected.yml" "$WORK/out/camilladsp.yml" > /dev/null; then
	ok "protected 2-way yml byte-identical"
else
	bad "protected 2-way yml differs"; diff "$WORK/expected.yml" "$WORK/out/camilladsp.yml" | head
fi
sed -e 's/[[:space:]]*#.*$//' -e '/^\s*$/d' \
	"$REPO/configs/camilladsp_protected_2way.policy.yml" > "$WORK/expected.policy"
if diff -q "$WORK/expected.policy" "$WORK/out/camilladsp.policy" > /dev/null; then
	ok "protected 2-way policy byte-identical"
else
	bad "protected 2-way policy differs"
fi

# ---- 2. negative cases ------------------------------------------------------
neg() {
	name="$1"; expect="$2"
	rm -rf "$WORK/neg"; mkdir -p "$WORK/neg"; cp "$T/protected-2way.uci" "$WORK/neg/camilladsp"
	shift 2
	( cd "$WORK/neg" && "$@" ) >/dev/null 2>&1
	rc=0; out=$(UCI_CONFIG_DIR="$WORK/neg" "$WORK/genconf" "$WORK/neg.yml" 2>&1) || rc=$?
	if [ "$rc" -ne 0 ] && echo "$out" | grep -q "$expect"; then
		ok "$name"
	else
		bad "$name (rc=$rc: $(echo "$out" | head -1))"
	fi
}

neg "step without subchain" "has no subchain" \
	sed -i "s|option subchain 'user_in0'|option subchain ''|" camilladsp

neg "locked conv outside vendor path" "coeffs" \
	sed -i "s|/usr/share/camilladsp/coeffs/wf_fir.txt|/opt/user_data/x.txt|" camilladsp

neg "child missing allow" "needs allow" \
	sed -i "0,/option allow/s|option allow.*||" camilladsp

neg "editable with two steps" "exactly one slot step" \
	sh -c 'printf "\nconfig step\n\toption index '\''16'\''\n\toption subchain '\''user_in0'\''\n" >> camilladsp'

# last subchain unlocked (tw_tail -> proper editable last group)
rm -rf "$WORK/neg"; mkdir -p "$WORK/neg"; cp "$T/protected-2way.uci" "$WORK/neg/camilladsp"
python3 - "$WORK/neg/camilladsp" <<'EOF'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = s.replace("option name 'tw_tail'\n\toption policy 'locked'",
              "option name 'tw_tail'\n\toption policy 'child'\n\toption channels '1'\n\toption allow 'gain'\n\toption max_steps '4'")
s = re.sub(r"(option index '40'\n\toption subchain 'tw_tail')\n(.|\n)*?names 'tw_limit'\n", r"\1\n", s, count=1)
open(p, "w").write(s)
EOF
rc=0; out=$(UCI_CONFIG_DIR="$WORK/neg" "$WORK/genconf" "$WORK/neg.yml" 2>&1) || rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "must be locked" && ok "last subchain unlocked" \
	|| bad "last subchain unlocked (rc=$rc: $out)"

# non-contiguous subchains (tw_tail split by user_in1 at index 45)
rm -rf "$WORK/neg"; mkdir -p "$WORK/neg"; cp "$T/protected-2way.uci" "$WORK/neg/camilladsp"
python3 - "$WORK/neg/camilladsp" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("option index '15'", "option index '45'")
s += "\nconfig step\n\toption index '50'\n\toption subchain 'tw_tail'\n\toption type 'Filter'\n\tlist channels '1'\n\tlist names 'tw_notch10k'\n"
s = s.replace("\tlist names 'tw_hp'\n\tlist names 'tw_notch10k'", "\tlist names 'tw_hp'")
open(p, "w").write(s)
EOF
rc=0; out=$(UCI_CONFIG_DIR="$WORK/neg" "$WORK/genconf" "$WORK/neg.yml" 2>&1) || rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "not contiguous" && ok "non-contiguous subchains" \
	|| bad "non-contiguous subchains (rc=$rc: $out)"

# slot step carrying a type
neg "slot step with type" "no type/filters" \
	sh -c "python3 -c \"import sys; p='camilladsp'; s=open(p).read(); s=s.replace(\\\"option index '10'\\\\n\\\\toption subchain 'user_in0'\\\", \\\"option index '10'\\\\n\\\\toption subchain 'user_in0'\\\\n\\\\toption type 'Filter'\\\"); open(p,'w').write(s)\""

# free subchain with a non-locked anchor
neg "free with non-locked anchor" "not locked" \
	sh -c 'printf "\nconfig subchain\n\toption name '\''user_x'\''\n\toption policy '\''free'\''\n\toption channels '\''0'\''\n\toption allow '\''gain'\''\n\tlist allowed_after '\''user_in0'\''\nconfig step\n\toption index '\''12'\''\n\toption subchain '\''user_x'\''\n" >> camilladsp'

# ---- 3. legacy: no subchains ------------------------------------------------
rm -rf "$WORK/legacy"; mkdir -p "$WORK/legacy"
cp "$T/legacy.uci" "$WORK/legacy/camilladsp"
UCI_CONFIG_DIR="$WORK/legacy" "$WORK/genconf" "$WORK/out/legacy.yml"
NGAIN=$(grep -c "^            gain: " "$WORK/out/legacy.yml" || true)
NSCALE=$(grep -A1 "^            gain: " "$WORK/out/legacy.yml" | grep -c "^            scale: linear" || true)
if grep -q "scale: linear" "$WORK/out/legacy.yml" && [ "$NGAIN" = "$NSCALE" ]; then
	ok "legacy render (explicit linear gains)"
else
	bad "legacy render ($NGAIN gains vs $NSCALE scales)"
fi
if [ ! -e "$WORK/out/legacy.policy" ] && [ ! -e "$WORK/legacy.policy" ]; then
	ok "legacy render emits no policy"
else
	bad "legacy render emitted a policy"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
