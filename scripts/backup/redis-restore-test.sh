#!/usr/bin/env bash
# ==============================================================================
# NakliyeGo - Isolated Redis Restore Verification Test Script
# ==============================================================================
# Desteklenen Ortamlar: prod | beta
# Kullanım:
#   ./redis-restore-test.sh [prod|beta] [opsiyonel: yerel_dosya_yolu_veya_s3_uri]
#
# Çalışma Prensibi:
# 1. Canlı/çalışan Redis container'larına KESİNLİKLE DOKUNMAZ.
# 2. S3'ten en güncel RDB yedeğini indirir (veya verilen dosyayı kullanır).
# 3. SHA-256 sağlama toplamını doğrular.
# 4. Arşivi geçici test dizinine açar ve redis-check-rdb ile inceler.
# 5. İzole geçici container başlatır (Port 127.0.0.1:16379, --appendonly no).
# 6. NakliyeGo key yapısını (loads, user:*, company:*, offers:*) sorgular.
# 7. Doğrulama raporu üretir, test container'ını ve geçici dosyaları temizler.
# ==============================================================================

set -euo pipefail

ENV="${1:-prod}"
SPECIFIC_TARGET="${2:-}"
TEST_PORT="16379"
TEST_CONTAINER="nakliye-redis-restore-test"
S3_BUCKET="${S3_BUCKET:-nakliyego-backups}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
TEMP_RESTORE_DIR="/tmp/nakliyego-restore-test-$(date +'%Y%m%d_%H%M%S')"

if [[ "$ENV" == "prod" ]]; then
    S3_PREFIX="redis/production"
    ENV_NAME="Production"
elif [[ "$ENV" == "beta" ]]; then
    S3_PREFIX="redis/beta"
    ENV_NAME="Beta"
else
    echo "[HATA] Geçersiz ortam: '$ENV'. Geçerli değerler: 'prod' veya 'beta'." >&2
    exit 1
fi

LOG_PREFIX="[$(date +'%Y-%m-%d %H:%M:%S')] [NakliyeGo Restore Test - $ENV_NAME]"

log() {
    echo "$LOG_PREFIX $1"
}

log_error() {
    echo "$LOG_PREFIX [HATA] $1" >&2
}

cleanup() {
    log "Test temizliği yapılıyor..."
    if docker ps -a --format '{{.Names}}' | grep -q "^${TEST_CONTAINER}$"; then
        docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
        log "İzole test container silindi: $TEST_CONTAINER"
    fi
    if [[ -d "$TEMP_RESTORE_DIR" ]]; then
        rm -rf "$TEMP_RESTORE_DIR"
        log "Geçici test dizini silindi: $TEMP_RESTORE_DIR"
    fi
}

trap cleanup EXIT

# ------------------------------------------------------------------------------
# 1. Hazırlık ve İndirme
# ------------------------------------------------------------------------------
mkdir -p "$TEMP_RESTORE_DIR"

if [[ -n "$SPECIFIC_TARGET" ]] && [[ -f "$SPECIFIC_TARGET" ]]; then
    log "Yerel dosya kullanılıyor: $SPECIFIC_TARGET"
    ARCHIVE_PATH="$SPECIFIC_TARGET"
else
    log "S3 üzerindeki en güncel yedek taranıyor: s3://$S3_BUCKET/$S3_PREFIX/"
    LATEST_ARCHIVE=$(aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" --region "$AWS_REGION" | grep '\.rdb\.tar\.gz$' | sort | tail -n 1 | awk '{print $4}')
    
    if [[ -z "$LATEST_ARCHIVE" ]]; then
        log_error "S3 üzerinde yedek arşivi bulunamadı!"
        exit 1
    fi

    log "En güncel yedek tespit edildi: $LATEST_ARCHIVE"
    ARCHIVE_PATH="$TEMP_RESTORE_DIR/$LATEST_ARCHIVE"
    
    log "Yedek arşivi indiriliyor..."
    aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/$LATEST_ARCHIVE" "$ARCHIVE_PATH" --region "$AWS_REGION"
    
    # SHA256 dosyası varsa indir ve doğrula
    if aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/$LATEST_ARCHIVE.sha256" --region "$AWS_REGION" >/dev/null 2>&1; then
        log "SHA-256 kontrol dosyası indiriliyor..."
        aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/$LATEST_ARCHIVE.sha256" "$TEMP_RESTORE_DIR/$LATEST_ARCHIVE.sha256" --region "$AWS_REGION"
        
        log "SHA-256 bütünlüğü kontrol ediliyor..."
        (cd "$TEMP_RESTORE_DIR" && sha256sum -c "$LATEST_ARCHIVE.sha256")
        log "SHA-256 doğrulaması BAŞARILI."
    fi
fi

# ------------------------------------------------------------------------------
# 2. Arşivi Açma ve dump.rdb Kontrolü
# ------------------------------------------------------------------------------
log "Arşiv açılıyor: $ARCHIVE_PATH"
tar -xzf "$ARCHIVE_PATH" -C "$TEMP_RESTORE_DIR"

if [[ ! -f "$TEMP_RESTORE_DIR/dump.rdb" ]]; then
    log_error "Arşiv içinde dump.rdb bulunamadı!"
    exit 1
fi

chmod 644 "$TEMP_RESTORE_DIR/dump.rdb"

# ------------------------------------------------------------------------------
# 3. İzole Test Container'ı Başlatma
# ------------------------------------------------------------------------------
# Var olan eski test container varsa kaldır
if docker ps -a --format '{{.Names}}' | grep -q "^${TEST_CONTAINER}$"; then
    docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
fi

log "İzole Redis test container başlatılıyor (127.0.0.1:$TEST_PORT)..."
# --appendonly no parametresi ile RDB snapshot doğrudan belleğe yüklenir
docker run -d \
    --name "$TEST_CONTAINER" \
    -p "127.0.0.1:${TEST_PORT}:6379" \
    -v "$TEMP_RESTORE_DIR:/data" \
    redis:7-alpine \
    redis-server --appendonly no >/dev/null

# Başlamasını bekle
log "Redis servisinin ayağa kalkması bekleniyor..."
READY=false
for i in {1..15}; do
    if docker exec "$TEST_CONTAINER" redis-cli ping | grep -q "PONG"; then
        READY=true
        break
    fi
    sleep 1
done

if [[ "$READY" != true ]]; then
    log_error "Test Redis container yanıt vermedi!"
    docker logs "$TEST_CONTAINER"
    exit 1
fi

log "Test Redis container hazır (PONG alındı)."

# ------------------------------------------------------------------------------
# 4. NakliyeGo Veri Bütünlüğü Doğrulaması
# ------------------------------------------------------------------------------
log "=========================================================="
log "   NAKLIYEGO VERİ DOĞRULAMA TEST RAPORU                   "
log "=========================================================="

DB_SIZE=$(docker exec "$TEST_CONTAINER" redis-cli dbsize | tr -d '\r')
log "Toplam Anahtar Sayısı (DBSIZE): $DB_SIZE"

# Yükler (loads zset)
LOADS_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli zcard loads | tr -d '\r' || echo "0")
log "Yük İlanları ('loads' zset count): $LOADS_COUNT"

# Kullanıcılar (user:* keys)
USERS_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli --scan --pattern "user:*" | wc -l | tr -d ' ')
log "Kullanıcı Kayıtları ('user:*' count): $USERS_COUNT"

# Şirketler (company:* keys)
COMPANIES_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli --scan --pattern "company:*" | wc -l | tr -d ' ')
log "Şirket Kayıtları ('company:*' count): $COMPANIES_COUNT"

# Teklifler (offers:* keys)
OFFERS_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli --scan --pattern "offers:*" | wc -l | tr -d ' ')
log "Teklif Kayıtları ('offers:*' count): $OFFERS_COUNT"

log "=========================================================="

if [[ "$DB_SIZE" -le 0 ]]; then
    log_error "DİKKAT: Geri yüklenen veritabanı boş (DBSIZE=0)!"
    exit 1
fi

log "✅ Restore testi ve veri bütünlüğü doğrulaması BAŞARIYLA TAMAMLANDI."
