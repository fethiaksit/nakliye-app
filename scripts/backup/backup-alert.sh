#!/usr/bin/env bash
set -u

TOPIC_ARN="arn:aws:sns:eu-central-1:292187657171:NakliyeGo-Backup-Alerts"
REGION="eu-central-1"
SCRIPT_DIR="${BACKUP_SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}"

TASK="${1:-}"
ENVIRONMENT="${2:-}"

case "$TASK:$ENVIRONMENT" in
  backup:prod|backup:beta)
    COMMAND="$SCRIPT_DIR/redis-backup.sh"
    ;;
  health:all)
    COMMAND="$SCRIPT_DIR/../ops/health-check.sh"
    ;;
  restore:prod)
    COMMAND="$SCRIPT_DIR/redis-restore-test.sh"
    ;;
  *)
    echo "Gecersiz gorev: $TASK $ENVIRONMENT" >&2
    exit 2
    ;;
esac

"$COMMAND" "$ENVIRONMENT"
RESULT=$?

if [ "$RESULT" -ne 0 ]; then
  # Avoid flooding the existing SNS topic on a persistent health incident.
  if [ "$TASK" = health ]; then
    STATE_DIR="${OPS_ALERT_STATE_DIR:-/home/ubuntu/nakliyego-backup-work/alerts}"
    mkdir -p "$STATE_DIR"
    now=$(date +%s)
    last=$(cat "$STATE_DIR/health-last-alert" 2>/dev/null || echo 0)
    if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < 1800 )); then exit "$RESULT"; fi
  fi
  MESSAGE="NakliyeGo operasyon gorevi BASARISIZ.

Gorev: $TASK
Ortam: $ENVIRONMENT
Sunucu: $(hostname)
Tarih (UTC): $(date -u)
Hata kodu: $RESULT

Sunucu loglarini kontrol edin."

  aws sns publish \
    --topic-arn "$TOPIC_ARN" \
    --subject "NakliyeGo UYARI - $ENVIRONMENT $TASK" \
    --message "$MESSAGE" \
    --region "$REGION" \
    && { if [ "$TASK" = health ]; then echo "$now" > "$STATE_DIR/health-last-alert"; fi; } \
    || echo "SNS bildirimi gonderilemedi." >&2
fi

exit "$RESULT"
