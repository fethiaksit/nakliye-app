#!/usr/bin/env bash
# ==============================================================================
# NakliyeGo - Controlled Production Deploy & Docker Image Rollback Script
# ==============================================================================
# Kullanım:
#   1. Mevcut çalışan imaj etiketini kaydetmek için:
#      ./scripts/deploy/rollback.sh --record-current <container_name>
#   2. Önceki çalışan imaja geri dönmek (rollback) için:
#      ./scripts/deploy/rollback.sh <target_image_tag_or_previous>
#   3. İzole test / Dry-run doğrulaması için:
#      ./scripts/deploy/rollback.sh --dry-run [target_image_tag]
# ==============================================================================

set -euo pipefail

STATE_DIR="${ROLLBACK_STATE_DIR:-/tmp/nakliyego-deploy-state}"
CONTAINER_NAME="${DEPLOY_CONTAINER_NAME:-nakliye-app-api-1}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8080/health/ready}"
ENV_FILE="${DEPLOY_ENV_FILE:-/home/ubuntu/nakliye-app/backend/.env}"
PORT_BINDING="${DEPLOY_PORT_BINDING:-127.0.0.1:8080:8080}"

mkdir -p "$STATE_DIR"
LAST_GOOD_FILE="$STATE_DIR/${CONTAINER_NAME}.last_good_image"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [NakliyeGo Rollback] $1"
}

log_error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [NakliyeGo Rollback] [HATA] $1" >&2
}

MODE="${1:-}"

if [[ "$MODE" == "--record-current" ]]; then
    TARGET_CONTAINER="${2:-$CONTAINER_NAME}"
    if ! command -v docker >/dev/null 2>&1; then
        log_error "docker komutu bulunamadı!"
        exit 1
    fi
    CURRENT_IMAGE=$(docker inspect --format='{{.Config.Image}}' "$TARGET_CONTAINER" 2>/dev/null || echo "")
    if [[ -z "$CURRENT_IMAGE" ]]; then
        log_error "Çalışan container ($TARGET_CONTAINER) için imaj bilgisi alınamadı!"
        exit 1
    fi
    echo "$CURRENT_IMAGE" > "$LAST_GOOD_FILE"
    log "Mevcut çalışan imaj kaydedildi ($LAST_GOOD_FILE): $CURRENT_IMAGE"
    exit 0
fi

if [[ "$MODE" == "--dry-run" ]]; then
    TARGET_IMAGE="${2:-}"
    if [[ -z "$TARGET_IMAGE" ]] && [[ -f "$LAST_GOOD_FILE" ]]; then
        TARGET_IMAGE=$(cat "$LAST_GOOD_FILE")
    fi
    if [[ -z "$TARGET_IMAGE" ]]; then
        TARGET_IMAGE="nakliyego/api:previous-stable"
    fi
    log "DRY-RUN: Container '$CONTAINER_NAME' durdurulacak ve önceki sağlam imaj '$TARGET_IMAGE' ile başlatılacak."
    log "DRY-RUN: Readiness kontrolü bekleniyor -> $HEALTH_URL"
    log "✅ DRY-RUN: Rollback planı ve parametreleri başarıyla doğrulandı."
    exit 0
fi

TARGET_IMAGE="${1:-}"
if [[ -z "$TARGET_IMAGE" ]] || [[ "$TARGET_IMAGE" == "previous" ]]; then
    if [[ ! -f "$LAST_GOOD_FILE" ]]; then
        log_error "Kayıtlı önceki çalışan imaj bulunamadı ($LAST_GOOD_FILE) ve hedef imaj parametresi verilmedi!"
        exit 1
    fi
    TARGET_IMAGE=$(cat "$LAST_GOOD_FILE")
fi

if [[ -z "$TARGET_IMAGE" ]]; then
    log_error "Geçersiz hedef imaj!"
    exit 1
fi

log "Rollback başlatılıyor: Container='$CONTAINER_NAME' -> Hedef İmaj='$TARGET_IMAGE'"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "Mevcut bozuk/hatalı container durduruluyor ve kaldırılıyor: $CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME" >/dev/null
fi

ENV_ARGS=()
if [[ -f "$ENV_FILE" ]]; then
    ENV_ARGS=(--env-file "$ENV_FILE")
fi

log "Önceki çalışan imaj başlatılıyor: $TARGET_IMAGE"
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --security-opt no-new-privileges:true \
    -p "$PORT_BINDING" \
    "${ENV_ARGS[@]}" \
    "$TARGET_IMAGE" >/dev/null

log "Readiness healthcheck doğrulanıyor ($HEALTH_URL)..."
READY=false
for i in {1..15}; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 1
done

if [[ "$READY" != true ]]; then
    log_error "Rollback sonrası servis readiness kontrolünden geçemedi ($HEALTH_URL)!"
    exit 1
fi

log "✅ Rollback başarıyla tamamlandı ve servis hazır durumda ($TARGET_IMAGE)."
