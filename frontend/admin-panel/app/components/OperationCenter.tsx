"use client";

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
        <div className="op-stat-number" style={{ fontSize: 20, marginTop: 16 }}>Yönetim →</div>
        <div className="op-stat-desc">Şoför & Kurumsal cüzdan kontrolleri</div>
      </button>

      <button
        type="button"
        className={`op-stat-card ${typeof accountDeletions === "number" && accountDeletions > 0 ? "alert-card" : ""}`}
        onClick={() => onFilterClick("account-deletions", "pending")}
      >
        <div className="op-stat-header">
          <span className="op-stat-title">Hesap Silme Talebi</span>
          <span className="op-stat-icon" style={{ background: "#fdf0ee", color: "#a42c22" }}>🗑️</span>
        </div>
        <div className="op-stat-number">{typeof accountDeletions === "number" ? accountDeletions : "—"}</div>
        <div className="op-stat-desc">
          {typeof accountDeletions === "number"
            ? (accountDeletions > 0 ? "KVKK/GDPR incelemesi bekliyor" : "Bekleyen talep yok")
            : "Talepleri incele"}
        </div>
      </button>
    </div>
  );
}

interface ActionQueueItem {
  id: string;
  kind: "driver" | "corporate-application" | "complaint" | "account-deletion";
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  avatarChar: string;
}

interface ActionQueueProps {
  items: ActionQueueItem[];
  queueError?: string;
  onRetry?: () => void;
  onOpenItem: (kind: string, id: string) => void;
}

export function ActionQueue({ items, queueError, onRetry, onOpenItem }: ActionQueueProps) {
  return (
    <div className="action-queue-section">
      <div className="action-queue-header">
        <div>
          <h2>⚡ İşlem Bekleyenler (Öncelikli Kuyruk)</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Sistemin aksamaması için bugün onaylanması veya çözülmesi gereken kritik işlemler
          </p>
        </div>
        <span className="badge-pill badge-green">Öncelikli Kuyruk</span>
      </div>

      {queueError ? (
        <div style={{ padding: "24px 20px", textAlign: "center", background: "#fdf0ee", border: "1px solid #f7c5c0", borderRadius: 12 }}>
          <div style={{ fontSize: 24, marginBottom: 6 }}>⚠️</div>
          <b style={{ color: "var(--red)" }}>Bazı işlem kuyrukları yüklenirken hata oluştu:</b>
          <p style={{ margin: "4px 0 12px", fontSize: 13, color: "#8a1f18" }}>{queueError}</p>
          {onRetry && (
            <button type="button" className="outline-button" onClick={onRetry}>
              Yeniden Dene
            </button>
          )}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <b>Harika! Bekleyen acil işlem bulunmuyor.</b>
          <p style={{ margin: "4px 0 0", fontSize: 13 }}>
            Tüm şoför onayları, kurumsal başvurular ve şikâyetler güncel durumda.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(item => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              className="action-item-card"
              onClick={() => onOpenItem(item.kind, item.id)}
            >
              <div className="action-item-left">
                <div className="action-item-avatar">
                  {item.avatarChar}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {item.subtitle}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`badge-pill ${item.badgeColor}`}>{item.badge}</span>
                <span style={{ color: "var(--green)", fontWeight: 600, fontSize: 13 }}>İncele →</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
