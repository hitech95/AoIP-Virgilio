#!/usr/bin/env bash
# Real audio-flow test (M4 optional DoD): Dante source -> sync -> sink.
#
# Topology (all rootless):
#   guest B (PTP master, rk3506b, 198.18.100.2) --\
#                                                   +- QEMU mcast L2 tunnel
#   guest A (PTP slave,  rk3506a, 198.18.100.1) --/   230.0.0.1:12346
#   host "l2 node" 198.18.100.9 (scripts/dante-l2node.py)
#
# Audio path (the product path, via our uci pipeline):
#   B: /tmp/src.raw = 16x the M3 test signal (RawFile capture, 48 s) ->
#      camilladsp -> Inferno TX (Dante flows to A; subscriptions created
#      by the host l2 node speaking inferno's ARC protocol on UDP 4440)
#   A: camilladsp Inferno RX -> /tmp/rx.wav, started by ptp-monitor/hotplug
#      at clock lock and left completely untouched (the live instance
#      holds the subscription).
#
# PASS: in A's recording both channels carry the tone with the source's
# per-second fingerprint (Lrms ~13706 Rrms ~12423, Lzcr ~3280 Rzcr ~2900)
# for several seconds; the file starts as silence before B's transmitter.
#
# NB: A is never restarted after the subscription -- inferno state
# persistence aside, the flow is held by the running instance. B's source
# is made long enough that procd's crash-loop threshold is never reached
# during the measurement window (camilladsp exits at RawFile EOF).
set -u
cd /home/nicolo/Documenti/Progetti/dante

LOG=/tmp/audio-flow
MCAST=230.0.0.1:12346
rm -f "${LOG}"{A,B}.log

# --- guest B: master + transmitter -------------------------------------------
{ sleep 20; echo ""; sleep 3
  echo "uci -q batch <<EOF
set system.@system[0].hostname='rk3506b'
set network.aoip.proto='static'
set network.aoip.ipaddr='198.18.100.2'
set network.aoip.netmask='255.255.255.0'
delete network.aoip.gateway
delete network.aoip.dns
set statime.main.priority1='128'
set camilladsp.main.enabled='0'
set camilladsp.main.capture='RawFile:/tmp/src.raw'
set camilladsp.main.playback='Inferno'
set camilladsp.main.channels='2'
set camilladsp.main.output_channels='2'
set camilladsp.main.samplerate='44100'
set camilladsp.main.format='S16_LE'
commit system
commit network
commit statime
commit camilladsp
EOF
hostname rk3506b
echo B-NET-OK"
  sleep 4
  echo "/etc/init.d/network stop camilladsp 2>/dev/null; service camilladsp stop; /etc/init.d/network restart >/dev/null 2>&1; service statime restart; echo B-RESTARTED"
  sleep 50
  echo "for i in 1 2 3 4 5 6 7 8; do ubus call ptp status | grep -q '\"locked\": true' && break; sleep 3; done; ubus call ptp status | grep -E 'locked|shift_ns'; echo B-LOCKED"
  sleep 5
  # 16x the 3 s test signal (body only, no per-copy headers) = 48 s source
  echo "tail -c +45 /usr/share/camilladsp/test.wav > /tmp/b1; for i in 1 2 3 4; do cat /tmp/b1 /tmp/b1 > /tmp/b2; mv /tmp/b2 /tmp/b1; done; mv /tmp/b1 /tmp/src.raw; wc -c /tmp/src.raw; echo B-SRC-READY"
  sleep 3
  echo "uci set camilladsp.main.enabled='1' && uci commit camilladsp && /etc/init.d/camilladsp start; sleep 2; pidof camilladsp; echo B-TX-STARTED"
  sleep 75
  echo "logread | grep -iE 'flows_tx|connection' | tail -4; pidof camilladsp; echo B-DONE"
  sleep 10
} | timeout 190 ./scripts/run-qemu.sh --net socket-mcast --peer "$MCAST" --mac 00:11:22:33:44:56 > "${LOG}B.log" 2>&1 &
BPID=$!

# --- guest A: slave + receiver (started by ptp-monitor, never restarted) ------
{ sleep 20; echo ""; sleep 3
  echo "uci -q batch <<EOF
set system.@system[0].hostname='rk3506a'
set network.aoip.proto='static'
set network.aoip.ipaddr='198.18.100.1'
set network.aoip.netmask='255.255.255.0'
delete network.aoip.gateway
delete network.aoip.dns
set camilladsp.main.playback='File:/tmp/rx.wav'
set camilladsp.main.samplerate='44100'
set camilladsp.main.format='S16_LE'
set camilladsp.main.wav_header='1'
commit system
commit network
commit camilladsp
EOF
hostname rk3506a
echo A-NET-OK"
  sleep 4
  echo "/etc/init.d/network restart >/dev/null 2>&1; service statime restart; echo A-RESTARTED"
  sleep 70
  echo "for i in 1 2 3 4 5 6 7 8; do ubus call ptp status | grep -q '\"locked\": true' && break; sleep 3; done; ubus call ptp status | grep -E 'locked|shift_ns'; echo A-LOCKED"
  sleep 55
  echo "logread | grep -iE 'channels_subscriber|flow' | tail -8; echo A-LOGS"
  sleep 3
  echo "service camilladsp stop; sleep 2; wc -c /tmp/rx.wav; echo A-STOPPED"
  sleep 3
  echo "rm -f /tmp/blk.txt; for s in 0 1 2 3 4 5; do tail -c +\$((9172845+s*176400)) /tmp/rx.wav 2>/dev/null | head -c 176400 | od -An -td2 -w2 >> /tmp/blk.txt; done; wc -l /tmp/blk.txt; awk '{s=\$1; n=NR-1; sec=int(n/88200); side=(n%2); if(side==0){L[sec]+=s*s; if(s>0&&pL<=0||s<0&&pL>=0)zL[sec]++}else{R[sec]+=s*s; if(s>0&&pR<=0||s<0&&pR>=0)zR[sec]++}; if(side==0)pL=s; if(side==1)pR=s} END{printf \"sec Lrms Lzcr Rrms Rzcr verdict\n\"; t=0; for(k=0;k<=sec;k++){lr=int(sqrt(L[k]/44100)); rr=int(sqrt(R[k]/44100)); lz=(k in zL)?zL[k]:0; rz=(k in zR)?zR[k]:0; ok=(lr>12500&&lr<15000&&rr>11000&&rr<13800&&lz>3100&&lz<3450&&rz>2700&&rz<3100)?\"TONE\":\"----\"; if(ok)t++; printf \"%d %d %d %d %d %s\n\",k,lr,lz,rr,rz,ok} printf \"TONE-SECONDS=%d\n\",t}' /tmp/blk.txt; echo A-ANALYSIS"
  sleep 55
} | timeout 235 ./scripts/run-qemu.sh --net socket-mcast --peer "$MCAST" --mac 00:11:22:33:44:55 > "${LOG}A.log" 2>&1 &
APID=$!

# --- host: subscribe A's rx1+rx2 to B's tx01+tx02 once both sides are up ------
sleep 85
for i in 1 2 3; do
  ./scripts/dante-l2node.py --mcast "$MCAST" subscribe --to 198.18.100.1 \
    --rx-host rk3506b --map 1=01 --map 2=02 && break
  echo "subscribe attempt $i failed, retrying"; sleep 5
done

wait $APID $BPID 2>/dev/null
echo "=== A (receiver) ==="; sed -n '/A-LOCKED/,$p' "${LOG}A.log" | grep -vE '^\s*$' | tail -35
echo "=== B (transmitter) ==="; sed -n '/B-LOCKED/,$p' "${LOG}B.log" | grep -vE '^\s*$' | grep -v "^root@\|^for i\|^uci set\|^ft_ns" | head -12
