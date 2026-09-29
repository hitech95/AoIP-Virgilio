#!/bin/sh
# netifd proto handler: zcip (busybox) — RFC 3927 IPv4 link-local
# addressing. Product default for the 'aoip' interface: guarantees the
# Dante/PTP segment always has an address, standalone on a bare switch
# included. Combined topology keeps DHCP/static (network.lan) as the
# preferred global address on the same device; zcip only ever manages
# 169.254/16. RFC timings (probing/defense) stay at the busybox
# defaults — conflict storms are the classic Auto-IP failure mode.

[ -x /sbin/zcip ] || exit 0

. /lib/functions.sh
. ../netifd-proto.sh
init_proto "$@"

proto_zcip_init_config() {
	# optional preferred address (must be inside 169.254/16), passed to
	# zcip -r; unset = random per RFC 3927
	proto_config_add_string 'ipaddr:ipaddr'
}

proto_zcip_setup() {
	local config="$1"
	local iface="$2"

	local ipaddr
	json_get_vars ipaddr

	proto_export "INTERFACE=$config"
	# -f: stay in the foreground under netifd supervision (no -q:
	# ARP-conflict defense must run for the lifetime of the interface)
	proto_run_command "$config" zcip -f \
		${ipaddr:+-r "$ipaddr"} \
		"$iface" /lib/netifd/zcip.script
}

proto_zcip_teardown() {
	local interface="$1"
	proto_kill_command "$interface"
}

add_protocol zcip
