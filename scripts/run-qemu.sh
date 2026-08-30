#!/usr/bin/env bash
# Run the firmware in QEMU (see plan/plan.md, section 6).
# NOTE: "reboot: Power down" on the console does NOT exit QEMU (PSCI
# SYSTEM_OFF on virt/cortex-a7 doesn't terminate the process) — quit manually
# with Ctrl-A X once poweroff is reached.
# Options:
#   --mem 128|256|512          RAM profile
#   --net user                 simple mode: single NIC eth0 = slirp (DHCP,
#                              internet, hostfwd tcp:5000)
#   --net socket-listen|socket-connect|socket-mcast|tap
#                              rig mode: the backend becomes eth1, the
#                              dedicated Dante/PTP segment (statime+inferno
#                              bind it; static IP per rig via uci). A slirp
#                              management NIC (eth0: DHCP, internet, host
#                              10.0.2.2) is auto-attached in these modes —
#                              no separate option needed.
#   --peer 127.0.0.1:12345     socket address / mcast group for socket backends
#   --mac 00:11:22:33:44:55    guest MAC (statime rejects locally-administered
#                              MACs — use a unicast globally-scoped value;
#                              MUST differ between linked instances)
#   --mac2 52:54:00:12:34:57   MAC of the auto slirp management NIC (eth0) in
#                              rig mode. MUST be unicast (bit0 of the first
#                              octet clear): a multicast MAC leaves the link
#                              carrier DOWN and nothing works. Locally-
#                              administered is fine (no PTP on eth0).
#   --no-mgmt                  rig mode only: skip the auto slirp management
#                              NIC — guests run with the SINGLE AoIP interface
#                              (eth1) and get internet via the host bridge
#                              default route (scripts/qemu-bridge.sh, gateway
#                              198.18.100.254). Host reaches guests directly,
#                              so --fwd is not needed in this mode.
#   --fwd 5001:5000            forward host TCP port -> guest port through the
#                              slirp management NIC (repeatable, loopback-only
#                              on the host). Use it to reach each guest's
#                              camilladsp server (port 5000) from the host:
#                              source --fwd 5001:5000, sink --fwd 5002:5000
#   --audio none|aloop|virtio-snd|virtio-snd-wav   --smp N
#   --console stdio|telnet[:port]  serial console on a host TCP port
#                              (default stdio; telnet lets you attach to a
#                              background guest any time: telnet 127.0.0.1 PORT)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGES="${ROOT}/output/images"

MEM="512"
NET="user"
PEER="127.0.0.1:12345"
MAC="00:11:22:33:44:55"
MAC2="52:54:00:12:34:57"
AUDIO="none"
SMP="3"
WAV_PATH="/tmp/guest-out.wav"
CONSOLE="stdio"
CONSOLE_PORT="5555"
FWD_SPECS=()
FWD_JOIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mem)   MEM="$2"; shift 2 ;;
    --net)   NET="$2"; shift 2 ;;
    --peer)  PEER="$2"; shift 2 ;;
    --mac)   MAC="$2"; shift 2 ;;
    --mac2)  MAC2="$2"; shift 2 ;;
    --audio) AUDIO="$2"; shift 2 ;;
    --smp)   SMP="$2"; shift 2 ;;
    --fwd)   FWD_SPECS+=("$2"); shift 2 ;;
    --no-mgmt) NO_MGMT=1; shift ;;
    --console) CONSOLE="${2%%:*}"; [ "${2#*:}" != "$2" ] && CONSOLE_PORT="${2#*:}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# A multicast MAC (bit0 of the first octet set, e.g. 55:...) is not a valid
# station address: the virtio link carrier stays down and DHCP never works.
for m in "${MAC}" "${MAC2}"; do
  first=$(printf '%d' "0x${m%%:*}")
  if [ $((first & 1)) -ne 0 ]; then
    echo "multicast MAC not allowed: ${m} (first octet must have bit0 clear)" >&2
    exit 1
  fi
done

# --fwd specs -> ",hostfwd=tcp:127.0.0.1:H-:G" fragments for the slirp netdevs
for f in "${FWD_SPECS[@]}"; do
  case "$f" in
    [0-9]*:[0-9]*) FWD_JOIN+=",hostfwd=tcp:127.0.0.1:${f%%:*}-:${f##*:}" ;;
    *) echo "invalid --fwd value: ${f} (expected HOSTPORT:GUESTPORT)" >&2; exit 1 ;;
  esac
done

AUDIO_ARGS=()
case "${AUDIO}" in
  none)             AUDIO_ARGS+=(-audiodev none,id=snd0 -device virtio-sound,audiodev=snd0) ;;
  aloop)            : ;; # snd-aloop lives inside the guest, no QEMU audio device
  virtio-snd)        AUDIO_ARGS+=(-audiodev none,id=snd0 -device virtio-sound,audiodev=snd0) ;;
  virtio-snd-wav)    AUDIO_ARGS+=(-audiodev wav,id=snd0,path="${WAV_PATH}" -device virtio-sound,audiodev=snd0) ;;
  # guest virtio-snd output plays directly on the host sound server
  # (PipeWire/PulseAudio socket in XDG_RUNTIME_DIR)
  virtio-snd-pa)     AUDIO_ARGS+=(-audiodev pa,id=snd0 -device virtio-sound,audiodev=snd0) ;;
  *) echo "unknown --audio value: ${AUDIO}" >&2; exit 1 ;;
esac

# --- NIC layout --------------------------------------------------------------
# eth0 = management: DHCP + internet via slirp, present on EVERY boot (guest
#       10.0.2.15, host 10.0.2.2, DNS 10.0.2.3). General purpose — multicast
#       allowed but not required. hostfwd tcp:5000 only in simple mode
#       (--net user): rig mode runs several background guests that would
#       collide on the same host port.
# eth1 = Dante/PTP segment: the --net backend (socket-mcast/socket-listen/
#       socket-connect/tap), bound by statime + inferno; static IP per rig
#       via uci (overlay default: network.aoip proto 'none').
#
# NICs use virtio-net-pci so guest names follow command-line order
# deterministically (PCI slot order; MGMT_ARGS is emitted first below).
# -M virt,highmem=off is REQUIRED: our kernel is 32-bit ARM without LPAE,
# and QEMU >= 9 otherwise places the PCIe ECAM window above 4 GB
# (0x4010000000), which a non-LPAE kernel cannot address — pci-host-generic
# then fails probing with -EOVERFLOW ("missing reg property") and no NIC
# appears. highmem=off keeps ECAM + MMIO windows below 4 GB (RAM capped at
# ~3 GB; we use <= 512 MB). Verify naming any time with:
#   for f in /sys/class/net/eth*; do echo $f $(cat $f/address); done
MGMT_ARGS=()  # auto slirp management NIC (eth0) in rig mode
NET_ARGS=()   # the --net backend: eth0 in simple mode, eth1 in rig mode
case "${NET}" in
  user)
    NET_ARGS+=(-netdev "user,id=eth0,hostfwd=tcp::5000-:5000${FWD_JOIN}" -device virtio-net-pci,netdev=eth0,mac="${MAC}") ;;
  tap|tap:*)
    # tap[:ifname] — attach eth1 to a host tap (see scripts/qemu-bridge.sh:
    # bridge rig with a native host statime grand master). ifname defaults
    # to tap0; source uses tap0, sink tap1
    TAP_IF="tap0"; [[ "$NET" == tap:* ]] && TAP_IF="${NET#tap:}"
    MGMT_ARGS+=(-netdev "user,id=eth0${FWD_JOIN}" -device virtio-net-pci,netdev=eth0,mac="${MAC2}")
    NET_ARGS+=(-netdev tap,id=eth1,ifname="${TAP_IF}",script=no,downscript=no -device virtio-net-pci,netdev=eth1,mac="${MAC}") ;;
  socket-listen)
    MGMT_ARGS+=(-netdev "user,id=eth0${FWD_JOIN}" -device virtio-net-pci,netdev=eth0,mac="${MAC2}")
    NET_ARGS+=(-netdev socket,id=eth1,listen="${PEER}" -device virtio-net-pci,netdev=eth1,mac="${MAC}") ;;
  socket-connect)
    MGMT_ARGS+=(-netdev "user,id=eth0${FWD_JOIN}" -device virtio-net-pci,netdev=eth0,mac="${MAC2}")
    NET_ARGS+=(-netdev socket,id=eth1,connect="${PEER}" -device virtio-net-pci,netdev=eth1,mac="${MAC}") ;;
  socket-mcast)
    # shared L2 segment over a UDP multicast tunnel; any host process that
    # joins the same group can speak (raw) L2 on the segment — this is how
    # scripts/dante-l2node.py reaches the guests rootless
    MGMT_ARGS+=(-netdev "user,id=eth0${FWD_JOIN}" -device virtio-net-pci,netdev=eth0,mac="${MAC2}")
    NET_ARGS+=(-netdev socket,id=eth1,mcast="${PEER}" -device virtio-net-pci,netdev=eth1,mac="${MAC}") ;;
  *) echo "unknown --net value: ${NET}" >&2; exit 1 ;;
esac

# single-NIC mode: drop the management slirp NIC (internet then flows through
# the host bridge default route — see scripts/qemu-bridge.sh). Runs AFTER the
# NET case, which is what fills MGMT_ARGS.
if [ -n "${NO_MGMT:-}" ]; then
  if [ "$NET" = "user" ]; then
    echo "--no-mgmt is only valid in rig mode (--net socket-*/tap)" >&2
    exit 1
  fi
  MGMT_ARGS=()
fi

DISPLAY_ARGS=(-nographic)
case "${CONSOLE}" in
  stdio) : ;;
  telnet) DISPLAY_ARGS=(-display none -monitor none \
    -serial "telnet:127.0.0.1:${CONSOLE_PORT},server,nowait") ;;
  *) echo "unknown --console value: ${CONSOLE}" >&2; exit 1 ;;
esac

exec qemu-system-arm \
  -M virt,highmem=off -cpu cortex-a7 -smp "${SMP}" -m "${MEM}M" -snapshot "${DISPLAY_ARGS[@]}" \
  -kernel "${IMAGES}/zImage" \
  -append "console=ttyAMA0,115200 rw rootwait root=/dev/vda" \
  "${MGMT_ARGS[@]}" \
  "${NET_ARGS[@]}" \
  -drive file="${IMAGES}/rootfs.ext4",if=none,format=raw,id=hd0 \
  -device virtio-blk-device,drive=hd0 \
  "${AUDIO_ARGS[@]}"
