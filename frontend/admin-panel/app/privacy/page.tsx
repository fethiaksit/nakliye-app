import React from "react";
import PublicLayout from "../components/PublicLayout";

export const metadata = {
  title: "Gizlilik Politikası — NakliyeGo",
  description: "NakliyeGo Müşteri ve Şoför platformları için kapsamlı gizlilik politikası ve veri güvenliği ilkeleri.",
};

export default function PrivacyPage() {
  return (
    <PublicLayout
      title="NakliyeGo Gizlilik Politikası"
      subtitle="Kişisel verilerinizin toplanması, işlenmesi, güvenliği ve paylaşım sınırları hakkında bilgilendirme."
      version="1.0.0"
      updatedAt="14 Ekim 2026"
    >
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          1. Veri Sorumlusu Bilgileri
        </h2>
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, veri sorumlusu sıfatıyla{" "}
          <strong>Feti Akşit Limited Şirketi</strong> [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü] (“NakliyeGo” veya “Şirket”)
          tarafından işletilen dijital platformlar kapsamında işlenen verileriniz güvence altındadır.
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Ticaret Unvanı:</strong> Feti Akşit Limited Şirketi [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü]</li>
          <li><strong>Vergi Dairesi / VKN:</strong> Hasan Tahsin Vergi Dairesi — 3850507457</li>
          <li><strong>MERSİS No:</strong> [DOĞRULAMA GEREKLİ: MERSİS Numarası]</li>
          <li><strong>Ticaret Sicil No:</strong> [DOĞRULAMA GEREKLİ: Ticaret Sicil Numarası]</li>
          <li><strong>Adres:</strong> 6220 Sokak No: 12/A, Bornova / İzmir</li>
          <li><strong>İletişim:</strong> zeytinavm@gmail.com</li>
          <li><strong>KEP Adresi:</strong> [DOĞRULAMA GEREKLİ: KEP Adresi]</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          2. Toplanan Kişisel Veriler
        </h2>
        <p>Platformumuz aracılığıyla sağlanan nakliye aracılık hizmeti kapsamında aşağıdaki veriler işlenir:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Kimlik ve Hesap Bilgileri:</strong> Ad, soyad, e-posta adresi, cep telefonu numarası, hesap türü (bireysel veya kurumsal), parola özeti (Argon2id).</li>
          <li><strong>Şoför ve Araç Bilgileri:</strong> Araç cinsi, marka, model, plaka, taşıma kapasitesi (kg), kasa ebatları, sürücü belgesi, SRC mesleki yeterlilik ve psikoteknik belgeleri.</li>
          <li><strong>Konum Bilgileri:</strong>
            <ul>
              <li><em>Müşteri:</em> İlan oluştururken yükleme/teslimat adresi seçimi ve rota hesaplama için ön plan konumu.</li>
              <li><em>Şoför:</em> Yakındaki yükleri görme (ön plan) ve teklif onaylandıktan sonra aktif sefer süresince müşteriye canlı takip sunulması amacıyla ön plan ve arka plan konumu.</li>
            </ul>
          </li>
          <li><strong>Taşıma ve Güvenlik Bilgileri:</strong> Kargo fotoğrafları, 6 haneli güvenlik teslimat kodu ve teslimat kanıt fotoğrafları.</li>
          <li><strong>Mesajlaşma:</strong> Teklifi onaylanmış taşımalar için uygulama içi operasyonel mesajlaşma içerikleri.</li>
          <li><strong>Teknik ve Cihaz Verileri:</strong> IP adresi, işletim sistemi sürümü, donanım modeli, Expo Push token, 5651 sayılı kanun kapsamındaki erişim logları.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          3. Verilerin İşlenme Amaçları ve Hukuki Sebepleri
        </h2>
        <p>Kişisel verileriniz KVKK Madde 5 ve 6 uyarınca şu sebeplerle işlenir:</p>
        <ol style={{ paddingLeft: 20 }}>
          <li><strong>Sözleşmenin İfası (KVKK m. 5/2-c):</strong> İlan oluşturma, teklif iletimi, eşleşme, 6 haneli teslimat kodu ile teyit ve operasyonel iletişim.</li>
          <li><strong>Hukuki Yükümlülük (KVKK m. 5/2-ç):</strong> 5651 sayılı Kanun logları, TTK ve VUK gereği fatura/muhasebe kayıtları, Karayolu Taşıma Mevzuatı gereklilikleri.</li>
          <li><strong>Meşru Menfaat (KVKK m. 5/2-f):</strong> Sahte hesap ve kötüye kullanımın engellenmesi, Sentry ile PII arındırılmış hata takibi.</li>
          <li><strong>Açık Rıza (KVKK m. 5/1):</strong> İsteğe bağlı ticari elektronik ileti ve pazarlama bildirimleri (kullanıcı istediği an geri alabilir).</li>
        </ol>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          4. Veri Aktarımı ve Üçüncü Taraflar
        </h2>
        <p>Kişisel verileriniz üçüncü taraflara satılmaz veya kiralanmaz. Yalnızca operasyonel zorunluluk halinde:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Taşıma Tarafları:</strong> Teklif kabul edildiğinde müşteri ve şoför arasında ad, telefon ve taşıma adresi paylaşılır.</li>
          <li><strong>Google Maps Platform:</strong> Adres tamamlama ve rota hesabı için koordinat iletimi.</li>
          <li><strong>Resend:</strong> E-posta doğrulama ve şifre sıfırlama için e-posta adresi iletimi.</li>
          <li><strong>Yetkili Kamu Kurumları:</strong> Yasal zorunluluk halinde adli ve idari makamlar.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          5. Hesap Silme ve Veri İmha (App Store ve Google Play Uyumu)
        </h2>
        <p>
          Kullanıcılarımız mobil uygulamada <code>Profil &gt; Hesap İşlemleri &gt; Hesabımı Sil</code> menüsünden veya herkese açık{" "}
          <a href="/account-deletion" style={{ color: "#246b45", fontWeight: 700 }}>Hesap Silme Talep Sayfamız</a> üzerinden hesaplarını ve kişisel verilerini silebilirler.
          Yasal saklama süresi dolan kayıtlar mevzuata uygun şekilde kalıcı olarak imha edilir veya anonimleştirilir.
        </p>
      </section>
    </PublicLayout>
  );
}
