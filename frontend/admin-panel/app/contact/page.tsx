import React from "react";
import PublicLayout from "../components/PublicLayout";

export const metadata = {
  title: "İletişim ve Şirket Bilgileri — NakliyeGo",
  description: "NakliyeGo resmi iletişim kanalları, şirket unvanı ve yasal bildirim adresleri.",
};

export default function ContactPage() {
  return (
    <PublicLayout
      title="İletişim ve Resmi Şirket Bilgileri"
      subtitle="NakliyeGo destek, hukuki tebligat ve KVKK başvuru iletişim kanalları."
      version="1.0.0"
      updatedAt="14 Ekim 2026"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 32 }}>
        <div style={{ background: "#f8faf8", padding: 20, borderRadius: 12, border: "1px solid #e3e8e4" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#667069", letterSpacing: "0.08em", marginBottom: 6 }}>
            Müşteri Desteği & Operasyon
          </div>
          <h3 style={{ fontSize: 17, margin: "0 0 10px", color: "#14261c" }}>Yardım ve Destek Ekibi</h3>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            Taşıma ilanları, şoför eşleşmeleri, teslimat kodu veya ödemelerle ilgili her türlü sorunuz için:
          </p>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#246b45" }}>
            E-posta: <a href="mailto:zeytinavm@gmail.com" style={{ color: "#246b45" }}>zeytinavm@gmail.com</a>
          </div>
          <div style={{ fontSize: 13, color: "#667069", marginTop: 4 }}>
            Telefon: [DOĞRULAMA GEREKLİ: Telefon Numarası]
          </div>
        </div>

        <div style={{ background: "#f8faf8", padding: 20, borderRadius: 12, border: "1px solid #e3e8e4" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#667069", letterSpacing: "0.08em", marginBottom: 6 }}>
            Kişisel Veriler & Gizlilik
          </div>
          <h3 style={{ fontSize: 17, margin: "0 0 10px", color: "#14261c" }}>KVKK & İlgili Kişi Başvuruları</h3>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            6698 sayılı Kanun kapsamındaki hak talepleriniz, veri düzeltme veya silme başvurularınız için:
          </p>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#246b45" }}>
            E-posta: <a href="mailto:zeytinavm@gmail.com" style={{ color: "#246b45" }}>zeytinavm@gmail.com</a>
          </div>
          <div style={{ fontSize: 13, color: "#667069", marginTop: 4 }}>
            KEP: [DOĞRULAMA GEREKLİ: KEP Adresi]
          </div>
        </div>
      </div>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          Resmi Şirket ve Sicil Bilgileri
        </h2>
        <div style={{ display: "grid", gap: 10, background: "#ffffff", padding: 18, borderRadius: 10, border: "1px solid #edf2ee" }}>
          <div><strong>Şirket Ticaret Unvanı:</strong> Feti Akşit Limited Şirketi [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü]</div>
          <div><strong>MERSİS Numarası:</strong> [DOĞRULAMA GEREKLİ: MERSİS Numarası]</div>
          <div><strong>Ticaret Sicil No:</strong> [DOĞRULAMA GEREKLİ: Ticaret Sicil Numarası]</div>
          <div><strong>Vergi Dairesi & VKN:</strong> Hasan Tahsin Vergi Dairesi — 3850507457</div>
          <div><strong>Tebligat Adresi:</strong> 6220 Sokak No: 12/A, Bornova / İzmir</div>
          <div><strong>Aracı Hizmet Sağlayıcı Kaydı:</strong> [DOĞRULAMA GEREKLİ: ETBİS Kayıt Numarası]</div>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          Hızlı Yasal Bağlantılar
        </h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/privacy" style={{ background: "#edf8f0", color: "#225e3e", padding: "8px 14px", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 13, border: "1px solid #cee8d6" }}>Gizlilik Politikası</a>
          <a href="/terms" style={{ background: "#edf8f0", color: "#225e3e", padding: "8px 14px", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 13, border: "1px solid #cee8d6" }}>Kullanım Koşulları</a>
          <a href="/kvkk" style={{ background: "#edf8f0", color: "#225e3e", padding: "8px 14px", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 13, border: "1px solid #cee8d6" }}>KVKK Aydınlatma</a>
          <a href="/account-deletion" style={{ background: "#fff0ee", color: "#8f3029", padding: "8px 14px", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 13, border: "1px solid #f1d1cd" }}>Hesap Silme Talebi</a>
        </div>
      </section>
    </PublicLayout>
  );
}
