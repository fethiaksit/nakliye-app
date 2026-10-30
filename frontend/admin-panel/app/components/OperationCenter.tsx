"use client";

import React from "react";
import { formatMoney } from "./StatusBadge";

interface OperationMetricsProps {
  counts: Record<string, number>;
  onFilterClick: (tab: string, filter?: string) => void;
}

export function OperationMetrics({ counts, onFilterClick }: OperationMetricsProps) {
  const pendingDrivers = counts.pendingDrivers || 0;
  const pendingCorporate = counts.pendingCorporate || 0;
  const activeLoads = counts.activeLoads || 0;
  const openComplaints = counts.openComplaints || 0;
  const accountDeletions = counts.pendingAccountDeletions || 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
      <button
        type="button"
        className={`op-stat-card ${pendingDrivers > 0 ? "alert-card" : ""}`}
        onClick={() => onFilterClick("drivers", "pending")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Onay Bekleyen Şoför</span>
          <span className="op-stat-icon" style={{ background: "#fef7ea", color: "#8f5809" }}>🪪</span>
        </div>
        <div className="op-stat-number">{pendingDrivers}</div>
        <div className="op-stat-desc">
          {pendingDrivers > 0 ? "İnceleme ve belge onayı bekliyor" : "Tüm şoförler güncel"}
        </div>
      </button>

      <button
        type="button"
        className={`op-stat-card ${pendingCorporate > 0 ? "alert-card" : ""}`}
        onClick={() => onFilterClick("corporate-applications", "pending")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Onay Bekleyen Firma</span>
          <span className="op-stat-icon" style={{ background: "#e8f5ed", color: "#1e5c3a" }}>🏢</span>
        </div>
        <div className="op-stat-number">{pendingCorporate}</div>
        <div className="op-stat-desc">
          {pendingCorporate > 0 ? "Kurumsal hesap başvurusu var" : "Bekleyen başvuru yok"}
        </div>
      </button>

      <button
        type="button"
        className="op-stat-card"
        onClick={() => onFilterClick("loads", "")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Aktif Nakliye</span>
          <span className="op-stat-icon" style={{ background: "#edf4fe", color: "#185abc" }}>🚚</span>
        </div>
        <div className="op-stat-number">{activeLoads}</div>
        <div className="op-stat-desc">Devam eden operasyonel taşıma</div>
      </button>

      <button
        type="button"
        className={`op-stat-card ${openComplaints > 0 ? "alert-card" : ""}`}
        onClick={() => onFilterClick("complaints", "open")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Açık Şikâyet</span>
          <span className="op-stat-icon" style={{ background: "#fdf0ee", color: "#a42c22" }}>⚠️</span>
        </div>
        <div className="op-stat-number">{openComplaints}</div>
        <div className="op-stat-desc">
          {openComplaints > 0 ? "Müdahale ve inceleme gerekli" : "Açık şikâyet kaydı yok"}
        </div>
      </button>

      <button
        type="button"
        className="op-stat-card"
        onClick={() => onFilterClick("driver-wallets", "")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Finansal İşlemler</span>
          <span className="op-stat-icon" style={{ background: "#f0f2f1", color: "#4b5550" }}>💳</span>
        </div>
        <div className="op-stat-number">{counts.drivers || 0}</div>
        <div className="op-stat-desc">Şoför & Kurumsal cüzdan kontrolleri</div>
      </button>

      <button
        type="button"
        className={`op-stat-card ${accountDeletions > 0 ? "alert-card" : ""}`}
        onClick={() => onFilterClick("account-deletions", "pending")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Hesap Silme Talebi</span>
          <span className="op-stat-icon" style={{ background: "#fdf0ee", color: "#a42c22" }}>🗑️</span>
        </div>
        <div className="op-stat-number">{accountDeletions}</div>
        <div className="op-stat-desc">
          {accountDeletions > 0 ? "KVKK/GDPR incelemesi bekliyor" : "Bekleyen talep yok"}
        </div>
      </button>
    </div>
  );
}

interface ActionQueueProps {
  verificationQueue: any[];
  onOpenDriver: (id: string) => void;
  onOpenCorporate?: (id: string) => void;
}

export function ActionQueue({ verificationQueue, onOpenDriver }: ActionQueueProps) {
  return (
    <div className="action-queue-section">
      <div className="action-queue-header">
        <div>
          <h2>⚡ İşlem Bekleyenler (Öncelikli Kuyruk)</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Sistemin aksamaması için bugün onaylanması veya çözülmesi gereken kritik işlemler
          </p>
        </div>
        <span className="badge-pill badge-green">Canlı Akış</span>
      </div>

      {verificationQueue.length === 0 ? (
        <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <b>Harika! Bekleyen acil işlem bulunmuyor.</b>
          <p style={{ margin: "4px 0 0", fontSize: 13 }}>
            Tüm şoför onayları ve sistem kuyrukları güncel durumda.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {verificationQueue.map((item: any) => (
            <button
              key={item.id}
              type="button"
              className="action-item-card"
              onClick={() => onOpenDriver(item.id)}
            >
              <div className="action-item-left">
                <div className="action-item-avatar">
                  {(item.name || "Ş")[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {item.phone || item.email} · Şoför Başvurusu
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge-pill badge-amber">Doğrulama Bekliyor</span>
                <span style={{ color: "var(--green)", fontWeight: 600, fontSize: 13 }}>İncele →</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
