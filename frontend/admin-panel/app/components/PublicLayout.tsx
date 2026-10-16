import React from "react";

interface PublicLayoutProps {
  title: string;
  subtitle?: string;
  version?: string;
  updatedAt?: string;
  children: React.ReactNode;
}

export default function PublicLayout({
  title,
  subtitle,
  version = "1.0.0",
  updatedAt = "14 Ekim 2026",
  children,
}: PublicLayoutProps) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f8faf8", color: "#17221b", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Top Navigation */}
      <header style={{ background: "#14261c", color: "#eff5f0", borderBottom: "1px solid #243b2e", padding: "16px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#eff5f0" }}>
            <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, background: "#dffa70", color: "#14261c", fontWeight: 800, fontSize: 18 }}>
              N
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>NakliyeGo</div>
              <div style={{ fontSize: 10, color: "#8ea095" }}>Yasal Bilgilendirme Merkezi</div>
            </div>
          </a>
          <nav style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
            <a href="/privacy" style={{ color: "#d2ded6", textDecoration: "none", fontWeight: 500 }}>Gizlilik</a>
            <a href="/terms" style={{ color: "#d2ded6", textDecoration: "none", fontWeight: 500 }}>Kullanım Koşulları</a>
            <a href="/kvkk" style={{ color: "#d2ded6", textDecoration: "none", fontWeight: 500 }}>KVKK</a>
            <a href="/account-deletion" style={{ color: "#dffa70", textDecoration: "none", fontWeight: 600 }}>Hesap Silme</a>
            <a href="/contact" style={{ color: "#d2ded6", textDecoration: "none", fontWeight: 500 }}>İletişim</a>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: 960, width: "100%", margin: "32px auto", padding: "0 24px", flex: 1 }}>
        <div style={{ background: "#ffffff", borderRadius: 16, border: "1px solid #e3e8e4", padding: "36px 40px", boxShadow: "0 10px 30px rgba(20,38,28,0.04)" }}>
          <div style={{ borderBottom: "1px solid #edf2ee", paddingBottom: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, background: "#edf8f0", color: "#225e3e", padding: "3px 10px", borderRadius: 20, fontWeight: 700, border: "1px solid #cee8d6" }}>
                Sürüm {version}
              </span>
              <span style={{ fontSize: 12, color: "#667069" }}>
                Yürürlük / Son Güncelleme: {updatedAt}
              </span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#14261c", margin: "4px 0 8px", letterSpacing: "-0.03em" }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ margin: 0, fontSize: 15, color: "#667069", lineHeight: 1.5 }}>
                {subtitle}
              </p>
            )}
          </div>

          <div className="legal-article" style={{ fontSize: 14.5, lineHeight: 1.7, color: "#2d3732" }}>
            {children}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ background: "#ffffff", borderTop: "1px solid #e3e8e4", padding: "28px 24px", marginTop: "auto", fontSize: 12, color: "#667069" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: "#17221b" }}>Feti Akşit Limited Şirketi [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü]</div>
            <div>Aracı Hizmet Sağlayıcı · 6698 Sayılı KVKK Uyumlu Bilgilendirme</div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <a href="/privacy" style={{ color: "#246b45", textDecoration: "none" }}>Gizlilik Politikası</a>
            <a href="/terms" style={{ color: "#246b45", textDecoration: "none" }}>Kullanım Koşulları</a>
            <a href="/kvkk" style={{ color: "#246b45", textDecoration: "none" }}>KVKK Metni</a>
            <a href="/account-deletion" style={{ color: "#246b45", textDecoration: "none" }}>Hesap Silme</a>
            <a href="/contact" style={{ color: "#246b45", textDecoration: "none" }}>İletişim</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
