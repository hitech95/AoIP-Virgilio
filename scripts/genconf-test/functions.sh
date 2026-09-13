# Minimal host-side stub of OpenWrt /lib/functions.sh for testing
# camilladsp-genconf. Sources uci plain-text files (same syntax as
# /etc/config/*, including trailing comments). Set UCI_CONFIG_DIR.

: "${UCI_CONFIG_DIR:=/tmp/opencode/cdsp/test/config}"

_sections=""
_secn=0

# parse a raw value token: quoted (may contain spaces/#) or bare
# (strip trailing comment)
_uci_val() {
	local v="$1"
	v="${v#"${v%%[![:space:]]*}"}"
	case "$v" in
	\'*)
		v="${v#\'}"
		v="${v%%\'*}"
		;;
	*)
		v="${v%%\#*}"
		v="${v%"${v##*[![:space:]]}"}"
		;;
	esac
	printf '%s' "$v"
}

_uci_parse() {
	local file="$UCI_CONFIG_DIR/$1" line type name id key val
	_sections=""
	_secn=0
	[ -f "$file" ] || return 0
	while IFS= read -r line || [ -n "$line" ]; do
		line="${line#"${line%%[![:space:]]*}"}"
		case "$line" in
		'#'*|'') continue ;;
		esac
		case "$line" in
		config\ *)
			set -- $line
			type="$2"
			name=""
			case "$3" in
			\'*\') name="$3"; name="${name#\'}"; name="${name%\'}" ;;
			esac
			if [ -n "$name" ]; then
				id="$name"
			else
				_secn=$((_secn + 1))
				id="cfg$_secn"
			fi
			eval "U_${id}_TYPE=\"\$type\""
			_sections="$_sections $id"
			;;
		option\ *|list\ *)
			local kind="${line%% *}"
			line="${line#"$kind"}"
			line="${line#"${line%%[![:space:]]*}"}"
			key="${line%% *}"
			val="$(_uci_val "${line#"$key"}")"
			if [ "$kind" = option ]; then
				eval "U_${id}_${key}=\"\$val\""
			else
				eval "U_${id}_L_${key}=\"\${U_${id}_L_${key}}\${U_${id}_L_${key}:+ }\$val\""
			fi
			;;
		esac
	done < "$file"
}

config_load() {
	_uci_parse "$1"
}

config_get() {
	local __var="$1" __section="$2" __option="$3" __default="$4" __val
	eval "__val=\"\${U_${__section}_${__option}-}\""
	if [ -z "$__val" ] && [ -n "$__default" ]; then
		__val="$__default"
	fi
	# callers either use the 3-arg form (print) or 4-arg (set var)
	if [ $# -eq 3 ]; then
		printf '%s' "$__val"
	else
		eval "$__var=\"\$__val\""
	fi
}

config_foreach() {
	local __func="$1" __type="$2" __id
	shift 2
	for __id in $_sections; do
		eval "[ \"\$U_${__id}_TYPE\" = \"\$__type\" ]" || continue
		$__func "$__id" "$@"
	done
}

config_list_foreach() {
	local __section="$1" __option="$2" __func="$3" __list __item
	eval "__list=\"\${U_${__section}_L_${__option}-}\""
	for __item in $__list; do
		$__func "$__item"
	done
}
