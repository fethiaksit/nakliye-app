#!/usr/bin/env bash
# ==============================================================================
# NakliyeGo - Redis Zero-Downtime Consistent Backup Script
# ==============================================================================
# Desteklenen Ortamlar: prod | beta
# Kullanım:
#   ./redis-backup.sh [prod|beta]
#
# Çalışma Prensibi:
# 1. Çalışan Redis container'ı durdurulmaz (Zero-downtime).
# 2. Canlı AOF dosyaları doğrudan kopyalanmaz.
# 3. BGSAVE ile tutarlı RDB snapshot tetiklenir ve tamamlanması beklenir.
# 4. redis-check-rdb ile RDB dosyasının bütünlüğü doğrulanır.
# 5. Snapshot arşivlenir (.tar.gz), SHA-256 sağlama toplamı alınır.
# 6. AWS S3'e sunucu taraflı şifreleme (AES256/KMS) ile yüklenir.
# 7. S3 yüklemesi doğrulanır, yerel geçici dosyalar temizlenir.
# 8. Hata durumunda bildirim (Webhook / Log) mekanizması tetiklenir.
# ==============================================================================

set -euo pipefail

ENV="${1:-prod}"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_DIR="${BACKUP_DIR:-/tmp/nakliyego-backups}"
S3_BUCKET="${S3_BUCKET:-nakliyego-backups}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

# Ortam Yapılandırması
if [[ "$ENV" == "prod" ]]; then
    CONTAINER_NAME="nakliye-app-redis-1"
    S3_PREFIX="redis/production"
    ENV_NAME="Production"
elif [[ "$ENV" == "beta" ]]; then
    CONTAINER_NAME="nakliye-beta-redis-1"
    S3_PREFIX="redis/beta"
    ENV_NAME="Beta"
else
    echo "[HATA] Geçersiz ortam: '$ENV'. Geçerli değerler: 'prod' veya 'beta'." >&2
    exit 1
fi

LOG_PREFIX="[$(date +'%Y-%m-%d %H:%M:%S')] [NakliyeGo Backup - $ENV_NAME]"
TEMP_WORK_DIR="$BACKUP_DIR/${ENV}_${TIMESTAMP}"
ARCHIVE_NAME="redis-${ENV}-${TIMESTAMP}.rdb.tar.gz"
ARCHIVE_PATH="$TEMP_WORK_DIR/$ARCHIVE_NAME"

log() {
    echo "$LOG_PREFIX $1"
}

log_error() {
    echo "$LOG_PREFIX [HATA] $1" >&2
}

notify_failure() {
    local error_msg="$1"
    log_error "$error_msg"
    if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 *NakliyeGo Redis Backup Başarısız!*\\n*Ortam:* $ENV_NAME\\n*Container:* $CONTAINER_NAME\\n*Hata:* $error_msg\\n*Zaman:* $(date +'%Y-%m-%d %H:%M:%S')\"}" \
            "$ALERT_WEBHOOK_URL" || true
    fi
}

cleanup() {
    if [[ -d "$TEMP_WORK_DIR" ]]; then
        rm -rf "$TEMP_WORK_DIR"
        log "Geçici çalışma dizini temizlendi: $TEMP_WORK_DIR"
    fi
}

trap 'notify_failure "Beklenmeyen hata (Satır: $LINENO). Yedekleme yarıda kesildi."; cleanup; exit 1' ERR

# ------------------------------------------------------------------------------
# 1. Ön Kontroller
# ------------------------------------------------------------------------------
log "Yedekleme başlatılıyor: Container='$CONTAINER_NAME', S3='s3://$S3_BUCKET/$S3_PREFIX/'"

if ! command -v docker >/dev/null 2>&1; then
    log_error "docker komutu bulunamadı!"
    exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
    log_error "aws CLI komutu bulunamadı!"
    exit 1
fi

# Container çalışıyor mu?
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log_error "Container '$CONTAINER_NAME' çalışır durumda değil!"
    exit 1
fi

mkdir -p "$TEMP_WORK_DIR"

# Redis şifresi varsa ortam değişkeninden al
REDIS_CLI_AUTH=()
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
    REDIS_CLI_AUTH=(-a "$REDIS_PASSWORD" --no-auth-warning)
fi

# ------------------------------------------------------------------------------
# 2. BGSAVE Öncesi Zaman Damgası Kontrolü
# ------------------------------------------------------------------------------
PREV_LASTSAVE=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" LASTSAVE | tr -d '\r')
log "BGSAVE öncesi LASTSAVE: $PREV_LASTSAVE"

# ------------------------------------------------------------------------------
# 3. BGSAVE Snapshot Tetikleme
# ------------------------------------------------------------------------------
log "BGSAVE komutu gönderiliyor..."
BGSAVE_OUT=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" BGSAVE 2>&1 | tr -d '\r')
log "BGSAVE yanıtı: $BGSAVE_OUT"

if [[ "$BGSAVE_OUT" != *"Background saving started"* ]] && [[ "$BGSAVE_OUT" != *"Background saving already in progress"* ]]; then
    log_error "BGSAVE başlatılamadı: $BGSAVE_OUT"
    exit 1
fi

# ------------------------------------------------------------------------------
# 4. BGSAVE Tamamlanmasını Bekleme (Polling)
# ------------------------------------------------------------------------------
log "Snapshot tamamlanması bekleniyor..."
MAX_WAIT_SECONDS=180
ELAPSED=0
SAVE_COMPLETED=false

while [[ $ELAPSED -lt $MAX_WAIT_SECONDS ]]; do
    BGSAVE_IN_PROGRESS=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" info persistence | grep 'rdb_bgsave_in_progress:' | cut -d: -f2 | tr -d '\r')
    
    if [[ "$BGSAVE_IN_PROGRESS" == "0" ]]; then
        CURRENT_LASTSAVE=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" LASTSAVE | tr -d '\r')
        BGSAVE_STATUS=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" info persistence | grep 'rdb_last_bgsave_status:' | cut -d: -f2 | tr -d '\r')
        
        if [[ "$BGSAVE_STATUS" == "ok" ]] && [[ "$CURRENT_LASTSAVE" -ge "$PREV_LASTSAVE" ]]; then
            log "BGSAVE başarıyla tamamlandı (Süre: ${ELAPSED}s, Yeni LASTSAVE: $CURRENT_LASTSAVE)."
            SAVE_COMPLETED=true
            break
        else
            log_error "BGSAVE başarısız statü ile bitti: rdb_last_bgsave_status=$BGSAVE_STATUS"
            exit 1
        fi
    fi

    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [[ "$SAVE_COMPLETED" != true ]]; then
    log_error "BGSAVE işlemi zaman aşımına uğradı ($MAX_WAIT_SECONDS saniye)!"
    exit 1
fi

# ------------------------------------------------------------------------------
# 5. RDB Dosyasını Container İçinde Doğrulama (redis-check-rdb)
# ------------------------------------------------------------------------------
log "Container içi RDB dosyasının bütünlüğü kontrol ediliyor (redis-check-rdb)..."
if ! docker exec "$CONTAINER_NAME" redis-check-rdb /data/dump.rdb; then
    log_error "Container içi /data/dump.rdb bütünlük kontrolünden geçemedi!"
    exit 1
fi
log "RDB bütünlük kontrolü başarılı."

# ------------------------------------------------------------------------------
# 6. RDB Dosyasını Kopyalama ve Arşivleme
# ------------------------------------------------------------------------------
log "dump.rdb dosyası container'dan kopyalanıyor..."
docker cp "$CONTAINER_NAME":/data/dump.rdb "$TEMP_WORK_DIR/dump.rdb"

RDB_SIZE=$(du -h "$TEMP_WORK_DIR/dump.rdb" | cut -f1)
log "Kopyalanan RDB boyutu: $RDB_SIZE"

log "Yedek arşivi oluşturuluyor ($ARCHIVE_NAME)..."
tar -czf "$ARCHIVE_PATH" -C "$TEMP_WORK_DIR" dump.rdb
rm -f "$TEMP_WORK_DIR/dump.rdb"

ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
log "Sıkıştırılmış arşiv boyutu: $ARCHIVE_SIZE"

# SHA-256 sağlama toplamı
log "SHA-256 sağlama toplamı hesaplanıyor..."
(cd "$TEMP_WORK_DIR" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")
SHA256_VAL=$(cut -d' ' -f1 "$ARCHIVE_PATH.sha256")
log "SHA-256: $SHA256_VAL"

# ------------------------------------------------------------------------------
# 7. AWS S3'e Şifreli Aktarım (AES256)
# ------------------------------------------------------------------------------
S3_TARGET_URI="s3://$S3_BUCKET/$S3_PREFIX/$ARCHIVE_NAME"
S3_SHA_TARGET_URI="s3://$S3_BUCKET/$S3_PREFIX/$ARCHIVE_NAME.sha256"

log "S3'e yükleniyor (AES256 şifreli): $S3_TARGET_URI"
aws s3 cp "$ARCHIVE_PATH" "$S3_TARGET_URI" \
    --region "$AWS_REGION" \
    --sse AES256

aws s3 cp "$ARCHIVE_PATH.sha256" "$S3_SHA_TARGET_URI" \
    --region "$AWS_REGION" \
    --sse AES256

# ------------------------------------------------------------------------------
# 8. S3 Yüklemesini Doğrulama
# ------------------------------------------------------------------------------
log "S3 üzerindeki dosya varlığı ve boyutu doğrulanıyor..."
REMOTE_SIZE=$(aws s3 ls "$S3_TARGET_URI" --region "$AWS_REGION" | awk '{print $3}')

if [[ -z "$REMOTE_SIZE" ]] || [[ "$REMOTE_SIZE" -le 0 ]]; then
    log_error "S3 doğrulaması başarısız: Uzak dosya bulunamadı veya 0 byte!"
    exit 1
fi

log "S3 doğrulaması başarılı! (S3 Boyutu: ${REMOTE_SIZE} bytes)"

# ------------------------------------------------------------------------------
# 9. Temizlik
# ------------------------------------------------------------------------------
cleanup
log "✅ $ENV_NAME Redis yedekleme süreci başarıyla tamamlandı."
