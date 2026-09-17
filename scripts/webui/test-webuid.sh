#!/bin/bash
# webuid contract test suite (host). Requires daemon started by run-webuid.sh.
set -u
SOCK=/tmp/opencode/webui.sock
PASS=0; FAIL=0

req() { # uri method body [cookie]
	local uri="$1" method="$2" body="${3:-}" cookie="${4:-}"
	if [ -n "$cookie" ]; then
		printf '%s' "$body" | timeout 10 python3 /tmp/opencode/scgi.py "$SOCK" "$uri" "$method" "$cookie"
	else
		printf '%s' "$body" | timeout 10 python3 /tmp/opencode/scgi.py "$SOCK" "$uri" "$method"
	fi
}

check() { # name expected_substr actual
	if printf '%s' "$3" | grep -q "$2"; then
		PASS=$((PASS+1)); echo "PASS: $1"
	else
		FAIL=$((FAIL+1)); echo "FAIL: $1 -- wanted [$2] got:"; printf '%s\n' "$3" | head -8
	fi
}

# 1. bad JSON
R=$(req /oui-rpc POST 'not json')
check "bad json -> 400" "400 Bad Request" "$R"

# 2. unknown method
R=$(req /oui-rpc POST '{"method":"bogus"}')
check "unknown method -> 404" "404" "$R"

# 3. login wrong user
R=$(req /oui-rpc POST '{"method":"login","params":{"username":"nobody","password":"x"}}')
check "non-root login -> 401" "401" "$R"

# 4. login ok (stub cryptpw accepts)
R=$(req /oui-rpc POST '{"method":"login","params":{"username":"root","password":"test123"}}')
check "root login -> sid" '"sid"' "$R"
check "root login -> Set-Cookie" "Set-Cookie: webui_sid=" "$R"
SID=$(printf '%s' "$R" | python3 -c 'import json,sys; d=sys.stdin.read(); d=d[d.index("{",d.index("\r\n\r\n")):]; print(json.loads(d)["sid"])' 2>/dev/null)
COOKIE="webui_sid=$SID"

# 5. alive with sid
R=$(req /oui-rpc POST "{\"method\":\"alive\",\"params\":{\"sid\":\"$SID\"}}" "$COOKIE")
check "alive -> true" '"alive": *true' "$R"

# 6. alive with bogus sid
R=$(req /oui-rpc POST '{"method":"alive","params":{"sid":"bogus"}}')
check "alive bogus -> false" '"alive": *false' "$R"

# 7. call without session -> 401 (get_menus is session-gated;
#    ui.get_locale/get_theme are deliberately no-auth for the login shell)
R=$(req /oui-rpc POST '{"method":"call","params":["bogus","ui","get_menus",{}]}')
check "call no session -> 401" "401" "$R"

# 8. call ui.get_locale
R=$(req /oui-rpc POST "{\"method\":\"call\",\"params\":[\"$SID\",\"ui\",\"get_locale\",{}]}")
check "call ui.get_locale" '"result".*locale' "$R"

# 9. call ubus.call (no ubusd on host -> soft error -6)
R=$(req /oui-rpc POST "{\"method\":\"call\",\"params\":[\"$SID\",\"ubus\",\"call\",{\"object\":\"system\",\"method\":\"board\"}]}")
check "call ubus no daemon -> soft -6" '"code": *-6' "$R"

# 10. call unknown module fn -> 404
R=$(req /oui-rpc POST "{\"method\":\"call\",\"params\":[\"$SID\",\"nope\",\"nope\",{}]}")
check "call unknown -> 404" "404" "$R"

# 11. /_auth without cookie -> 403
R=$(req /_auth GET '')
check "_auth no cookie -> 403" "403" "$R"

# 12. /_auth with cookie -> 204
R=$(req /_auth GET '' "$COOKIE")
check "_auth cookie -> 204" "204" "$R"

# 13. logout invalidates
R=$(req /oui-rpc POST "{\"method\":\"logout\",\"params\":{\"sid\":\"$SID\"}}")
R=$(req /_auth GET '' "$COOKIE")
check "_auth after logout -> 403" "403" "$R"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
