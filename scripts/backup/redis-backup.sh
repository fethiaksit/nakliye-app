#!/usr/bin/env bash
# ==============================================================================
# NakliyeGo - Redis Zero-Downtime Consistent Backup Script
# ==============================================================================
# Desteklenen Ortamlar: prod | beta
# Kullanım:
#   ./redis-backup.sh [prod|beta]
#
# Çalışma Prensibi:
# 1. Canlı/çalışan Redis container'ı durdurulmaz (Zero-downtime).
# 2. Canlı AOF dosyaları doğrudan kopyalanmaz.
# 3. Önceden çalışan BGSAVE varsa belirsiz snapshot kabul edilmez, iptal edilir.
# 4. Yeni BGSAVE tetiklenir, rdb_bgsave_in_progress ve LASTSAVE doğrulanır.
# 5. Container içi RDB ve kopyalanan yerel RDB dosyası bütünlük kontrolünden geçirilir.
# 6. Snapshot arşivlenir (.tar.gz) ve SHA-256 sağlama toplamı alınır.
# 7. AWS S3'e sunucu taraflı şifreleme (AES256) ile EC2 IAM rolüyle yüklenir.
# 8. S3 yüklemesi tam nesne anahtarıyla 'head-object' üzerinden bayt bayt doğrulanır.
# 9. Yerel geçici çalışma dizini (/home/ubuntu/nakliyego-backup-work) temizlenir.
# ==============================================================================

set -euo pipefail

ENV="${1:-prod}"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/home/ubuntu/nakliyego-backup-work}"
S3_BUCKET="${S3_BUCKET:-nakliyego-backups-292187657171}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

# Ortam Yapılandırması ve Ayrımı
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
TEMP_WORK_DIR="$BACKUP_WORK_DIR/backup_${ENV}_${TIMESTAMP}"
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

# Canlı container çalışıyor mu?
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log_error "Hedef canlı container '$CONTAINER_NAME' çalışır durumda değil!"
    exit 1
fi

mkdir -p "$TEMP_WORK_DIR"

# Redis kimlik doğrulaması gerekiyorsa
REDIS_CLI_AUTH=()
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
    REDIS_CLI_AUTH=(-a "$REDIS_PASSWORD" --no-auth-warning)
fi

# ------------------------------------------------------------------------------
# 2. BGSAVE Durumu ve Çakışma Kontrolü
# ------------------------------------------------------------------------------
log "Mevcut BGSAVE durumu denetleniyor..."
BGSAVE_IN_PROGRESS_BEFORE=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" info persistence | grep '^rdb_bgsave_in_progress:' | cut -d: -f2 | tr -d '\r')

if [[ "$BGSAVE_IN_PROGRESS_BEFORE" != "0" ]]; then
    log_error "Arka planda zaten başka bir BGSAVE işlemi devam ediyor (rdb_bgsave_in_progress=$BGSAVE_IN_PROGRESS_BEFORE). Belirsiz snapshot durumu kabul edilmez, yedekleme iptal edildi!"
    exit 1
fi

PREV_LASTSAVE=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" LASTSAVE | tr -d '\r')
log "BGSAVE öncesi referans LASTSAVE: $PREV_LASTSAVE"

# Yeni snapshot zaman damgasının kesinlikle büyümesini garantiye al
while [[ "$(date +%s)" -le "$PREV_LASTSAVE" ]]; do
    sleep 1
done

# ------------------------------------------------------------------------------
# 3. Yeni BGSAVE Tetikleme
# ------------------------------------------------------------------------------
log "Yeni BGSAVE komutu gönderiliyor..."
BGSAVE_OUT=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" BGSAVE 2>&1 | tr -d '\r')
log "BGSAVE yanıtı: $BGSAVE_OUT"

if [[ "$BGSAVE_OUT" != *"Background saving started"* ]]; then
    log_error "BGSAVE başlatılamadı veya beklenmeyen yanıt: $BGSAVE_OUT"
    exit 1
fi

# ------------------------------------------------------------------------------
# 4. BGSAVE Tamamlanmasını Güvenilir Biçimde Doğrulama
# ------------------------------------------------------------------------------
log "Yeni snapshot tamamlanması bekleniyor..."
MAX_WAIT_SECONDS=180
ELAPSED=0
SAVE_COMPLETED=false

while [[ $ELAPSED -lt $MAX_WAIT_SECONDS ]]; do
    PERSISTENCE_INFO=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" info persistence)
    BGSAVE_IN_PROGRESS=$(echo "$PERSISTENCE_INFO" | grep '^rdb_bgsave_in_progress:' | cut -d: -f2 | tr -d '\r')
    BGSAVE_STATUS=$(echo "$PERSISTENCE_INFO" | grep '^rdb_last_bgsave_status:' | cut -d: -f2 | tr -d '\r')

    if [[ "$BGSAVE_IN_PROGRESS" == "0" ]]; then
        CURRENT_LASTSAVE=$(docker exec "$CONTAINER_NAME" redis-cli "${REDIS_CLI_AUTH[@]}" LASTSAVE | tr -d '\r')
        if [[ "$BGSAVE_STATUS" == "ok" ]] && [[ "$CURRENT_LASTSAVE" -gt "$PREV_LASTSAVE" ]]; then
            log "BGSAVE başarıyla tamamlandı (Süre: ${ELAPSED}s, Yeni LASTSAVE: $CURRENT_LASTSAVE > $PREV_LASTSAVE)."
            SAVE_COMPLETED=true
            break
        elif [[ "$BGSAVE_STATUS" != "ok" ]]; then
            log_error "BGSAVE başarısız statü ile sonuçlandı: rdb_last_bgsave_status=$BGSAVE_STATUS"
            exit 1
        else
            log_error "BGSAVE durdu ancak LASTSAVE güncellenmedi (Önceki: $PREV_LASTSAVE, Mevcut: $CURRENT_LASTSAVE)!"
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
# 5. Container İçi RDB Bütünlük Kontrolü
# ------------------------------------------------------------------------------
log "Container içi RDB dosyası doğrulanıyor (redis-check-rdb)..."
if ! docker exec "$CONTAINER_NAME" redis-check-rdb /data/dump.rdb; then
    log_error "Container içi /data/dump.rdb bütünlük kontrolünden geçemedi!"
    exit 1
fi
CONTAINER_RDB_SHA=$(docker exec "$CONTAINER_NAME" sha256sum /data/dump.rdb | awk '{print $1}')
log "Container içi RDB SHA-256: $CONTAINER_RDB_SHA"

# ------------------------------------------------------------------------------
# 6. RDB Dosyasını Kopyalama ve Kopyalanmış Dosyayı Doğrulama
# ------------------------------------------------------------------------------
log "dump.rdb dosyası yerel geçici dizine kopyalanıyor..."
docker cp "$CONTAINER_NAME":/data/dump.rdb "$TEMP_WORK_DIR/dump.rdb"

if [[ ! -s "$TEMP_WORK_DIR/dump.rdb" ]]; then
    log_error "Kopyalanan dump.rdb dosyası boş veya bulunamadı!"
    exit 1
fi

LOCAL_RDB_SHA=$(sha256sum "$TEMP_WORK_DIR/dump.rdb" | awk '{print $1}')
log "Kopyalanan yerel RDB SHA-256: $LOCAL_RDB_SHA"

if [[ "$CONTAINER_RDB_SHA" != "$LOCAL_RDB_SHA" ]]; then
    log_error "Kopyalanan RDB dosyasının SHA-256 özeti container içiyle uyuşmuyor!"
    exit 1
fi

log "Kopyalanan RDB dosyası yerel olarak redis-check-rdb ile doğrulanıyor..."
if command -v redis-check-rdb >/dev/null 2>&1; then
    redis-check-rdb "$TEMP_WORK_DIR/dump.rdb"
else
    docker run --rm -v "$TEMP_WORK_DIR:/check:ro" redis:7-alpine redis-check-rdb /check/dump.rdb
fi
log "Kopyalanmış RDB dosyasının bütünlüğü doğrulandı."

# ------------------------------------------------------------------------------
# 7. Arşivleme ve SHA-256 Sağlama Toplamı
# ------------------------------------------------------------------------------
log "Yedek arşivi oluşturuluyor ($ARCHIVE_NAME)..."
tar -czf "$ARCHIVE_PATH" -C "$TEMP_WORK_DIR" dump.rdb

# Arşivin açılabilir ve geçerli bir tar.gz olduğunu test et
tar -tzf "$ARCHIVE_PATH" >/dev/null
rm -f "$TEMP_WORK_DIR/dump.rdb"

LOCAL_ARCHIVE_BYTES=$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')
log "Oluşturulan arşiv boyutu: $LOCAL_ARCHIVE_BYTES bytes"

log "Arşiv için SHA-256 hesaplanıyor..."
(cd "$TEMP_WORK_DIR" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")
LOCAL_SHA_CONTENT=$(cat "$ARCHIVE_PATH.sha256" | tr -d '\r\n')
LOCAL_SHA_BYTES=$(wc -c < "$ARCHIVE_PATH.sha256" | tr -d ' ')
log "Yerel SHA-256: $LOCAL_SHA_CONTENT"

# ------------------------------------------------------------------------------
# 8. AWS S3'e Şifreli Aktarım (AES256)
# ------------------------------------------------------------------------------
S3_ARCHIVE_KEY="$S3_PREFIX/$ARCHIVE_NAME"
S3_SHA_KEY="$S3_PREFIX/$ARCHIVE_NAME.sha256"
S3_TARGET_URI="s3://$S3_BUCKET/$S3_ARCHIVE_KEY"
S3_SHA_TARGET_URI="s3://$S3_BUCKET/$S3_SHA_KEY"

log "S3'e yükleniyor (AES256 şifreli): $S3_TARGET_URI"
aws s3 cp "$ARCHIVE_PATH" "$S3_TARGET_URI" \
    --region "$AWS_REGION" \
    --sse AES256

aws s3 cp "$ARCHIVE_PATH.sha256" "$S3_SHA_TARGET_URI" \
    --region "$AWS_REGION" \
    --sse AES256

# ------------------------------------------------------------------------------
# 9. S3 Boyut ve SHA-256 Dosyası Doğrulaması (head-object)
# ------------------------------------------------------------------------------
log "S3 üzerindeki arşiv ve SHA-256 dosyaları doğrulanıyor (head-object)..."

# 9.1. Arşiv dosya boyutu doğrulama (tam nesne anahtarıyla head-object)
REMOTE_ARCHIVE_BYTES=$(aws s3api head-object \
    --bucket "$S3_BUCKET" \
    --key "$S3_ARCHIVE_KEY" \
    --region "$AWS_REGION" \
    --query ContentLength \
    --output text 2>/dev/null || echo "")

if [[ -z "$REMOTE_ARCHIVE_BYTES" ]] || ! [[ "$REMOTE_ARCHIVE_BYTES" =~ ^[0-9]+$ ]] || [[ "$REMOTE_ARCHIVE_BYTES" -le 0 ]]; then
    log_error "S3 üzerinde arşiv nesnesi doğrulanamadı (head-object başarısız): bucket='$S3_BUCKET', key='$S3_ARCHIVE_KEY'"
    exit 1
fi

if [[ "$REMOTE_ARCHIVE_BYTES" -ne "$LOCAL_ARCHIVE_BYTES" ]]; then
    log_error "S3 arşiv boyutu ($REMOTE_ARCHIVE_BYTES bytes) yerel arşiv boyutuyla ($LOCAL_ARCHIVE_BYTES bytes) eşleşmiyor!"
    exit 1
fi
log "S3 arşiv boyutu yerel boyutla birebir eşleşti: $REMOTE_ARCHIVE_BYTES bytes"

# 9.2. SHA-256 kontrol dosyası doğrulaması (tam nesne anahtarıyla head-object)
REMOTE_SHA_BYTES=$(aws s3api head-object \
    --bucket "$S3_BUCKET" \
    --key "$S3_SHA_KEY" \
    --region "$AWS_REGION" \
    --query ContentLength \
    --output text 2>/dev/null || echo "")

if [[ -z "$REMOTE_SHA_BYTES" ]] || ! [[ "$REMOTE_SHA_BYTES" =~ ^[0-9]+$ ]] || [[ "$REMOTE_SHA_BYTES" -le 0 ]]; then
    log_error "S3 üzerinde SHA-256 nesnesi doğrulanamadı (head-object başarısız): bucket='$S3_BUCKET', key='$S3_SHA_KEY'"
    exit 1
fi

if [[ "$REMOTE_SHA_BYTES" -ne "$LOCAL_SHA_BYTES" ]]; then
    log_error "S3 SHA-256 kontrol dosyası boyutu ($REMOTE_SHA_BYTES bytes) yerel boyutla ($LOCAL_SHA_BYTES bytes) eşleşmiyor!"
    exit 1
fi

REMOTE_SHA_CONTENT=$(aws s3 cp "$S3_SHA_TARGET_URI" - --region "$AWS_REGION" 2>/dev/null | tr -d '\r\n')
if [[ -z "$REMOTE_SHA_CONTENT" ]] || [[ "$REMOTE_SHA_CONTENT" != "$LOCAL_SHA_CONTENT" ]]; then
    log_error "S3 üzerindeki SHA-256 içeriği yerel özet ile uyuşmuyor! (Uzak: '$REMOTE_SHA_CONTENT', Yerel: '$LOCAL_SHA_CONTENT')"
    exit 1
fi
log "S3 SHA-256 kontrol dosyası başarıyla doğrulandı."

# ------------------------------------------------------------------------------
# 10. Temizlik ve Başarı
# ------------------------------------------------------------------------------
cleanup
log "✅ $ENV_NAME Redis yedekleme ve S3 doğrulama süreci başarıyla tamamlandı."
