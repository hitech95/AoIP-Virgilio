#!/usr/bin/env bash
# qemu-bridge.sh up|down [isolated|real] — host bridge for the Dante/PTP
# segment with a NATIVE host statime as grand master (bridge rig).
#
# Modes:
#   isolated (default)  guests-only lab segment; the physical NIC is NOT
#                       touched (it stays under NetworkManager):
#     br-dante 198.18.100.254/24 ──┬── tap0 (source guest, .1)
#                                  ├── tap1 (sink guest,   .2)
#                                  └── host statime GM (priority1 10)
#     guests get internet via NAT (guest uci: aoip/lan gw 198.18.100.254).
#
#   real                the segment IS the physical network: br-dante becomes
#                       a NetworkManager bridge with the USB-Ethernet dongle
#                       enslaved, DHCP from the home router for host AND
#                       guests (same L2 as the real Dante devices). No NAT.
#                       GM config unchanged (binds br-dante, priority1 10).
#
# Guests attach with: run-qemu.sh --net tap:tap0 / --net tap:tap1.
# GM config: scripts/statime-gm.toml, run with ~/.local/bin/statime-gm.
#
# Needs root (tuntap, bridge, nmcli system connections). Idempotent; taps
# are created owned by the invoking user so QEMU opens them unprivileged.
# `down` removes only what the matching `up` created (mode is recorded in
# /run/br-dante.mode).
set -euo pipefail

BR=br-dante
BR_IP=198.18.100.254/24
SUBNET=198.18.100.0/24
TAPS=(tap0 tap1)
OWNER="${SUDO_USER:-root}"
STATE="/run/${BR}.mode"
# USB-Ethernet dongle (MAC-derived name; override with DONGLE=... env)
DONGLE="${DONGLE:-enx0c37963a7764}"

have_dongle() { ip link show "$DONGLE" >/dev/null 2>&1; }

make_taps() {
  for t in "${TAPS[@]}"; do
    if ! ip link show "$t" >/dev/null 2>&1; then
      ip tuntap add dev "$t" mode tap user "$OWNER"
      ip link set "$t" master "$BR"
      ip link set "$t" up
      echo "created ${t} (owner ${OWNER})"
    fi
  done
}

up_isolated() {
  if ! ip link show "$BR" >/dev/null 2>&1; then
    ip link add "$BR" type bridge
    ip addr add "$BR_IP" dev "$BR"
    ip link set "$BR" up
    echo "created ${BR} (${BR_IP})"
  fi
  make_taps

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
  echo isolated > "$STATE"
  echo "bridge rig ready (isolated): ${BR} + ${TAPS[*]} (gw ${BR_IP%%/*}, NAT; NIC ${DONGLE} untouched)"
}

up_real() {
  [ "$(cat "$STATE" 2>/dev/null)" = real ] || ip link show "$BR" >/dev/null 2>&1 && {
    echo "error: ${BR} already exists — run '$0 down' first" >&2
    exit 1
  } || true
  have_dongle || { echo "error: dongle ${DONGLE} not present" >&2; exit 1; }

  # bridge + slave as NM connections: the NIC STAYS under NetworkManager
  # (as a bridge port); multicast_snooping off so PTP/mDNS flood the L2.
  if ! nmcli -g GENERAL.STATE connection show "${BR}" >/dev/null 2>&1; then
    nmcli con add type bridge ifname "${BR}" con-name "${BR}" \
      bridge.stp no bridge.multicast-snooping no ipv6.method disabled
    have_dongle && nmcli con add type bridge-slave ifname "${DONGLE}" master "${BR}"
    echo "created NM bridge ${BR} (slave ${DONGLE})"
  fi
  nmcli con up "${BR}"

  make_taps
  echo real > "$STATE"
  BRADDR=$(ip -4 -o addr show "$BR" | awk '{print $4; exit}')
  echo "bridge rig ready (real): ${BR} + ${TAPS[*]} (${BRADDR:-no lease yet}; Dante on the physical LAN)"
}

down_isolated() {
  iptables -t nat -D POSTROUTING -s "${SUBNET}" ! -o "$BR" -j MASQUERADE 2>/dev/null || true
  iptables -D FORWARD -i "$BR" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -o "$BR" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  for t in "${TAPS[@]}"; do
    ip link del "$t" 2>/dev/null && echo "removed ${t}" || true
  done
  ip link del "$BR" 2>/dev/null && echo "removed ${BR}" || true
  rm -f "$STATE"
}

down_real() {
  for t in "${TAPS[@]}"; do
    ip link del "$t" 2>/dev/null && echo "removed ${t}" || true
  done
  if nmcli -g GENERAL.STATE connection show "${BR}" >/dev/null 2>&1; then
    nmcli con down "${BR}" 2>/dev/null || true
    nmcli con del "${BR}"   # deletes the slave con too: NIC returns to its own connection
    echo "removed NM bridge ${BR} (${DONGLE} back under its own connection)"
  fi
  rm -f "$STATE"
}

MODE="${2:-}"
case "${1:-}" in
  up)
    case "$MODE" in
      isolated|"") up_isolated ;;
      real) up_real ;;
      *) echo "unknown mode '$MODE' (isolated|real)" >&2; exit 1 ;;
    esac ;;
  down)
    case "$MODE" in
      isolated) down_isolated ;;
      real) down_real ;;
      "") # no mode given: undo whatever is recorded (or try isolated legacy)
        if [ "$(cat "$STATE" 2>/dev/null)" = real ]; then down_real; else down_isolated; fi ;;
      *) echo "unknown mode '$MODE' (isolated|real)" >&2; exit 1 ;;
    esac ;;
  *)
    sed -n '2,16p' "$0"
    echo "usage: sudo $0 up|down [isolated|real]"
    exit 1 ;;
esac
