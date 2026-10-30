"use client";

import React from "react";
import { formatMoney } from "./StatusBadge";

interface FilterBarProps {
  tab: string;
  query: string;
  setQuery: (q: string) => void;
  filter: string;
  setFilter: (f: string) => void;
  onSearch: () => void;
  counts?: Record<string, number>;
}

export function FilterBar({
  tab,
  query,
  setQuery,
  filter,
  setFilter,
  onSearch,
  counts = {},
}: FilterBarProps) {
  // Pill configurations per tab
  let pills: { id: string; label: string; count?: number }[] = [];

  if (tab === "corporate-applications") {
    pills = [
      { id: "pending", label: "Onay Bekleyenler", count: counts.pendingCorporate },
      { id: "approved", label: "Onaylananlar" },
      { id: "rejected", label: "Reddedilenler" },
      { id: "", label: "Tümü" },
    ];
  } else if (tab === "drivers") {
    pills = [
      { id: "pending", label: "Onay Bekleyenler", count: counts.pendingDrivers },
      { id: "verified", label: "Doğrulanmış" },
      { id: "rejected", label: "Reddedilenler" },
      { id: "", label: "Tümü" },
    ];
  } else if (tab === "loads") {
    pills = [
      { id: "", label: "Tüm Nakliyeler" },
      { id: "published", label: "Yayında" },
      { id: "payment_approval_pending", label: "Ödeme Onayı Bekleyen" },
      { id: "driver_selected", label: "Şoför Seçildi" },
      { id: "picked_up", label: "Taşımada" },
      { id: "delivered", label: "Teslim Edildi" },
      { id: "completed", label: "Tamamlandı" },
      { id: "cancelled", label: "İptal" },
    ];
  } else if (tab === "complaints") {
    pills = [
      { id: "open", label: "Açık Şikâyetler", count: counts.openComplaints },
      { id: "reviewing", label: "İnceleniyor" },
      { id: "resolved", label: "Çözüldü" },
      { id: "rejected", label: "Reddedildi" },
      { id: "", label: "Tümü" },
    ];
  } else if (tab === "driver-wallets") {
    pills = [
      { id: "", label: "Tüm Hesaplar" },
      { id: "funded", label: "Bakiyesi Olan" },
      { id: "reserved", label: "Blokesi Olan" },
      { id: "empty", label: "Sıfır Bakiye" },
    ];
  } else if (tab === "users") {
    pills = [
      { id: "", label: "Tüm Kullanıcılar" },
      { id: "active", label: "Aktif" },
      { id: "blocked", label: "Engelli" },
    ];
  } else if (tab === "account-deletions") {
    pills = [
      { id: "pending", label: "Onay Bekleyen Talepler", count: counts.pendingAccountDeletions },
      { id: "completed", label: "Silinen / Tamamlanan" },
      { id: "rejected", label: "Reddedilen" },
      { id: "", label: "Tümü" },
    ];
  }

  const getPlaceholder = () => {
    switch (tab) {
      case "corporate-applications":
        return "Firma adı, yetkili kişi, vergi numarası, telefon veya e-posta...";
      case "drivers":
        return "Şoför adı, telefon, plaka veya e-posta...";
      case "loads":
        return "İlan başlığı, yükleme şehri, teslim şehri veya ID...";
      case "users":
        return "Kullanıcı adı, telefon, e-posta veya ID...";
      case "driver-wallets":
        return "Şoför adı, telefon, IBAN veya ID...";
      case "account-deletions":
        return "E-posta veya telefon ile ara...";
      default:
        return "Kayıtlarda hızlı ara...";
    }
  };

  return (
    <div style={{ background: "var(--white)", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px", marginBottom: 18 }}>
      <form
        onSubmit={e => {
          e.preventDefault();
          onSearch();
        }}
        style={{ display: "flex", gap: 10, alignItems: "center" }}
      >
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 16 }}>
            🔍
          </span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={getPlaceholder()}
            style={{
              width: "100%",
              padding: "10px 14px 10px 42px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              fontSize: 14,
              outline: "none",
              background: "#fafbfa",
            }}
          />
        </div>
        <button type="submit" className="primary-button" style={{ height: 42, padding: "0 20px", fontSize: 14 }}>
          Ara
        </button>
      </form>

      {pills.length > 0 && (
        <div className="filter-pills">
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginRight: 4, textTransform: "uppercase" }}>
            Filtre:
          </span>
          {pills.map(p => {
            const isActive = filter === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`filter-pill ${isActive ? "active" : ""}`}
                onClick={() => {
                  setFilter(p.id);
                }}
              >
                <span>{p.label}</span>
                {typeof p.count === "number" && p.count > 0 && (
                  <span className="pill-count">{p.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
