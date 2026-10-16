import React from "react";
import PublicLayout from "../components/PublicLayout";

export const metadata = {
  title: "Kullanım Koşulları — NakliyeGo",
  description: "NakliyeGo Platform Kullanıcı Sözleşmesi ve Kullanım Koşulları.",
};

export default function TermsPage() {
  return (
    <PublicLayout
      title="Platform Kullanıcı Sözleşmesi (Kullanım Koşulları)"
      subtitle="NakliyeGo üzerinden sunulan aracılık hizmetlerinin tarafları, kuralları ve yasal çerçevesi."
      version="1.0.0"
      updatedAt="14 Ekim 2026"
    >
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          1. Taraflar ve Aracılık Rolü
        </h2>
        <p>
          İşbu Kullanıcı Sözleşmesi, <strong>Feti Akşit Limited Şirketi</strong> [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü] (“NakliyeGo”)
          ile Platform üzerinden ilan oluşturan veya teklif veren Kullanıcı (Müşteri ve Şoför) arasında akdedilmiştir.
        </p>
        <p>
          <strong>Aracı Hizmet Sağlayıcı Niteliği:</strong> NakliyeGo, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun uyarınca
          “Aracı Hizmet Sağlayıcı”dır. NakliyeGo bir taşıma taahhüt firması veya fiili taşıyıcı <strong>değildir</strong>. Taşıma akdi doğrudan
          seçilen bağımsız Şoför ile Müşteri arasında kurulur.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          2. Kullanıcı Yükümlülükleri ve Yasaklı Maddeler
        </h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Doğru Beyan:</strong> Yükün ağırlığı, ölçüleri, ambalajı ve kat/asansör bilgisi doğru beyan edilmelidir.</li>
          <li>
            <strong>Yasaklı Maddeler:</strong> Kanunen taşınması suç olan kaçak mallar, silah, mühimmat, yanıcı/parlayıcı/patlayıcı maddeler,
            uyuşturucu, radyoaktif atıklar ve çalıntı eşyaların ilana verilmesi kesinlikle yasaktır. Aykırılık halinde ilan iptal edilir,
            hesap kapatılır ve adli mercilere bildirim yapılır.
          </li>
          <li>
            <strong>Güvenli Teslimat Kodu:</strong> Müşteri, yükü eksiksiz ve sağlam teslim almadan önce 6 haneli güvenlik teslimat kodunu
            şoförle paylaşmamalıdır. Kodun girilmesi taşımanın tam yerine getirildiğinin yasal kabulüdür.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          3. Fiyatlandırma, Teklifler ve Cüzdan
        </h2>
        <p>
          Platformda üretilen fiyat tahminleri kılavuz niteliğinde olup kesin taşıma bedeli Şoför teklifinin Müşteri tarafından kabulüyle belirlenir.
          Kurumsal müşteriler, tahakkuk eden bedelleri kurumsal cüzdan bakiyeleri üzerinden ödeyebilirler.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          4. Sorumluluk Sınırları ve Uyuşmazlıklar
        </h2>
        <p>
          Taşıma fiilinden ve taşınan yükün fiziki zilyetliğinden kaynaklanan trafik kazası, hasar veya kayıplardan doğrudan ilgili bağımsız Şoför
          sorumludur [DOĞRULAMA GEREKLİ: Taşıma Sigortası Kapsamı]. Sözleşmeden doğan uyuşmazlıklarda Türkiye Cumhuriyeti kanunları uygulanır ve{" "}
          <strong>İzmir Mahkemeleri ve İcra Daireleri</strong> [DOĞRULAMA GEREKLİ: Yetkili Mahkeme] yetkilidir.
        </p>
      </section>
    </PublicLayout>
  );
}
