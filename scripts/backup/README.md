# NakliyeGo — Redis Zero-Downtime Yedekleme ve Kurtarma Sistemi

Bu dizin, NakliyeGo Production (`nakliye-app-redis-1`) ve Beta (`nakliye-beta-redis-1`) Redis veritabanları için sıfır kesintiyle (zero-downtime) çalışan, AWS S3'e şifreli yedekleme yapan ve bağımsız izole test container'ında kurtarma doğrulaması gerçekleştiren operasyonel scriptleri içerir.

---

## 📌 1. Temel Mimari Prensipleri

1. **Canlı AOF'u Doğrudan Kopyalamama**: Redis 7 multi-part AOF (`appendonlydir/` altındaki aktif `.incr.aof`) canlı yazma sırasında kopyalanırsa eksik veya bozuk veri riski oluşur. Bu nedenle yedekleme için Redis'in tutarlı point-in-time snapshot mekanizması olan `BGSAVE` kullanılır.
2. **Zero Downtime**: Container'lar durdurulmaz, bağlantılar kesilmez. `BGSAVE` arka planda çalıştırılır, `LASTSAVE` ve `rdb_last_bgsave_status:ok` doğrulanır.
3. **Bütünlük Kontrolü**: RDB dosyası henüz sunucudan çıkmadan container içinde `redis-check-rdb` ile doğrulanır.
4. **En Düşük Yetki (Least Privilege)**: IAM politikasında `s3:DeleteObject` izni **verilmez**. Fidye yazılımı (ransomware) veya kaza sonucu yedeklerin silinmesi engellenir.
5. **Off-site & Şifreleme**: Yedekler sunucuda tutulmaz, AWS S3'e `AES256` şifreleme ve SHA-256 sağlama toplamı ile yüklenir. 30 gün sonra S3 Lifecycle politikası ile otomatik sonlandırılır.
6. **Kernel Optimizasyonu (Önemli)**: Redis `BGSAVE` işlemi Linux `fork()` çağrısı ile Copy-on-Write (CoW) kullanır. Bellek yetersizliği hatalarını önlemek için host makinede mutlaka `vm.overcommit_memory = 1` yapılmalıdır.

---

## 🚀 2. AWS Altyapı Hazırlığı

### 2.1. S3 Bucket Oluşturma ve Şifreleme
```bash
# Bucket oluştur (Örn: eu-central-1 Frankfurt)
aws s3api create-bucket \
    --bucket nakliyego-backups \
    --region eu-central-1 \
    --create-bucket-configuration LocationConstraint=eu-central-1

# Varsayılan AES256 şifrelemeyi etkinleştir
aws s3api put-bucket-encryption \
    --bucket nakliyego-backups \
    --server-side-encryption-configuration '{
        "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
    }'

# Bucket Versioning etkinleştir (Güvenlik için önerilir)
aws s3api put-bucket-versioning \
    --bucket nakliyego-backups \
    --versioning-configuration Status=Enabled

# 30 Günlük Saklama Politikasını Uygula
aws s3api put-bucket-lifecycle-configuration \
    --bucket nakliyego-backups \
    --lifecycle-configuration file://s3-lifecycle.json
```

### 2.2. IAM Rolü Tanımlama
EC2 sunucusuna iliştirilen Instance Profile rolüne `iam-policy.json` dosyasındaki politika eklenmelidir:
```bash
aws iam create-policy \
    --policy-name NakliyeGo-EC2-RedisBackup-Policy \
    --policy-document file://iam-policy.json
```

---

## ⚙️ 3. EC2 Sunucusu Kurulum Adımları

### 3.1. Kernel Overcommit Bellek Ayarı
Host sunucuda terminalden çalıştırın:
```bash
# Anlık uygulama:
sudo sysctl vm.overcommit_memory=1

# Kalıcı hale getirme:
echo "vm.overcommit_memory = 1" | sudo tee -a /etc/sysctl.conf
```

### 3.2. Scriptlerin Kurulumu
```bash
# Dizinleri oluştur
sudo mkdir -p /opt/nakliyego/scripts
sudo mkdir -p /var/log

# Scriptleri kopyala ve çalıştırma izni ver
sudo cp scripts/backup/redis-backup.sh /opt/nakliyego/scripts/
sudo cp scripts/backup/redis-restore-test.sh /opt/nakliyego/scripts/
sudo chmod +x /opt/nakliyego/scripts/*.sh
```

### 3.3. Cron Görevlerinin Tanımlanması
Sunucuda `crontab -e` komutunu çalıştırarak `crontab.example` içeriğini ekleyin:
```bash
# Production Redis (Her gece TSİ 03:00 / UTC 00:00)
0 0 * * * /opt/nakliyego/scripts/redis-backup.sh prod >> /var/log/nakliyego-backup-prod.log 2>&1

# Beta Redis (Her gece TSİ 03:15 / UTC 00:15)
15 0 * * * /opt/nakliyego/scripts/redis-backup.sh beta >> /var/log/nakliyego-backup-beta.log 2>&1

# Haftalık İzole Restore Testi (Her Pazar TSİ 04:00 / UTC 01:00)
0 1 * * 0 /opt/nakliyego/scripts/redis-restore-test.sh prod >> /var/log/nakliyego-restore-test.log 2>&1
```

---

## 🧪 4. Manuel Test ve Doğrulama

### 4.1. Yedekleme Testi Çalıştırma
```bash
# Production için manuel yedek al
/opt/nakliyego/scripts/redis-backup.sh prod

# Beta için manuel yedek al
/opt/nakliyego/scripts/redis-backup.sh beta
```
Çıktıda şunlar doğrulanmalıdır:
- `rdb_last_bgsave_status: ok`
- `redis-check-rdb` başarıyla geçti
- SHA-256 hesaplandı ve S3'e yüklendi
- `S3 doğrulaması başarılı! (S3 Boyutu: ... bytes)`

### 4.2. İzole Geri Yükleme Testi
Bu test canlı sunucuya hiçbir zarar vermeden, izole geçici bir container (`127.0.0.1:16379`) üzerinde yedeği açar ve NakliyeGo anahtarlarını kontrol eder:
```bash
/opt/nakliyego/scripts/redis-restore-test.sh prod
```
Rapor çıktısı:
- Toplam DB boyutu (`DBSIZE`)
- Aktif yük ilanları (`loads` zset)
- Kullanıcı sayısı (`user:*`)
- Şirket sayısı (`company:*`)
- Teklif sayısı (`offers:*`)
- Tamamlandığında test container ve geçici dosyalar temizlenir.

---

## 🆘 5. Gerçek Bir Felaket Durumunda Geri Yükleme (Disaster Recovery)

Canlı Redis sunucusunun tamamen çökmesi veya verilerin zarar görmesi durumunda uygulanacak acil durum adımları:

1. **İlgili servisleri geçici durdur**:
   ```bash
   docker stop nakliye-app-backend-1
   docker stop nakliye-app-redis-1
   ```
2. **S3'ten son sağlam yedeği indir ve arşivden çıkar**:
   ```bash
   LATEST_BACKUP=$(aws s3 ls s3://nakliyego-backups/redis/production/ | grep '\.rdb\.tar\.gz$' | tail -n 1 | awk '{print $4}')
   aws s3 cp "s3://nakliyego-backups/redis/production/$LATEST_BACKUP" /tmp/
   cd /tmp && tar -xzf "$LATEST_BACKUP"
   ```
3. **Mevcut Docker volume içerisindeki bozuk veriyi temizle ve dump.rdb'yi yerleştir**:
   ```bash
   # Volume mount noktasına RDB dosyasını kopyala
   docker run --rm -v nakliye-app_redis-data:/data -v /tmp:/backup alpine sh -c "rm -rf /data/appendonlydir /data/dump.rdb && cp /backup/dump.rdb /data/dump.rdb && chown -R 999:999 /data"
   ```
4. **Redis container'ını başlat**:
   ```bash
   docker start nakliye-app-redis-1
   ```
   *Not: Redis başladığında `dump.rdb` dosyasını otomatik okuyacak ve AOF tekrar sıfırdan tutarlı olarak üretilecektir.*
5. **Backend servisini tekrar başlat**:
   ```bash
   docker start nakliye-app-backend-1
   ```
6. **Logları ve API sağlığını doğrula**:
   ```bash
   docker logs --tail 50 nakliye-app-backend-1
   curl http://localhost:8080/health
   ```
