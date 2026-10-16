"use client";

import React, { useState } from "react";
import PublicLayout from "../components/PublicLayout";

export default function AccountDeletionPage() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm || (!email && !phone)) {
      setResult({
        success: false,
        message: "Lütfen onay kutusunu işaretleyin ve kayıtlı e-posta veya telefon bilginizi girin.",
      });
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_ADMIN_API_URL || "http://localhost:8080";
      const res = await fetch(`${apiUrl}/api/account-deletion-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, reason, confirm }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Talep iletilemedi.");
      }

      setResult({
        success: true,
        message: data.message || "Hesap silme talebiniz başarıyla alındı. Kayıtlı iletişim bilginiz üzerinden güvenlik doğrulaması yapılacaktır.",
      });
      setEmail("");
      setPhone("");
      setReason("");
      setConfirm(false);
    } catch (err: any) {
      setResult({
        success: false,
        message: err.message || "Sunucuya bağlanırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout
      title="Hesap ve Kişisel Veri Silme Talebi"
      subtitle="Google Play ve App Store gereksinimleri uyarınca hesap kapatma ve kişisel verilerin silinmesi prosedürü."
      version="1.0.0"
      updatedAt="14 Ekim 2026"
    >
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          1. Mobil Uygulama Üzerinden Doğrudan Silme (Önerilen)
        </h2>
        <p>
          Hesabınızı ve kişisel verilerinizi anında silmek için NakliyeGo Müşteri veya Şoför uygulamanızda:
        </p>
        <div style={{ background: "#f0f6f2", padding: "14px 18px", borderRadius: 10, border: "1px solid #d2e4d8", margin: "12px 0", fontWeight: 600 }}>
          Profil &gt; Hesap İşlemleri &gt; Hesabımı Sil
        </div>
        <p style={{ fontSize: 13.5, color: "#55645c" }}>
          Mevcut hesap şifrenizi doğruladıktan sonra, devam eden aktif bir nakliyeniz bulunmuyorsa hesabınız hemen kapatılır ve kişisel verileriniz anonimleştirilir.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          2. Web Üzerinden Hesap Silme Talep Formu
        </h2>
        <p>
          Uygulamaya erişiminiz yoksa veya hesabınızı web üzerinden silmek istiyorsanız aşağıdaki formu doldurarak resmi hesap silme talebi oluşturabilirsiniz:
        </p>

        {result && (
          <div style={{
            padding: "14px 18px",
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 14,
            fontWeight: 600,
            background: result.success ? "#edf8f0" : "#fff0ee",
            color: result.success ? "#225e3e" : "#8f3029",
            border: `1px solid ${result.success ? "#cee8d6" : "#f1d1cd"}`,
          }}>
            {result.message}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, maxWidth: 540, background: "#fbfcfb", padding: 22, borderRadius: 12, border: "1px solid #e5ebe7" }}>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
              Kayıtlı E-posta Adresi
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@nakliyego.com"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #ccd6cf", fontSize: 14 }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
              Kayıtlı Cep Telefonu Numarası
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+90 5xx xxx xx xx"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #ccd6cf", fontSize: 14 }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
              Silme Gerekçesi (İsteğe bağlı)
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Hesabınızı silme nedeninizi belirtebilirsiniz..."
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #ccd6cf", fontSize: 14 }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              Hesabımın silinmesi halinde tüm aktif oturumlarımın sonlandırılacağını, geri döndürülemez biçimde anonimleştirileceğimi ve yasal saklama yükümlülüğü haricindeki verilerimin silineceğini anladım ve kabul ediyorum.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !confirm}
            style={{
              padding: "12px 20px",
              borderRadius: 8,
              border: 0,
              background: confirm ? "#b73c32" : "#999999",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 14,
              cursor: confirm && !busy ? "pointer" : "not-allowed",
            }}
          >
            {busy ? "Talep İletiliyor..." : "Hesap Silme Talebini Gönder"}
          </button>
        </form>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          3. Silme Sonrası Veri Durumu ve Yasal İstisnalar
        </h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Profil ve Kimlik Bilgileri:</strong> Ad, soyad, açık telefon ve e-posta kayıtları sistemden silinir / maskelenir ("Silinmiş Kullanıcı").</li>
          <li><strong>Oturumlar ve Bildirimler:</strong> Tüm aktif oturumlar ve push tokenlar derhal geçersiz kılınır.</li>
          <li><strong>Yasal Saklama:</strong> 5651 sayılı kanun kapsamındaki erişim logları (2 yıl), 213 sayılı VUK ve 6102 sayılı TTK kapsamındaki mali fatura/işlem kayıtları (10 yıl) boyunca izole arşivde tutulur ve süresi sonunda imha edilir.</li>
        </ul>
      </section>
    </PublicLayout>
  );
}
