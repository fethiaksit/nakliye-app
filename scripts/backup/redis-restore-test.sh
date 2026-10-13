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
# 2. Canlı veriler hiçbir koşulda silinmez veya üzerine restore yapılmaz.
# 3. Mevcut hiçbir container'ı otomatik silmez; benzersiz test container adı üretir.
# 4. S3'ten en güncel RDB yedeğini indirir (veya verilen hedefi kullanır).
# 5. SHA-256 doğrulamasını ZORUNLU olarak gerçekleştirir; eksik/bozuksa başarısız olur.
# 6. Arşivi geçici test dizinine açar ve redis-check-rdb ile inceler.
# 7. İzole geçici container başlatır (--appendonly no ile RDB'yi okur).
# 8. NakliyeGo key yapısını (loads, user:*, company:*, offers:*) sorgular.
# 9. Yalnızca bu test tarafından başlatılan geçici container'ı ve dosyaları temizler.
# ==============================================================================

set -euo pipefail

ENV="${1:-prod}"
SPECIFIC_TARGET="${2:-}"
S3_BUCKET="${S3_BUCKET:-nakliyego-backups-292187657171}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
RANDOM_SUFFIX="$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom 2>/dev/null | head -c 8 || echo "$$")"

# Benzersiz ve çakışmasız test container adı
TEST_CONTAINER="nakliye-restore-test-${ENV}-${TIMESTAMP}-${RANDOM_SUFFIX}"
TEMP_RESTORE_DIR="/tmp/nakliyego-restore-test-${ENV}-${TIMESTAMP}-${RANDOM_SUFFIX}"
CONTAINER_CREATED=false

# Ortam Yapılandırması ve Ayrımı
if [[ "$ENV" == "prod" ]]; then
    S3_PREFIX="redis/production"
    ENV_NAME="Production"
    LIVE_CONTAINER="nakliye-app-redis-1"
elif [[ "$ENV" == "beta" ]]; then
    S3_PREFIX="redis/beta"
    ENV_NAME="Beta"
    LIVE_CONTAINER="nakliye-beta-redis-1"
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
    local exit_code=$?
    log "Test temizliği başlatılıyor..."

    # Yalnızca bu testin oluşturduğu container temizlenir; canlı container'lar asla silinmez
    if [[ "$CONTAINER_CREATED" == true ]]; then
        if [[ "$TEST_CONTAINER" =~ ^nakliye-restore-test- ]] && [[ "$TEST_CONTAINER" != "$LIVE_CONTAINER" ]]; then
            if docker ps -a --format '{{.Names}}' | grep -q "^${TEST_CONTAINER}$"; then
                docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
                log "Bu test tarafından oluşturulan izole test container silindi: $TEST_CONTAINER"
            fi
        fi
    fi

    if [[ -d "$TEMP_RESTORE_DIR" ]]; then
        rm -rf "$TEMP_RESTORE_DIR"
        log "Geçici test çalışma dizini silindi: $TEMP_RESTORE_DIR"
    fi

    exit "$exit_code"
}

trap cleanup EXIT

# ------------------------------------------------------------------------------
# 1. Güvenlik ve Çakışma Ön Kontrolleri
# ------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    log_error "docker komutu bulunamadı!"
    exit 1
fi

# Canlı container'ların adı ile test container adı kesinlikle aynı olamaz
if [[ "$TEST_CONTAINER" == "$LIVE_CONTAINER" ]] || [[ "$TEST_CONTAINER" == "nakliye-app-redis-1" ]] || [[ "$TEST_CONTAINER" == "nakliye-beta-redis-1" ]]; then
    log_error "GÜVENLİK İHLALİ: Test container adı canlı container ile eşleşemez!"
    exit 1
fi

# Mevcut container'ları otomatik silmeme kuralı
if docker ps -a --format '{{.Names}}' | grep -q "^${TEST_CONTAINER}$"; then
    log_error "Container adı '$TEST_CONTAINER' zaten mevcut! Mevcut container'ları silmeme kuralı gereği işlem iptal edildi."
    exit 1
fi

mkdir -p "$TEMP_RESTORE_DIR"

# ------------------------------------------------------------------------------
# 2. Yedek İndirme ve Zorunlu SHA-256 Doğrulaması
# ------------------------------------------------------------------------------
if [[ -n "$SPECIFIC_TARGET" ]]; then
    if [[ "$SPECIFIC_TARGET" =~ ^s3:// ]]; then
        log "Belirtilen S3 hedefi kullanılıyor: $SPECIFIC_TARGET"
        ARCHIVE_FILE_NAME="$(basename "$SPECIFIC_TARGET")"
        ARCHIVE_PATH="$TEMP_RESTORE_DIR/$ARCHIVE_FILE_NAME"
        SHA_TARGET="${SPECIFIC_TARGET}.sha256"

        log "S3 üzerinde zorunlu SHA-256 kontrol dosyası denetleniyor: $SHA_TARGET"
        if ! aws s3 ls "$SHA_TARGET" --region "$AWS_REGION" >/dev/null 2>&1; then
            log_error "Zorunlu SHA-256 kontrol dosyası S3 üzerinde bulunamadı ($SHA_TARGET)! Bütünlük doğrulanamadığı için geri yükleme reddedildi."
            exit 1
        fi

        log "Yedek arşivi ve SHA-256 dosyası indiriliyor..."
        aws s3 cp "$SPECIFIC_TARGET" "$ARCHIVE_PATH" --region "$AWS_REGION"
        aws s3 cp "$SHA_TARGET" "$ARCHIVE_PATH.sha256" --region "$AWS_REGION"
    elif [[ -f "$SPECIFIC_TARGET" ]]; then
        log "Yerel dosya kullanılıyor: $SPECIFIC_TARGET"
        ARCHIVE_FILE_NAME="$(basename "$SPECIFIC_TARGET")"
        ARCHIVE_PATH="$TEMP_RESTORE_DIR/$ARCHIVE_FILE_NAME"
        cp "$SPECIFIC_TARGET" "$ARCHIVE_PATH"

        LOCAL_SHA_SOURCE="${SPECIFIC_TARGET}.sha256"
        if [[ ! -f "$LOCAL_SHA_SOURCE" ]]; then
            log_error "Zorunlu yerel SHA-256 kontrol dosyası bulunamadı: $LOCAL_SHA_SOURCE! Bütünlük doğrulaması olmadan geri yükleme yapılamaz."
            exit 1
        fi
        cp "$LOCAL_SHA_SOURCE" "$ARCHIVE_PATH.sha256"
    else
        log_error "Belirtilen hedef dosya veya S3 adresi bulunamadı: $SPECIFIC_TARGET"
        exit 1
    fi
else
    log "S3 üzerindeki en güncel yedek taranıyor: s3://$S3_BUCKET/$S3_PREFIX/"
    LATEST_ARCHIVE=$(aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" --region "$AWS_REGION" | grep '\.rdb\.tar\.gz$' | sort | tail -n 1 | awk '{print $4}')

    if [[ -z "$LATEST_ARCHIVE" ]]; then
        log_error "S3 üzerinde ($S3_PREFIX) geçerli bir yedek arşivi bulunamadı!"
        exit 1
    fi

    log "En güncel yedek tespit edildi: $LATEST_ARCHIVE"
    ARCHIVE_PATH="$TEMP_RESTORE_DIR/$LATEST_ARCHIVE"
    S3_ARCHIVE_URI="s3://$S3_BUCKET/$S3_PREFIX/$LATEST_ARCHIVE"
    S3_SHA_URI="s3://$S3_BUCKET/$S3_PREFIX/$LATEST_ARCHIVE.sha256"

    # Zorunlu SHA-256 dosya kontrolü
    if ! aws s3 ls "$S3_SHA_URI" --region "$AWS_REGION" >/dev/null 2>&1; then
        log_error "ZORUNLU SHA-256 kontrol dosyası S3 üzerinde bulunamadı ($S3_SHA_URI)! Yedek eksik veya güvensiz olduğu için işlem durduruldu."
        exit 1
    fi

    log "Yedek arşivi indiriliyor: $S3_ARCHIVE_URI"
    aws s3 cp "$S3_ARCHIVE_URI" "$ARCHIVE_PATH" --region "$AWS_REGION"

    log "Zorunlu SHA-256 kontrol dosyası indiriliyor: $S3_SHA_URI"
    aws s3 cp "$S3_SHA_URI" "$ARCHIVE_PATH.sha256" --region "$AWS_REGION"

    # Boyut doğrulama
    REMOTE_SIZE=$(aws s3 ls "$S3_ARCHIVE_URI" --region "$AWS_REGION" | awk '{print $3}')
    LOCAL_SIZE=$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')
    if [[ "$REMOTE_SIZE" -ne "$LOCAL_SIZE" ]]; then
        log_error "İndirilen dosya boyutu ($LOCAL_SIZE bytes) S3 üzerindeki boyutla ($REMOTE_SIZE bytes) uyuşmuyor!"
        exit 1
    fi
fi

# ZORUNLU SHA-256 Sağlama Toplamı Doğrulaması
log "SHA-256 bütünlüğü zorunlu olarak kontrol ediliyor..."
ARCHIVE_BASE_NAME="$(basename "$ARCHIVE_PATH")"
if ! (cd "$TEMP_RESTORE_DIR" && sha256sum -c "$ARCHIVE_BASE_NAME.sha256"); then
    log_error "ZORUNLU SHA-256 SAĞLAMA TOPLAMI EŞLEŞMEDİ! Arşiv bozuk veya değiştirilmiş olabilir."
    exit 1
fi
log "✅ SHA-256 doğrulaması BAŞARILI."

# ------------------------------------------------------------------------------
# 3. Arşivi Açma ve RDB Bütünlük Kontrolü
# ------------------------------------------------------------------------------
log "Arşiv bütünlüğü test ediliyor ve açılıyor..."
tar -tzf "$ARCHIVE_PATH" >/dev/null
tar -xzf "$ARCHIVE_PATH" -C "$TEMP_RESTORE_DIR"

if [[ ! -s "$TEMP_RESTORE_DIR/dump.rdb" ]]; then
    log_error "Arşiv içinde dump.rdb dosyası bulunamadı veya boyutu 0 byte!"
    exit 1
fi

chmod 644 "$TEMP_RESTORE_DIR/dump.rdb"

log "Geri yüklenecek RDB dosyası redis-check-rdb ile inceleniyor..."
if command -v redis-check-rdb >/dev/null 2>&1; then
    redis-check-rdb "$TEMP_RESTORE_DIR/dump.rdb"
else
    docker run --rm -v "$TEMP_RESTORE_DIR:/data:ro" redis:7-alpine redis-check-rdb /data/dump.rdb
fi
log "RDB dosya formatı ve veri bütünlüğü doğrulandı."

# ------------------------------------------------------------------------------
# 4. İzole Test Container'ı Başlatma
# ------------------------------------------------------------------------------
log "Benzersiz izole Redis test container başlatılıyor: $TEST_CONTAINER"
# Not: Canlı Redis'e ait hiçbir volume mount edilmez.
# Sadece geçici test dizini /data olarak bağlanır.
# Port çakışmasını önlemek için dinamik loopback portu kullanılır (127.0.0.1::6379).
docker run -d \
    --name "$TEST_CONTAINER" \
    -p "127.0.0.1::6379" \
    -v "$TEMP_RESTORE_DIR:/data" \
    redis:7-alpine \
    redis-server --appendonly no >/dev/null

CONTAINER_CREATED=true

# Servisin ayağa kalkmasını bekle
log "İzole Redis servisinin hazır olması bekleniyor..."
READY=false
for i in {1..20}; do
    if docker exec "$TEST_CONTAINER" redis-cli ping 2>/dev/null | grep -q "PONG"; then
        READY=true
        break
    fi
    sleep 1
done

if [[ "$READY" != true ]]; then
    log_error "Test Redis container zamanında hazır olmadı!"
    docker logs "$TEST_CONTAINER" || true
    exit 1
fi

log "İzole Redis container hazır (PONG alındı)."

# ------------------------------------------------------------------------------
# 5. NakliyeGo Veri Bütünlüğü Doğrulaması
# ------------------------------------------------------------------------------
log "=========================================================="
log "   NAKLIYEGO VERİ DOĞRULAMA TEST RAPORU ($ENV_NAME)       "
log "=========================================================="

DB_SIZE=$(docker exec "$TEST_CONTAINER" redis-cli dbsize 2>/dev/null | tr -d '\r')
log "Toplam Anahtar Sayısı (DBSIZE): $DB_SIZE"

# Yükler (loads zset)
LOADS_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli zcard loads 2>/dev/null | tr -d '\r' || echo "0")
log "Yük İlanları ('loads' zset count): $LOADS_COUNT"

# Kullanıcılar (user:* keys)
USERS_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli --scan --pattern "user:*" 2>/dev/null | wc -l | tr -d ' ')
log "Kullanıcı Kayıtları ('user:*' count): $USERS_COUNT"

# Şirketler (company:* keys)
COMPANIES_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli --scan --pattern "company:*" 2>/dev/null | wc -l | tr -d ' ')
log "Şirket Kayıtları ('company:*' count): $COMPANIES_COUNT"

# Teklifler (offers:* keys)
OFFERS_COUNT=$(docker exec "$TEST_CONTAINER" redis-cli --scan --pattern "offers:*" 2>/dev/null | wc -l | tr -d ' ')
log "Teklif Kayıtları ('offers:*' count): $OFFERS_COUNT"

log "=========================================================="

if [[ -z "$DB_SIZE" ]] || [[ "$DB_SIZE" -le 0 ]]; then
    log_error "DİKKAT: Geri yüklenen veritabanı boş (DBSIZE=0)! Yedek geçerli veri içermiyor."
    exit 1
fi

log "✅ Restore testi ve veri bütünlüğü doğrulaması BAŞARIYLA TAMAMLANDI."
