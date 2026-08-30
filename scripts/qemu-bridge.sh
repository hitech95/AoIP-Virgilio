#!/usr/bin/env bash
# qemu-bridge.sh up|down — host bridge for the Dante/PTP segment with a
# NATIVE host statime as grand master (bridge rig; see plan D15).
#
#   br-dante 198.18.100.254/24  ──┬── tap0 (source guest, eth1, .1)
#                                  ├── tap1 (sink guest,   eth1, .2)
#                                  └── host statime GM (priority1 10)
#
# Guests attach with:  run-qemu.sh --net tap:tap0 ... / --net tap:tap1 ...
# The host GM config lives in /tmp/opencode/statime-gm.toml; start it with
# /tmp/opencode/statime-target/release/statime --config <that file>.
#
# Needs root (tuntap + bridge). Idempotent; taps are created owned by the
# invoking user so QEMU can open them without privileges.
set -euo pipefail

BR=br-dante
BR_IP=198.18.100.254/24
SUBNET=198.18.100.0/24
TAPS=(tap0 tap1)
OWNER="${SUDO_USER:-root}"

up() {
  if ! ip link show "$BR" >/dev/null 2>&1; then
    ip link add "$BR" type bridge
    ip addr add "$BR_IP" dev "$BR"
    ip link set "$BR" up
    echo "created ${BR} (${BR_IP})"
  fi
  for t in "${TAPS[@]}"; do
    if ! ip link show "$t" >/dev/null 2>&1; then
      ip tuntap add dev "$t" mode tap user "$OWNER"
      ip link set "$t" master "$BR"
      ip link set "$t" up
      echo "created ${t} (owner ${OWNER})"
    fi
  done

  # internet for the guests via default route + NAT (single-NIC mode):
  #   guest uci: network.aoip.gateway='198.18.100.254' dns='9.9.9.9'
  sysctl -qw net.ipv4.ip_forward=1
  if iptables -t nat -C POSTROUTING -s "${SUBNET}" ! -o "$BR" -j MASQUERADE 2>/dev/null; then
    :
  else
    iptables -t nat -A POSTROUTING -s "${SUBNET}" ! -o "$BR" -j MASQUERADE
    echo "added NAT for ${SUBNET}"
  fi
  for rule in "-i $BR -j ACCEPT" "-o $BR -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"; do
    if ! iptables -C FORWARD ${rule} 2>/dev/null; then
      iptables -A FORWARD ${rule}
    fi
  done
  echo "bridge rig ready: ${BR} + ${TAPS[*]} (gateway ${BR_IP%%/*}, NAT active)"
}

down() {
  iptables -t nat -D POSTROUTING -s "${SUBNET}" ! -o "$BR" -j MASQUERADE 2>/dev/null || true
  iptables -D FORWARD -i "$BR" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -o "$BR" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  for t in "${TAPS[@]}"; do
    ip link del "$t" 2>/dev/null && echo "removed ${t}" || true
  done
  ip link del "$BR" 2>/dev/null && echo "removed ${BR}" || true
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) sed -n '2,5p' "$0"; echo "usage: sudo $0 up|down"; exit 1 ;;
esac
