#!/usr/bin/env bash
# M5 DoD (plan/plan.md §5): automated M1–M4 DoD checks against a freshly
# booted guest — "tests must not need root" (§10): everything runs through
# the telnet serial console of a background guest and the slirp hostfwd.
#
# Usage: scripts/test.sh [--keep]      (--keep: leave the console log dir)
#
# Covers:
#   M1  boot to shell, cortex-a7 NEON/VFPv4 features, clean poweroff
#   M2  procd=PID1, ubus objects, uci network, slirp eth0 DHCP + route +
#       resolv.conf, netifd kill -9 respawn + interface re-established
#   M3  camilladsp features (websocket,32bit), generated config --check,
#       procd supervision + running daemon, WS 101 handshake via hostfwd
#   M4  statime lone-PTPv2 GM (D10 self-clock), usrvclock export, ptp
#       object locked, inferno PCM listed by arecord -L
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGES="${VIRGILIO_IMAGES:-$ROOT/output/rk3506qemu/images}"
for f in zImage rootfs.ext4; do
	[ -e "$IMAGES/$f" ] || { echo "missing $IMAGES/$f — run scripts/build.sh first" >&2; exit 2; }
done

if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ':5000 '; then
	echo "host port 5000 busy (another guest running?) — aborting" >&2
	exit 2
fi

WORK=/tmp/opencode/test-m5
rm -rf "$WORK"; mkdir -p "$WORK"
PORT=$(( (RANDOM % 2000) + 5500 ))
PASS=0; FAIL=0; FAILED=""

ok()   { printf '  %-28s PASS\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  %-28s FAIL\n' "$1"; FAIL=$((FAIL+1)); FAILED="$FAILED $1"; }
# check NAME PATTERN — grep the captured block of NAME
check() {
	if result "$1" | grep -qE -- "$2"; then ok "$1"; else bad "$1"; fi
}
result() { sed -n "/^@@BEGIN $1 /,/^@@END $1/p" "$WORK/results.txt" | sed '1d;$d'; }

cleanup() {
	[ -n "${QPID:-}" ] && kill "$QPID" 2>/dev/null
	[ -n "${QPID:-}" ] && wait "$QPID" 2>/dev/null
}
trap cleanup EXIT

echo "== M5 test rig: guest on telnet console :$PORT, log $WORK/console.log =="
./scripts/run-qemu.sh --console telnet:$PORT >"$WORK/console.log" 2>&1 &
QPID=$!

cat >"$WORK/cmds-a.txt" <<'EOS'
# --- boot + shell -----------------------------------------------------------
ready CONSOLE-UP 300
exec M1_CPU 20 grep -o "Features.*" /proc/cpuinfo | head -1
exec M2_PID1 10 cat /proc/1/comm
exec M2_UBUS 90 ubus -t 60 wait_for network ptp; ubus list | sort | tr "\n" ","
exec M2_NET 90 i=0; while [ $i -lt 40 ]; do ip -4 addr show eth0 | grep -q "inet 10.0.2.15" && break; i=$((i+1)); sleep 2; done; ip -4 addr show eth0 | grep inet; ip route show default; grep nameserver /etc/resolv.conf
exec M2_UCI 10 uci -q get network.lan.proto; uci -q get network.aoip.device 2>/dev/null; uci -q get network.aoip.proto 2>/dev/null
# --- M3: camilladsp static checks -------------------------------------------
exec M3_FEATURES 30 camilladsp --help 2>&1 | grep -o "Built with features:.*"
exec M3_CHECK 60 { [ -s /tmp/camilladsp.yml ] || /usr/bin/camilladsp-genconf /tmp/camilladsp.yml >/dev/null; }; camilladsp /tmp/camilladsp.yml --check >/tmp/chk.out 2>&1; echo CHECKRC=$?; tail -2 /tmp/chk.out
# --- M4: statime lone GM + inferno plugin ------------------------------------
exec M4_PTPLOCK 150 i=0; while [ $i -lt 60 ]; do [ "$(ubus call ptp status 2>/dev/null | jsonfilter -e "@.locked" 2>/dev/null)" = true ] && break; i=$((i+1)); sleep 2; done; ubus call ptp status
exec M4_USRVCLOCK 10 ls -l /tmp/ptp-usrvclock
exec M4_STATIME_STATE 15 pidof statime
exec M4_INFERNO_PCM 20 arecord -L 2>/dev/null | grep -i inferno | head -4
# --- M3: running daemon (started by the ptp hotplug) ------------------------
exec M3_RUNNING 120 for i in $(seq 45); do for p in $(pidof camilladsp); do [ "$(readlink /proc/$p/exe)" = /usr/bin/camilladsp ] && break 2; done; sleep 2; done; ubus -S call camilladsp status
EOS

cat >"$WORK/cmds-b.txt" <<'EOS'
ready CONSOLE-UP-B 60
# --- M2: netifd crash respawn (destructive: last guest-side check) -----------
exec M2_RESPAWN 90 OLD=$(pidof netifd); kill -9 $OLD; sleep 12; NEW=$(pidof netifd); echo "old=$OLD new=$NEW"; ubus -S call network.interface.lan status | jsonfilter -e "@.up"
# --- M1: clean poweroff (driver stays attached to capture the message) -------
send poweroff
await reboot:\ Power\ down 90
EOS

echo "== driving guest (boot ~1-3 min under TCG) =="
if ! python3 scripts/qemu_console.py --port "$PORT" --script "$WORK/cmds-a.txt" \
		--transcript "$WORK/console.log" >"$WORK/results.txt" 2>"$WORK/driver.err"; then
	cat "$WORK/driver.err"
	echo "driver failed — console tail:"; tail -40 "$WORK/console.log"
	exit 3
fi

# --- host-side M3 check: WS 101 handshake through the slirp hostfwd ----------
# (while the guest is still alive — before the respawn/poweroff phase)
WS=$(python3 - "$WORK/wscheck.txt" <<'PY'
import base64, os, socket, sys
try:
    s = socket.create_connection(("127.0.0.1", 5000), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    req = ("GET / HTTP/1.1\r\nHost: 127.0.0.1:5000\r\nUpgrade: websocket\r\n"
           "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % key)
    s.sendall(req.encode())
    resp = s.recv(4096).decode("latin-1", "replace")
    open(sys.argv[1], "w").write(resp)
    print(resp.splitlines()[0] if resp else "EMPTY")
except OSError as e:
    print("CONN-FAIL", e)
PY
)
echo "  WS handshake reply: $WS"

if ! python3 scripts/qemu_console.py --port "$PORT" --script "$WORK/cmds-b.txt" \
		--transcript "$WORK/console.log" >>"$WORK/results.txt" 2>>"$WORK/driver.err"; then
	cat "$WORK/driver.err"
	echo "driver phase B failed — console tail:"; tail -40 "$WORK/console.log"
	exit 3
fi

echo
echo "=========================== RESULTS ==========================="
check M1_CPU        "neon.*vfpv4|vfpv4.*neon"
check M2_PID1       "^procd$"
check M2_UBUS       "service"
check M2_UBUS       "network"
check M2_UBUS       "system"
check M2_NET        "10\.0\.2\.15"
check M2_NET        "default via 10\.0\.2\.2"
check M2_NET        "nameserver"
check M2_UCI        "^dhcp$"
check M3_FEATURES   "websocket.*32bit|32bit.*websocket"
check M3_CHECK      "CHECKRC=0"
check M4_PTPLOCK    "\"locked\": true|\"locked\":true"
check M4_USRVCLOCK  "ptp-usrvclock"
check M4_STATIME_STATE "[0-9]"
check M4_INFERNO_PCM "inferno"
check M3_RUNNING    "Running"
check M2_RESPAWN    "new=[0-9]"
check M2_RESPAWN    "true"
if [ "$WS" = "HTTP/1.1 101 Switching Protocols" ]; then ok M3_WS_HANDSHAKE; else bad M3_WS_HANDSHAKE; echo "    got: $WS"; fi
if grep -q "^@@AWAITED reboot" "$WORK/results.txt"; then ok M1_POWEROFF; else bad M1_POWEROFF; fi
kill "$QPID" 2>/dev/null; wait "$QPID" 2>/dev/null

echo "==============================================================="
echo "PASS=$PASS FAIL=$FAIL${FAILED:+  failed:$FAILED}"
[ "$FAIL" -eq 0 ] && echo "M5 DoD: GREEN" || echo "M5 DoD: RED"
[ "${1:-}" = --keep ] || rm -rf "$WORK/wscheck.txt"
exit $(( FAIL > 0 ))
