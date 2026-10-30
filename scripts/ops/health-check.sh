#!/usr/bin/env bash
# Read-only checks; alerts are delivered by the existing backup-alert.sh wrapper.
set -u
failed=0
fail() { echo "FAIL $*"; failed=1; }
usage=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
if [[ ! "$usage" =~ ^[0-9]+$ ]] || (( usage >= 85 )); then fail "disk usage=${usage:-unknown}% threshold=85%"; fi
for environment in prod beta; do
    if [[ "$environment" == prod ]]; then prefix=nakliye-app; port=8080; else prefix=nakliye-beta; port=8081; fi
    backend="$prefix-backend-1"
    health=$(docker inspect --format '{{.State.Health.Status}}' "$backend" 2>/dev/null) || health=missing
    [[ "$health" == healthy ]] || fail "$environment backend health=$health"
    curl --max-time 3 -fsS "http://127.0.0.1:$port/health/ready" >/dev/null 2>&1 || fail "$environment readiness/Redis unavailable"
    pong=$(docker exec "$prefix-redis-1" redis-cli ping 2>/dev/null) || pong=failed
    [[ "$pong" == PONG ]] || fail "$environment Redis ping unavailable"
    if logs=$(docker logs --since 5m "$backend" 2>&1); then
        count=$(printf '%s\n' "$logs" | grep -Ec 'status[=:][[:space:]]*5[0-9]{2}|"status":[[:space:]]*5[0-9]{2}' || true)
        (( count == 0 )) || fail "$environment backend 5xx count=$count last=5m"
        count=$(printf '%s\n' "$logs" | grep -Eic 'password_reset_email_failed|email.*(failed|error)|resend.*(failed|error)' || true)
        (( count == 0 )) || fail "$environment email failures=$count last=5m"
        count=$(printf '%s\n' "$logs" | grep -Ec 'push (notification|receipt check|event claim) failed' || true)
        (( count == 0 )) || fail "$environment push failures=$count last=5m"
    else fail "$environment logs unavailable"; fi
 done
if (( failed == 0 )); then echo 'OK backend/Redis/disk/recent 5xx/email/push checks'; fi
exit "$failed"
