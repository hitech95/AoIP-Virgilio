#!/usr/bin/env bash
# Two-instance M4 test: guest B (PTPv2 master, .2) <-> guest A (slave, .1)
# over a rootless QEMU socket link; then arecord from the inferno plugin.
set -u
cd /home/nicolo/Documenti/Progetti/dante

LOG=/tmp/two-guests
rm -f "${LOG}"{A,B}.log /tmp/opencode/rx.wav

# --- guest B: PTPv2 master ---------------------------------------------------
{ sleep 15; echo ""; sleep 3
  echo "uci -q batch <<EOF
set network.aoip.proto='static'
set network.aoip.ipaddr='198.18.100.2'
set network.aoip.netmask='255.255.255.0'
delete network.aoip.gateway
delete network.aoip.dns
set statime.main.priority1='128'
commit network
commit statime
EOF
echo B-NET-OK"
  sleep 4
  echo "/etc/init.d/network restart >/dev/null 2>&1; service statime restart; echo B-RESTARTED"
  sleep 12
  echo "ip -4 addr show eth1 | grep inet; logread | grep -E 'new state|Master|Slave' | tail -3; echo B-DONE"
  sleep 100
} | timeout 150 ./scripts/run-qemu.sh --net socket-listen --peer 127.0.0.1:12345 --mac 00:11:22:33:44:56 > "${LOG}B.log" 2>&1 &
BPID=$!
sleep 5

# --- guest A: PTPv2 slave + inferno capture ----------------------------------
{ sleep 15; echo ""; sleep 3
  echo "uci -q batch <<EOF
set network.aoip.proto='static'
set network.aoip.ipaddr='198.18.100.1'
set network.aoip.netmask='255.255.255.0'
delete network.aoip.gateway
delete network.aoip.dns
commit network
EOF
echo A-NET-OK"
  sleep 4
  echo "/etc/init.d/network restart >/dev/null 2>&1; service statime restart; echo A-RESTARTED"
  sleep 15
  echo "logread | grep -E 'new state|Master|Slave' | tail -4; echo A-STATE"
  sleep 3
  echo "ping -c 2 -W 2 198.18.100.2 >/dev/null 2>&1 && echo PING-B-OK || echo PING-B-FAIL"
  sleep 4
  echo "INFERNO_BIND_IP=198.18.100.1 arecord -D inferno -f S32_LE -r 48000 -c 2 -d 8 /tmp/rx.wav > /tmp/arec2.log 2>&1; echo RC=\$?; ls -la /tmp/rx.wav; grep -viE 'neli|HW_|PERIOD|BUFFER|TICK|^CHANNELS|^RATE|^FRAME|^SAMPLE' /tmp/arec2.log | tail -12; echo A-ARECORD-DONE"
  sleep 12
  echo "nc 10.0.2.2 1 </dev/null 2>/dev/null; logread | grep -iE 'clock|start time' | tail -5; echo A-DONE"
  sleep 30
} | timeout 140 ./scripts/run-qemu.sh --net socket-connect --peer 127.0.0.1:12345 > "${LOG}A.log" 2>&1 &
APID=$!

wait $APID 2>/dev/null
kill $BPID 2>/dev/null; wait $BPID 2>/dev/null
echo "=== B (master) ==="; sed -n '/B-NET-OK/,$p' "${LOG}B.log" | grep -vE '^\s*$' | head -15
echo "=== A (slave) ==="; sed -n '/A-NET-OK/,$p' "${LOG}A.log" | grep -vE '^\s*$' | head -30
