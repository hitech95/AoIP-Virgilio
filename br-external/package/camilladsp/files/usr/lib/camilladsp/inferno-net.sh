# Shared by the camilladsp hotplug handlers: resolve the netdev inferno
# binds and its preferred IPv4. Keep the resolution semantics in sync
# with camilladsp-genconf / statime init (logical name -> device) and
# with inferno patch 0004 (first global IPv4, else first address).

cdsp_inferno_dev() {
	local inferno_if dev
	config_load camilladsp
	config_get inferno_if main interface aoip
	config_load network
	config_get dev "$inferno_if" device ""
	if [ -n "$dev" ]; then
		echo "$dev"
	elif [ -e "/sys/class/net/$inferno_if" ]; then
		echo "$inferno_if"
	fi
}

# first GLOBAL IPv4 (169.254/16 is scope link for ip(8)), else first of any
cdsp_preferred_addr() {
	ip -4 -o addr show dev "$1" scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1
}

cdsp_preferred_addr_any() {
	ip -4 -o addr show dev "$1" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1
}
