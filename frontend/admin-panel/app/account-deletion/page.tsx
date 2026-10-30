"use client";

import React, { useState } from "react";
import PublicLayout from "../components/PublicLayout";
import { LEGAL_DOCS } from "../../../shared/legalTexts.js";

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
      const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_ADMIN_API_URL || "";
      const apiOrigin = rawApiUrl.replace(/\/$/, "").replace(/\/api(?:\/admin)?$/, "");
      const res = await fetch(`${apiOrigin}/api/account-deletion-requests`, {
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
      updatedAt="28 Ekim 2026"
    >
      <p style={{ whiteSpace: "pre-wrap" }}>{LEGAL_DOCS.deletion.content}</p>
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

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, maxWidth: 540, width: "100%", background: "#fbfcfb", padding: "clamp(16px, 4vw, 24px)", borderRadius: 12, border: "1px solid #e5ebe7", boxSizing: "border-box" }}>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
              Kayıtlı E-posta Adresi
            </label>
            <input
              type="email" maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@nakliyego.com"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ccd6cf", fontSize: 15, boxSizing: "border-box", minHeight: 44 }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
              Kayıtlı Cep Telefonu Numarası
            </label>
            <input
              type="tel" maxLength={32}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+90 5xx xxx xx xx"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ccd6cf", fontSize: 15, boxSizing: "border-box", minHeight: 44 }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
              Silme Gerekçesi (İsteğe bağlı)
            </label>
            <textarea
              rows={3} maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Hesabınızı silme nedeninizi belirtebilirsiniz..."
              style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ccd6cf", fontSize: 15, boxSizing: "border-box" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              style={{ marginTop: 3, width: "auto", cursor: "pointer", flexShrink: 0 }}
            />
            <span>
              Hesap kapatma talebini ben gönderiyorum. Kimlik doğrulaması yapılacağını ve yukarıda açıklanan kayıtların inceleme için korunabileceğini anladım.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !confirm}
            style={{
              padding: "14px 20px",
              borderRadius: 8,
              border: 0,
              background: confirm ? "#b73c32" : "#999999",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 15,
              cursor: confirm && !busy ? "pointer" : "not-allowed",
              minHeight: 48,
              width: "100%",
              touchAction: "manipulation",
            }}
          >
            {busy ? "Talep İletiliyor..." : "Hesap Silme Talebini Gönder"}
          </button>
        </form>
      </section>

    </PublicLayout>
  );
}
