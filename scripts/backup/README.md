# NakliyeGo — Redis Zero-Downtime Yedekleme ve Kurtarma Sistemi

Bu dizin, NakliyeGo Production (`nakliye-app-redis-1`) ve Beta (`nakliye-beta-redis-1`) Redis veritabanları için sıfır kesintiyle (zero-downtime) çalışan, AWS S3'e şifreli yedekleme yapan ve bağımsız izole test container'ında kurtarma doğrulaması gerçekleştiren operasyonel scriptleri içerir.

---

## 📌 1. Temel Mimari Prensipleri

1. **Canlı AOF'u Doğrudan Kopyalamama**: Redis 7 multi-part AOF (`appendonlydir/` altındaki aktif `.incr.aof`) canlı yazma sırasında kopyalanırsa eksik veya bozuk veri riski oluşur. Bu nedenle yedekleme için Redis'in tutarlı point-in-time snapshot mekanizması olan `BGSAVE` kullanılır.
2. **Zero Downtime ve Tutarlılık**: Canlı container'lar durdurulmaz, bağlantılar kesilmez. Önceden çalışan belirsiz BGSAVE varsa reddedilir; yeni başlatılan `BGSAVE` arka planda tamamlanana kadar `rdb_bgsave_in_progress`, `LASTSAVE` ve `rdb_last_bgsave_status:ok` güvenilir şekilde doğrulanır.
3. **Çift Kademeli Bütünlük Kontrolü**: RDB dosyası hem container içinde hem de sunucuya kopyalandıktan sonra `redis-check-rdb` ve SHA-256 ile doğrulanır.
4. **S3 Yükleme ve Özet Doğrulaması**: S3'e yüklenen arşivin bayt boyutu yerel boyutla karşılaştırılır, yüklenen SHA-256 kontrol dosyasının içeriği S3'ten okunup teyit edilir.
5. **En Düşük Yetki (Least Privilege)**: IAM politikasında `s3:DeleteObject` izni **verilmez**. Fidye yazılımı (ransomware) veya kaza sonucu yedeklerin silinmesi engellenir.
6. **İzole ve Güvenli Geri Yükleme Testi**: Restore testi canlı hiçbir container'a dokunmaz, hiçbir container'ı otomatik silmez, benzersiz isimli geçici container üzerinde ve canlı verilerden tamamen izole biçimde çalışır.

---

## 🚀 2. AWS Altyapı Hazırlığı

### 2.1. S3 Bucket Oluşturma ve Şifreleme
```bash
# Bucket oluştur (eu-central-1 Frankfurt)
aws s3api create-bucket \
    --bucket nakliyego-backups-292187657171 \
    --region eu-central-1 \
    --create-bucket-configuration LocationConstraint=eu-central-1

# Varsayılan AES256 şifrelemeyi etkinleştir
aws s3api put-bucket-encryption \
    --bucket nakliyego-backups-292187657171 \
    --server-side-encryption-configuration '{
        "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
    }'

# Bucket Versioning etkinleştir (Güvenlik için önerilir)
aws s3api put-bucket-versioning \
    --bucket nakliyego-backups-292187657171 \
    --versioning-configuration Status=Enabled

# 30 Günlük Saklama Politikasını Uygula
aws s3api put-bucket-lifecycle-configuration \
    --bucket nakliyego-backups-292187657171 \
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

### 3.2. Çalışma ve Log Dizinleri
```bash
# Çalışma ve log dizinlerini oluştur (ubuntu kullanıcısı için yazılabilir)
mkdir -p /home/ubuntu/nakliyego-backup-work
mkdir -p /home/ubuntu/nakliye-app/logs/backup

# Scriptlere çalıştırma izni ver
chmod +x /home/ubuntu/nakliye-app/scripts/backup/*.sh
```

### 3.3. Cron Görevlerinin Tanımlanması
Sunucuda `crontab -e` komutunu çalıştırarak `crontab.example` içeriğini ekleyin:
```bash
# Production Redis (Her gece TSİ 03:00 / UTC 00:00)
0 0 * * * /home/ubuntu/nakliye-app/scripts/backup/redis-backup.sh prod >> /home/ubuntu/nakliye-app/logs/backup/redis-backup-prod.log 2>&1

# Beta Redis (Her gece TSİ 03:15 / UTC 00:15)
15 0 * * * /home/ubuntu/nakliye-app/scripts/backup/redis-backup.sh beta >> /home/ubuntu/nakliye-app/logs/backup/redis-backup-beta.log 2>&1

# Haftalık İzole Restore Testi (Her Pazar TSİ 04:00 / UTC 01:00)
0 1 * * 0 /home/ubuntu/nakliye-app/scripts/backup/redis-restore-test.sh prod >> /home/ubuntu/nakliye-app/logs/backup/redis-restore-test.log 2>&1
```

---

## 🧪 4. Manuel Test ve Doğrulama

### 4.1. Yedekleme Testi Çalıştırma
```bash
# Production için yedek al
/home/ubuntu/nakliye-app/scripts/backup/redis-backup.sh prod

# Beta için yedek al
/home/ubuntu/nakliye-app/scripts/backup/redis-backup.sh beta
```
Çıktıda şunlar doğrulanmalıdır:
- BGSAVE öncesi arka planda başka işlem olmadığı teyit edildi
- `rdb_last_bgsave_status: ok` ve `CURRENT_LASTSAVE > PREV_LASTSAVE`
- Container içi ve kopyalanan `dump.rdb` bütünlük kontrolünden geçti
- SHA-256 hesaplandı ve S3'e yüklendi
- S3 arşiv boyutu ve S3 SHA-256 içeriği yerel verilerle birebir doğrulandı

### 4.2. İzole Geri Yükleme Testi
Bu test canlı sunucuya hiçbir zarar vermeden, izole geçici bir container (`nakliye-restore-test-...`) üzerinde yedeği açar ve NakliyeGo anahtarlarını kontrol eder:
```bash
/home/ubuntu/nakliye-app/scripts/backup/redis-restore-test.sh prod
```
Rapor çıktısı:
- Zorunlu SHA-256 sağlama toplamı doğrulaması
- `redis-check-rdb` format kontrolü
- Toplam DB boyutu (`DBSIZE`)
- Aktif yük ilanları (`loads` zset)
- Kullanıcı sayısı (`user:*`)
- Şirket sayısı (`company:*`)
- Teklif sayısı (`offers:*`)
- Tamamlandığında yalnızca test için oluşturulan geçici container ve dosyalar temizlenir.

---

## 🆘 5. Gerçek Bir Felaket Durumunda Geri Yükleme (Disaster Recovery)

Canlı Redis sunucusunun tamamen çökmesi veya verilerin zarar görmesi durumunda uygulanacak acil durum adımları:

1. **İlgili servisleri geçici durdur**:
   ```bash
   docker stop nakliye-app-backend-1
   docker stop nakliye-app-redis-1
   ```
2. **S3'ten son sağlam yedeği indir, SHA-256'yı doğrula ve arşivden çıkar**:
   ```bash
   LATEST_BACKUP=$(aws s3 ls s3://nakliyego-backups-292187657171/redis/production/ | grep '\.rdb\.tar\.gz$' | tail -n 1 | awk '{print $4}')
   aws s3 cp "s3://nakliyego-backups-292187657171/redis/production/$LATEST_BACKUP" /tmp/
   aws s3 cp "s3://nakliyego-backups-292187657171/redis/production/$LATEST_BACKUP.sha256" /tmp/
   cd /tmp && sha256sum -c "$LATEST_BACKUP.sha256"
   tar -xzf "$LATEST_BACKUP"
   ```
3. **Mevcut Docker volume içerisindeki bozuk veriyi temizle ve dump.rdb'yi yerleştir**:
   ```bash
   docker run --rm -v nakliye-app_redis-data:/data -v /tmp:/backup alpine sh -c "rm -rf /data/appendonlydir /data/dump.rdb && cp /backup/dump.rdb /data/dump.rdb && chown -R 999:999 /data"
   ```
4. **Redis container'ını başlat**:
   ```bash
   docker start nakliye-app-redis-1
   ```
5. **Backend servisini tekrar başlat**:
   ```bash
   docker start nakliye-app-backend-1
   ```
6. **Logları ve API sağlığını doğrula**:
   ```bash
   docker logs --tail 50 nakliye-app-backend-1
   curl http://localhost:8080/health
   ```
