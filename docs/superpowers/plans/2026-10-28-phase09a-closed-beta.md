# Faz 09A Kapalı Beta Hazırlığı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Müşteri ve şoför uygulamalarının kapalı beta kabul kapsamını otomatik, beta API ve manuel cihaz kanıtlarıyla sınıflandırmak.

**Architecture:** Mevcut Go/Node testleri ana regresyon kanıtıdır. Beta API kontrolleri production'a dokunmadan sağlık, yetki ve mevcut izole test yüzeyini doğrular; cihaz ve mağaza adımları çalıştırılmadıkça açık kalır.

**Tech Stack:** Go test, Node test runner, Expo Doctor/export, HTTPS beta API, Markdown test raporu.

**Spec:** `docs/superpowers/specs/2026-10-28-phase09a-closed-beta-design.md`

## Global Constraints

- Production'a deploy yapma veya production verisine dokunma.
- Gerçek müşteri/para hareketi kullanma ve beta Redis verisini silme.
- Fiziksel cihazda çalıştırılmayan testi başarılı gösterme.
- APNs, Apple üyeliği, Faz 08 hukuk ve public URL risklerini açık tut.
- Yalnız kanıtlanan hatayı, minimum değişiklikle ve TDD ile düzelt.

## Review Focus

- Kurumsal 0 TL ve 500 TL planları onaysız başlatmayı aynı biçimde engellemeli.
- Tamamlama tekrarı ikinci kredi/komisyon hareketi oluşturmamalı.
- Yetkisiz müşteri/şoför diğer tarafın işi, mesajı veya ödeme kararını değiştirememeli.
- Push'a dokunma yalnız ilgili ekranı açmalı; onay kararı backend'de kalmalı.
- Cihaz, APNs ve mağaza portalı kanıtları otomatik test sonuçlarıyla karıştırılmamalı.

---

### Task 1: Mevcut test ve ortam envanteri

**Files:**
- Read: `docs/testing/2026-10-28-phase08-closure.md`
- Read: `docs/testing/2026-10-27-beta-consent-deployment.md`
- Read: backend ve mobil test dosyaları, uygulama/EAS yapılandırmaları

**Interfaces:**
- Consumes: Faz 08 kapanış durumu ve mevcut test komutları.
- Produces: Faz 09A test matrisi ve kanıt sınırları.

- [ ] İlgili backend/mobil testleri ve beta endpointlerini haritala.
- [ ] Beta kimliği, uygulama projectId/bundle ID ve native/push ön koşullarını mevcut yapılandırmadan doğrula.
- [ ] İzole beta test hesabı erişimi yoksa veri değiştiren beta E2E'yi açık olarak sınıflandır.

### Task 2: Otomatik regresyon ve beta smoke

**Files:**
- Test: mevcut backend, müşteri, şoför ve admin testleri
- Create: `docs/testing/phase09a-20261028/verification.txt`

**Interfaces:**
- Consumes: Task 1 test matrisi.
- Produces: Komut, durum ve çıktı özetleri.

- [ ] Backend paketlerini ve ödeme/teslimat/hesap silme yarış testlerini çalıştır.
- [ ] Müşteri, şoför, admin testleri ile Expo Doctor ve JS export kontrollerini çalıştır.
- [ ] Beta health/readiness, 401, 403, 5xx göstergesi ve bağlantı hatası davranışını doğrula.
- [ ] Uygun izole kimlikler varsa 4.100 TL/500 TL beta API E2E'yi benzersiz test kayıtlarıyla çalıştır; yoksa eski beta kanıtını tarihli ve yeniden çalıştırılmamış olarak belirt.
- [ ] Hata çıkarsa kök nedeni belirle; yalnız kanıtlanan ürün hatasını test-first düzelt.

### Task 3: Cihaz, push ve mağaza kabul paketi

**Files:**
- Create: `docs/testing/2026-10-28-phase09a-closed-beta.md`
- Create: `docs/testing/phase09a-20261028/manual-device-checklist.md`
- Create: `docs/testing/phase09a-20261028/store-prerequisites.md`

**Interfaces:**
- Consumes: Task 1 matrisi ve Task 2 kanıtları.
- Produces: P0/P1/P2 raporu, iPhone/Android/push adımları ve dağıtım engelleri.

- [ ] Müşteri/şoför E2E senaryolarını ön koşul, adım, beklenen sonuç ve kanıt alanlarıyla yaz.
- [ ] iPhone 13 ve Android için foreground/background/terminated push dahil manuel kontrol listesini yaz.
- [ ] TestFlight ve Google Play kapalı test ön koşullarını ayrı listele.
- [ ] Sonuçları P0/P1/P2 olarak sınıflandır; çalıştırılmayan cihaz/mağaza adımlarını açık bırak.
- [ ] Rapor dosyalarında production deploy veya fiziksel cihaz başarısı iddiası bulunmadığını doğrula.
