"use client";

import { useState, FormEvent } from "react";
import { StatusBadge, formatDate, getInitials, getLabel } from "./StatusBadge";
import DriverWalletAdmin from "../DriverWalletAdmin";

interface DriverDrawerProps {
  data: any;
  note: string;
  setNote: (n: string) => void;
  busy: boolean;
  mutate: (path: string, payload: any, success: string, refreshDetail?: any) => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<any>;
  refresh: () => void;
}

type DriverTab = "general" | "documents" | "vehicles" | "wallet" | "actions";

export function DriverDetailDrawer({
  data,
  note,
  setNote,
  busy,
  mutate,
  request,
  refresh,
}: DriverDrawerProps) {
  const [activeTab, setActiveTab] = useState<DriverTab>("general");
  const [docForm, setDocForm] = useState({ kind: "driver_license", title: "", fileURL: "" });
  const user = data.user || data;
  const profile = user.driverProfile || {};
  const isBlocked = user.accountStatus === "blocked";
  const isVerified = user.verificationStatus === "verified";

  async function handleAddDoc(e: FormEvent) {
    e.preventDefault();
    try {
      await request(`/drivers/${user.id}/documents`, {
        method: "POST",
        body: JSON.stringify(docForm),
      });
      setDocForm({ kind: "driver_license", title: "", fileURL: "" });
      refresh();
    } catch {
      // Handled by parent notification
    }
  }

  const API_BASE = (process.env.NEXT_PUBLIC_ADMIN_API_URL || "http://localhost:8080/api/admin").replace(/\/$/, "");

  return (
    <div>
      {/* Top Header Card */}
      <div style={{ background: "#f8faf8", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}>
              {getInitials(user.name)}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                {user.name}
                <StatusBadge value={user.verificationStatus} />
                {isBlocked && <span className="badge-pill badge-red">Engellenmiş</span>}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                📞 {user.phone || "Telefon yok"} · ✉️ {user.email || "E-posta yok"}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Son Görülme</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(user.lastSeenAt)}</div>
          </div>
        </div>
      </div>

      {/* Modern Tabs */}
      <div className="drawer-tabs" style={{ margin: "0 -24px 20px -24px" }}>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          👤 Genel Bilgiler
        </button>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "documents" ? "active" : ""}`}
          onClick={() => setActiveTab("documents")}
        >
          📄 Belgeler ({(data.documents || []).length})
        </button>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "vehicles" ? "active" : ""}`}
          onClick={() => setActiveTab("vehicles")}
        >
          🚛 Araçlar ({(data.vehicles || []).length})
        </button>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "wallet" ? "active" : ""}`}
          onClick={() => setActiveTab("wallet")}
        >
          💳 Cüzdan & Bakiye
        </button>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "actions" ? "active" : ""}`}
          onClick={() => setActiveTab("actions")}
        >
          ⚙️ Hesap İşlemleri
        </button>
      </div>

      {/* Tab: General */}
      {activeTab === "general" && (
        <div>
          <div className="info-grid">
            <div><small>Doğrulama Durumu</small><b>{getLabel(user.verificationStatus)}</b></div>
            <div><small>Hesap Durumu</small><b>{getLabel(user.accountStatus)}</b></div>
            <div><small>Kayıt Tarihi</small><b>{formatDate(user.createdAt)}</b></div>
            <div><small>Hizmet Bölgesi</small><b>{profile.serviceArea || "Belirtilmedi"}</b></div>
            <div><small>Tamamlanan Taşıma</small><b>{profile.completedJobs || 0} adet</b></div>
            <div><small>Şoför Puanı</small><b>{profile.rating ? `⭐ ${profile.rating}` : "Henüz puan yok"}</b></div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>Hızlı Doğrulama Onayı</h4>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
              Şoförün belgeleri incelendiyse sisteme kabul edebilir veya gerekçe belirterek reddedebilirsiniz.
            </p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Onay notu veya ret gerekçesi (Ret durumunda zorunludur)..."
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, minHeight: 70 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="primary-button"
                disabled={busy || isVerified}
                onClick={() =>
                  void mutate(
                    `/drivers/${user.id}/verification`,
                    { status: "verified", note },
                    "Şoför başarıyla doğrulandı.",
                    ["driver", user.id]
                  )
                }
              >
                ✓ Şoförü Doğrula ve Onayla
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy || !note.trim()}
                onClick={() =>
                  void mutate(
                    `/drivers/${user.id}/verification`,
                    { status: "rejected", note },
                    "Şoför doğrulaması reddedildi.",
                    ["driver", user.id]
                  )
                }
              >
                ✕ Doğrulamayı Reddet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Documents */}
      {activeTab === "documents" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Yüklenen Belgeler</h4>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Her belge tek tıkla incelenebilir</span>
          </div>

          {(data.documents || []).length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", background: "#f8faf8", borderRadius: 10, border: "1px dashed var(--line)" }}>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Henüz yüklenmiş belge bulunmuyor.</p>
            </div>
          ) : (
            <div className="document-grid">
              {(data.documents || []).map((doc: any) => {
                const fileHref = doc.fileUrl?.startsWith("/")
                  ? `${API_BASE.replace("/api/admin", "")}${doc.fileUrl}`
                  : doc.fileUrl;
                return (
                  <div key={doc.id} className="doc-review-card">
                    <div className="doc-review-top">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.title || getLabel(doc.kind)}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {getLabel(doc.kind)}
                        </div>
                      </div>
                      <StatusBadge value={doc.status} />
                    </div>

                    {doc.status === "rejected" && doc.reviewNote && (
                      <div style={{ fontSize: 12, color: "var(--red)", background: "#fdf0ee", padding: 6, borderRadius: 6 }}>
                        Ret gerekçesi: {doc.reviewNote}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                      <a
                        href={fileHref}
                        target="_blank"
                        rel="noreferrer"
                        className="filter-pill"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                      >
                        👁️ Belgeyi Aç
                      </a>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="table-action"
                          style={{ color: "var(--green)" }}
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/driver-documents/${doc.id}`,
                              { status: "verified", note },
                              "Belge doğrulandı.",
                              ["driver", user.id]
                            )
                          }
                        >
                          Onayla
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          style={{ color: "var(--red)" }}
                          disabled={busy || !note.trim()}
                          title={!note.trim() ? "Ret için genel not alanına gerekçe yazın" : ""}
                          onClick={() =>
                            void mutate(
                              `/driver-documents/${doc.id}`,
                              { status: "rejected", note },
                              "Belge reddedildi.",
                              ["driver", user.id]
                            )
                          }
                        >
                          Reddet
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Document manually */}
          <div style={{ marginTop: 24, padding: 16, background: "#fafbfa", borderRadius: 12, border: "1px solid var(--line)" }}>
            <h5 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Manuel Belge Ekle</h5>
            <form onSubmit={handleAddDoc} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <select
                  value={docForm.kind}
                  onChange={e => setDocForm({ ...docForm, kind: e.target.value })}
                  style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
                >
                  {["identity", "driver_license", "vehicle_registration", "src", "psychotechnic", "insurance", "criminal_record", "other"].map(k => (
                    <option key={k} value={k}>{getLabel(k)}</option>
                  ))}
                </select>
                <input
                  required
                  placeholder="Belge Başlığı"
                  value={docForm.title}
                  onChange={e => setDocForm({ ...docForm, title: e.target.value })}
                  style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
                />
              </div>
              <input
                required
                type="url"
                placeholder="Belge dosya linki (https://... veya /api/...)"
                value={docForm.fileURL}
                onChange={e => setDocForm({ ...docForm, fileURL: e.target.value })}
                style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
              />
              <button type="submit" className="outline-button" style={{ alignSelf: "flex-start" }}>
                + Belgeyi Sisteme Ekle
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Vehicles */}
      {activeTab === "vehicles" && (
        <div>
          <h4 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Kayıtlı Araçlar</h4>
          {(data.vehicles || []).length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", background: "#f8faf8", borderRadius: 10, border: "1px dashed var(--line)" }}>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Kayıtlı araç bulunmuyor.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {(data.vehicles || []).map((vehicle: any) => (
                <div key={vehicle.id} className="review-card" style={{ padding: 16 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{vehicle.brand} {vehicle.model}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                      Plaka: <b>{vehicle.licensePlate}</b> · Kapasite: <b>{vehicle.capacityKg} kg</b>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <StatusBadge value={vehicle.verificationStatus} />
                    <button
                      type="button"
                      className="primary-button"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          `/vehicles/${vehicle.id}/verification`,
                          { status: "verified", note },
                          "Araç onaylandı.",
                          ["driver", user.id]
                        )
                      }
                    >
                      Onayla
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      disabled={busy || !note.trim()}
                      onClick={() =>
                        void mutate(
                          `/vehicles/${vehicle.id}/verification`,
                          { status: "rejected", note },
                          "Araç reddedildi.",
                          ["driver", user.id]
                        )
                      }
                    >
                      Reddet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Wallet */}
      {activeTab === "wallet" && (
        <div>
          <DriverWalletAdmin driverId={user.id} request={request} />
        </div>
      )}

      {/* Tab: Actions */}
      {activeTab === "actions" && (
        <div className="action-box">
          <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>
            {isBlocked ? "Şoför Hesabını Yeniden Aktifleştir" : "Şoför Hesabını Engelle"}
          </h4>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
            {isBlocked
              ? "Şoför yeniden uygulamaya giriş yapabilir, ilanları görebilir ve teklif verebilir."
              : "Şoför anında sistemden düşürülür, yeni iş alamaz ve oturumu sonlandırılır."}
          </p>
          {!isBlocked && (
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Hesap engelleme gerekçesi (zorunlu)..."
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, minHeight: 70, marginBottom: 10 }}
            />
          )}
          <button
            type="button"
            className={isBlocked ? "primary-button" : "danger-button"}
            disabled={busy || (!isBlocked && !note.trim())}
            onClick={() =>
              void mutate(
                `/users/${user.id}/status`,
                { status: isBlocked ? "active" : "blocked", reason: note },
                isBlocked ? "Şoför hesabı aktifleştirildi." : "Şoför hesabı engellendi.",
                ["driver", user.id]
              )
            }
          >
            {isBlocked ? "✓ Hesabı Yeniden Aktifleştir" : "✕ Şoförü Engelle"}
          </button>
        </div>
      )}
    </div>
  );
}
