# 10-status.sh — dynamic login banner (the ASCII art stays in /etc/motd;
# everything here is read from the running environment).

# shellcheck shell=sh disable=SC2016

_board="$(cat /tmp/sysinfo/board_name 2>/dev/null)"
[ -n "$_board" ] || _board="generic"
_model="$(cat /tmp/sysinfo/model 2>/dev/null)"
[ -n "$_model" ] || _model="unknown model"

echo "    board : ${_board} (${_model})"
echo "    host  : $(hostname) · $(uname -rm)"
echo "    uptime: $(uptime | sed 's/^ *//')"

# IP addresses of real interfaces
_ipaddr() {
	ip -4 addr show dev "$1" 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p'
}
for _if in eth0 eth1; do
	_ip="$(_ipaddr "$_if")"
	[ -n "$_ip" ] && echo "    $_if : $_ip"
done

# PTP lock state from ptp-monitor's ubus object
if _ptp=$(ubus call ptp status 2>/dev/null); then
	_lock=$(echo "$_ptp" | sed -n 's/.*"locked": \([a-z]*\).*/\1/p')
	_ppm=$(echo "$_ptp" | sed -n 's/.*"freq_ppm": \(-\{0,1\}[0-9.]*\).*/\1/p')
	[ -n "$_ppm" ] && echo "    ptp  : locked=${_lock} freq=${_ppm} ppm"
else
	echo "    ptp  : no monitor"
fi

# camilladsp pipeline status from its native ubus object (patch 0004).
# One line: state, capture rate when measured, main fader. Deep detail
# stays on the websocket API.
if _cdsp=$(ubus call camilladsp status 2>/dev/null); then
	_state=$(echo "$_cdsp" | sed -n 's/.*"state": "\([A-Za-z]*\)".*/\1/p')
	_rate=$(echo "$_cdsp" | sed -n 's/.*"capture_rate": \([0-9]*\).*/\1/p')
	_vol=$(echo "$_cdsp" | sed -n 's/.*"volume": \(-\{0,1\}[0-9.]*\).*/\1/p')
	_mute=$(echo "$_cdsp" | sed -n 's/.*"mute": \([a-z]*\).*/\1/p')
	_line="${_state:-unknown}"
	[ -n "$_rate" ] && [ "$_rate" != "0" ] && _line="${_line}@${_rate}"
	[ -n "$_vol" ] && _vol=$(printf '%.1f' "$_vol" 2>/dev/null || echo "$_vol")
	[ -n "$_vol" ] && _line="${_line} vol=${_vol}dB"
	[ "$_mute" = "true" ] && _line="${_line} [muted]"
	echo "    cdsp : $_line"
elif pidof camilladsp >/dev/null 2>&1; then
	echo "    cdsp : no ubus object (old binary?)"
else
	echo "    cdsp : stopped"
fi

# Audio chain services
_svcs="statime camilladsp aoip-bridge mpd"
_out=""
for _s in $_svcs; do
	[ -x "/etc/init.d/$_s" ] || continue
	if pidof "$_s" >/dev/null 2>&1; then
		_out="${_out:+$_out }$_s:running"
	else
		_out="${_out:+$_out }$_s:off"
	fi
done
[ -n "$_out" ] && echo "    svc  : $_out"
unset _board _model _if _ip _ptp _lock _ppm _cdsp _state _rate _vol _mute _line _svcs _out _s
