#!/usr/bin/env python3
"""dante-l2node.py -- rootless host-side node on the QEMU mcast-socket L2 segment.

The test rig links its guests with `-netdev socket,mcast=GROUP:PORT`, which
tunnels full Ethernet frames over a UDP multicast group. Any host process
that joins the same group can participate at L2 -- no privileges needed.

This script becomes a virtual host on that segment:

  * answers ARP for its virtual IP (so guests can send UDP replies back),
  * sends/receives IPv4/UDP (only what we craft; no kernel stack involved),

and uses that to drive inferno's Dante ARC control server directly
(deps/inferno/inferno_aoip/src/device_server/arc_server.rs +
protocol/req_resp.rs + proto_arc.rs):

  packet (all big-endian):
    u16 start_code = 0x27ff
    u16 total_length          (header 10 + content)
    u16 seqnum
    u16 opcode1               0x3010 = set_channels_subscriptions
    u16 opcode2 = 0
    content:
      u8 space_items, u8 item_count,
      items of 6 bytes: u16 local_channel_id, u16 tx_channel_name_offset,
                        u16 tx_hostname_offset   (packet-relative offsets!)
      strings: NUL-terminated, shared area

  Nonzero offsets subscribe the RECEIVER's channel to "channel@hostname"
  (inferno's factory TX channel names are "01", "02", ...); zero offsets
  unsubscribe. The server binds UDP <device-ip>:4440.

Usage example (subscribe rx1..rx2 of 198.18.100.1 to tx 01..02 of rk3506b):
  dante-l2node.py --mcast 230.0.0.1:12346 subscribe --to 198.18.100.1 \
      --rx-host rk3506b --map 1=01 --map 2=02 [--remove]

Bridge rig (scripts/qemu-bridge.sh + native host grand master) — the host
is L2/L3-adjacent, so no tunnel/raw L2 is needed:
  dante-l2node.py --direct 198.18.100.254 subscribe --to 198.18.100.2 \
      --rx-host rk3506-source --map 1=01 --map 2=02
"""

import argparse
import socket
import struct
import sys
import time

ETH_P_IP = 0x0800
ETH_P_ARP = 0x0806
ARC_PORT = 4440
START_CODE = 0x27FF
OP_SET_SUBSCRIPTIONS = 0x3010
HEADER_LEN = 10
BROADCAST = b"\xff\xff\xff\xff\xff\xff"


def ip2n(ip):
    return struct.unpack(">I", socket.inet_aton(ip))[0]


def mac2b(mac):
    return bytes(int(x, 16) for x in mac.split(":"))


class L2Node:
    def __init__(self, mcast_host, mcast_port, node_ip, node_mac):
        self.node_ip_n = ip2n(node_ip)
        self.node_ip = node_ip
        self.node_mac = mac2b(node_mac)
        self.dest = (mcast_host, mcast_port)

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        mreq = struct.pack("=4sl", socket.inet_aton(mcast_host),
                           socket.INADDR_ANY)
        self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
                             mreq)
        self.sock.bind(("", mcast_port))
        self.sock.settimeout(0.2)

    # ---- receive side --------------------------------------------------

    def pump(self, seconds, want_dport):
        """Collect UDP payloads addressed to us; answer ARP meanwhile."""
        deadline = time.monotonic() + seconds
        got = []
        while time.monotonic() < deadline:
            try:
                data, _ = self.sock.recvfrom(9000)
            except socket.timeout:
                continue
            parsed = self.parse_eth(data)
            if parsed is None:
                continue
            ethertype, payload = parsed
            if ethertype == ETH_P_ARP:
                self.handle_arp(payload)
            elif ethertype == ETH_P_IP:
                udp = self.parse_ipv4_udp(payload)
                if udp is None:
                    continue
                src_ip, sport, dport, upayload = udp
                if dport == want_dport:
                    got.append((src_ip, sport, upayload))
        return got

    @staticmethod
    def parse_eth(data):
        if len(data) < 14:
            return None
        ethertype = struct.unpack(">H", data[12:14])[0]
        return ethertype, data[14:]

    def handle_arp(self, p):
        # layout: htype u16, ptype u16, hlen u8, plen u8, op u16,
        #         sha 6, spa 4, tha 6, tpa 4
        if len(p) < 28:
            return
        htype, ptype, hlen, plen, op = struct.unpack(">HHBBH", p[:8])
        if (htype, ptype, hlen, plen) != (1, ETH_P_IP, 6, 4) or op != 1:
            return
        sha, spa, tpa = p[8:14], p[14:18], p[24:28]
        if struct.unpack(">I", tpa)[0] != self.node_ip_n:
            return
        reply = (struct.pack(">HHBBH", 1, ETH_P_IP, 6, 4, 2)
                 + self.node_mac + struct.pack(">I", self.node_ip_n)
                 + sha + spa)
        frame = sha + self.node_mac + struct.pack(">H", ETH_P_ARP) + reply
        self.sock.sendto(frame, self.dest)

    @staticmethod
    def parse_ipv4_udp(p):
        if len(p) < 28 or (p[0] >> 4) != 4 or p[9] != 17:
            return None
        ihl = (p[0] & 0x0F) * 4
        total_len = struct.unpack(">H", p[2:4])[0]
        dst_ip = struct.unpack(">I", p[16:20])[0]
        src_ip = struct.unpack(">I", p[12:16])[0]
        u = p[ihl:max(ihl + 8, total_len)]
        if len(u) < 8:
            return None
        sport, dport, ulen = struct.unpack(">HHH", u[:6])
        return src_ip, sport, dport, u[8:ulen]

    # ---- send side -------------------------------------------------------

    def send_udp(self, dst_ip, dst_mac, dport, sport, payload):
        udp = struct.pack(">HHHH", sport, dport, 8 + len(payload), 0) + payload
        total = 20 + len(udp)
        ip = struct.pack(">BBHHHBBH", 0x45, 0, total, 0, 0, 64, 17, 0)
        ip += struct.pack(">II", self.node_ip_n, ip2n(dst_ip))
        ck = 0
        for i in range(0, len(ip), 2):
            ck += struct.unpack(">H", ip[i:i + 2])[0]
        while ck >> 16:
            ck = (ck & 0xFFFF) + (ck >> 16)
        ip = ip[:10] + struct.pack(">H", ~ck & 0xFFFF) + ip[12:]
        frame = (dst_mac + self.node_mac + struct.pack(">H", ETH_P_IP)
                 + ip + udp)
        self.sock.sendto(frame, self.dest)

    def arp_resolve(self, dst_ip, timeout=3.0):
        want = ip2n(dst_ip)
        req = (BROADCAST + self.node_mac + struct.pack(">H", ETH_P_ARP)
               + struct.pack(">HHBBH", 1, ETH_P_IP, 6, 4, 1)
               + self.node_mac + struct.pack(">I", self.node_ip_n)
               + b"\x00" * 6 + struct.pack(">I", want))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.sock.sendto(req, self.dest)
            end = time.monotonic() + 0.5
            while time.monotonic() < end:
                try:
                    data, _ = self.sock.recvfrom(9000)
                except socket.timeout:
                    break
                parsed = self.parse_eth(data)
                if not parsed or parsed[0] != ETH_P_ARP:
                    continue
                p = parsed[1]
                if len(p) < 28:
                    continue
                op = struct.unpack(">H", p[6:8])[0]
                sha, spa = p[8:14], p[14:18]
                if op == 2 and struct.unpack(">I", spa)[0] == want:
                    return sha
        return None


def make_sub_packet(mappings, host, remove=False, seq=0x4A1C):
    """mappings: [(local_channel_id, tx_channel_name), ...]"""
    n = len(mappings)
    strings = b""
    items = []
    for local, txname in mappings:
        if not remove:
            name_off = HEADER_LEN + 2 + 6 * n + len(strings)
            strings += txname.encode() + b"\x00"
            items.append((local, name_off))
        else:
            items.append((local, 0))
    host_off = HEADER_LEN + 2 + 6 * n + len(strings)
    strings += host.encode() + b"\x00"
    item_bytes = b"".join(
        struct.pack(">HHH", local, name_off,
                    0 if remove else host_off)
        for local, name_off in items)
    content = bytes([n, n]) + item_bytes + strings
    total = HEADER_LEN + len(content)
    header = struct.pack(">HHHHH", START_CODE, total, seq,
                         OP_SET_SUBSCRIPTIONS, 0)
    return header + content


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mcast", default=None, help="GROUP:PORT of the "
                   "QEMU socket,mcast segment (mcast-tunnel rig)")
    # bridge rig (scripts/qemu-bridge.sh): the host is natively adjacent to
    # the guests — a plain UDP socket from the bridge IP is all it takes
    ap.add_argument("--direct", default=None, metavar="SRC_IP",
                    help="bridge rig: send via plain UDP bound to SRC_IP "
                   "(e.g. 198.18.100.254); no mcast tunnel, no raw L2")
    ap.add_argument("--node-ip", default="198.18.100.9")
    ap.add_argument("--node-mac", default="02:00:00:00:00:09")
    ap.add_argument("command", choices=["subscribe"])
    ap.add_argument("--to", required=True, help="receiver guest IP")
    ap.add_argument("--rx-host", required=True,
                    help="transmitter hostname (inferno device name)")
    ap.add_argument("--map", action="append", default=[],
                    help="local=txname, e.g. 1=01 (repeatable; default 1=01)")
    ap.add_argument("--remove", action="store_true", help="unsubscribe")
    ap.add_argument("--wait", type=float, default=3.0)
    args = ap.parse_args()

    if not args.mcast and not args.direct:
        ap.error("need --mcast GROUP:PORT (tunnel rig) or --direct SRC_IP "
                 "(bridge rig)")

    mappings = []
    for m in (args.map or ["1=01"]):
        local, txname = m.split("=", 1)
        mappings.append((int(local), txname))

    sport = ARC_PORT + 1000
    pkt = make_sub_packet(mappings, args.rx_host, remove=args.remove)

    if args.direct:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((args.direct, sport))
        sock.settimeout(args.wait)
        sock.sendto(pkt, (args.to, ARC_PORT))
        print("sent subscription packet to %s:%d via %s (%d mapping(s), "
              "tx host '%s'%s)"
              % (args.to, ARC_PORT, args.direct, len(mappings), args.rx_host,
                 ", REMOVE" if args.remove else ""))
        print("packet: %s" % pkt.hex())
        try:
            data, addr = sock.recvfrom(2048)
            print("ARC reply from %s:%d: %s" % (addr[0], addr[1], data.hex()))
        except socket.timeout:
            print("no ARC reply within %.1fs (packet may still have been "
                  "applied)" % args.wait)
        return 0

    mhost, mport = args.mcast.rsplit(":", 1)
    node = L2Node(mhost, int(mport), args.node_ip, args.node_mac)

    dst_mac = node.arp_resolve(args.to)
    if dst_mac is None:
        print("ERROR: no ARP reply from %s (guest up?)" % args.to)
        return 1
    print("resolved %s -> %s" % (args.to, dst_mac.hex(":")))

    node.send_udp(args.to, dst_mac, ARC_PORT, sport, pkt)
    print("sent subscription packet to %s:%d (%d mapping(s), tx host '%s'%s)"
          % (args.to, ARC_PORT, len(mappings), args.rx_host,
             ", REMOVE" if args.remove else ""))
    print("packet: %s" % pkt.hex())

    for src_ip, sport_r, payload in node.pump(args.wait, want_dport=sport):
        print("ARC reply from %s:%d: %s"
              % (socket.inet_ntoa(struct.pack(">I", src_ip)), sport_r,
                 payload.hex()))
        return 0
    print("no ARC reply within %.1fs (packet may still have been applied)"
          % args.wait)
    return 0


if __name__ == "__main__":
    sys.exit(main())
