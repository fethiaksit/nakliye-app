"use client";

import React, { useState } from "react";
import { StatusBadge, formatDate, formatMoney, getInitials, getLabel } from "./StatusBadge";
import { WalletCustomer } from "../CorporateWalletAdmin";

interface CorporateDrawerProps {
  data: any;
  note: string;
  setNote: (n: string) => void;
  busy: boolean;
  mutate: (path: string, payload: any, success: string, refreshDetail?: any) => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<any>;
}

type CorporateTab = "company" | "documents" | "wallet" | "approval";

export function CorporateDetailDrawer({
  data,
  note,
  setNote,
  busy,
  mutate,
  request,
}: CorporateDrawerProps) {
  const [activeTab, setActiveTab] = useState<CorporateTab>("company");

  const corporateId = data.id || data.corporateId || data.corporate_id;
  const companyName = data.companyName || data.company_name || data.company?.name || data.name || "—";
  const authorizedPerson = data.authorizedPerson || data.authorized_person || data.company?.authorizedPerson || data.name || "—";
  const phone = data.phone || data.company?.phone || "—";
  const email = data.email || data.company?.email || "—";
  const taxNumber = data.taxNumber || data.tax_number || data.company?.taxNumber || "Belirtilmedi";
  const taxOffice = data.taxOffice || data.tax_office || data.company?.taxOffice || "Belirtilmedi";
  const address = data.address || data.companyAddress || data.company_address || data.company?.address || "Firma adresi girilmedi.";
  const corporateStatus = data.status || data.corporateStatus || "pending";
  const isApproved = corporateStatus === "approved";
  const isRejected = corporateStatus === "rejected";

  const API_BASE = (process.env.NEXT_PUBLIC_ADMIN_API_URL || "http://localhost:8080/api/admin").replace(/\/$/, "");

  return (
    <div>
      {/* Top Header Card */}
      <div style={{ background: "#f8faf8", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}>
              {getInitials(companyName)}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                {companyName}
                <StatusBadge value={corporateStatus} />
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                👤 {authorizedPerson} · 📞 {phone} · ✉️ {email}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Vergi Numarası</div>
            <code style={{ fontSize: 13, fontWeight: 700, background: "#edf2ee", padding: "2px 8px", borderRadius: 4 }}>
              {taxNumber}
            </code>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="drawer-tabs" style={{ margin: "0 -24px 20px -24px" }}>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "company" ? "active" : ""}`}
          onClick={() => setActiveTab("company")}
        >
          🏢 Firma Bilgileri
        </button>
        <button
          type="button"
          className={`drawer-tab ${activeTab === "documents" ? "active" : ""}`}
          onClick={() => setActiveTab("documents")}
        >
          📄 Belgeler ({(data.documents || []).length})
        </button>
        {isApproved && (
          <button
            type="button"
            className={`drawer-tab ${activeTab === "wallet" ? "active" : ""}`}
            onClick={() => setActiveTab("wallet")}
          >
            💰 Cüzdan & Kazanım Ayarları
          </button>
        )}
        <button
          type="button"
          className={`drawer-tab ${activeTab === "approval" ? "active" : ""}`}
          onClick={() => setActiveTab("approval")}
        >
          ✍️ Başvuru Onay / Ret
        </button>
      </div>

      {/* Tab: Company Info */}
      {activeTab === "company" && (
        <div>
          <div className="info-grid">
            <div><small>Firma adı</small><b>{companyName}</b></div>
            <div><small>Yetkili kişi</small><b>{authorizedPerson}</b></div>
            <div><small>Vergi numarası</small><b>{taxNumber}</b></div>
            <div><small>Vergi dairesi</small><b>{taxOffice}</b></div>
            <div><small>Telefon</small><b>{phone}</b></div>
            <div><small>E-posta</small><b>{email}</b></div>
            <div><small>Başvuru tarihi</small><b>{formatDate(data.createdAt || data.created_at)}</b></div>
            <div><small>Onay durumu</small><b>{getLabel(corporateStatus)}</b></div>
          </div>

          <div style={{ marginTop: 16, padding: 14, background: "#fafbfa", borderRadius: 10, border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Firma Adresi</div>
            <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink)" }}>{address}</div>
          </div>

          {(data.rejectionReason || data.rejection_reason || data.corporateRejectionReason) && (
            <div style={{ marginTop: 16, padding: 14, background: "#fdf0ee", border: "1px solid #f7c5c0", borderRadius: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>Ret Gerekçesi</div>
              <div style={{ fontSize: 13, marginTop: 4, color: "#8a1f18" }}>
                {data.rejectionReason || data.rejection_reason || data.corporateRejectionReason}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Documents */}
      {activeTab === "documents" && (
        <div>
          <h4 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Kurumsal Evraklar</h4>
          {(data.documents || []).length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", background: "#f8faf8", borderRadius: 10, border: "1px dashed var(--line)" }}>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Henüz yüklenmiş kurumsal başvuru belgesi bulunmuyor.</p>
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

                    <div style={{ paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                      <a
                        href={fileHref}
                        target="_blank"
                        rel="noreferrer"
                        className="filter-pill"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                      >
                        👁️ Belgeyi Aç ve İncele
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Wallet */}
      {activeTab === "wallet" && isApproved && (
        <div>
          <WalletCustomer customerId={corporateId} request={request} />
        </div>
      )}

      {/* Tab: Approval */}
      {activeTab === "approval" && (
        <div className="action-box">
          <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>Başvuru Değerlendirme</h4>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
            Firma bilgilerini ve vergi dairesi kayıtlarını teyit ettiyseniz onaylayabilirsiniz.
            Reddedilen firmalar için açıklama (ret sebebi) belirtilmesi zorunludur.
          </p>

          <label style={{ display: "block", marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
            Yönetici Değerlendirme Notu / Ret Sebebi (rejectionReason):
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Başvuru onay veya ret notunuzu buraya yazın..."
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, minHeight: 80, marginBottom: 12 }}
          />

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="primary-button"
              disabled={busy || isApproved}
              onClick={() =>
                void mutate(
                  `/corporate-accounts/${corporateId}/status`,
                  { status: "approved" },
                  "Kurumsal başvuru onaylandı.",
                  ["corporate-application", corporateId]
                )
              }
            >
              ONAYLA
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy || !note.trim()}
              title={!note.trim() ? "Ret işlemi için gerekçe girmelisiniz" : ""}
              onClick={() =>
                void mutate(
                  `/corporate-accounts/${corporateId}/status`,
                  { status: "rejected", rejectionReason: note.trim() },
                  "Kurumsal başvuru reddedildi.",
                  ["corporate-application", corporateId]
                )
              }
            >
              REDDET
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
