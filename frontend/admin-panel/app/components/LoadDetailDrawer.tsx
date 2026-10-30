"use client";

import React, { useState } from "react";
import { StatusBadge, formatDate, formatMoney, getLabel } from "./StatusBadge";

interface LoadDrawerProps {
  data: any;
  note: string;
  setNote: (n: string) => void;
  busy: boolean;
  mutate: (path: string, payload: any, success: string, refreshDetail?: any) => Promise<void>;
}

const pipelineSteps = [
  { id: "published", label: "İlan Yayında" },
  { id: "offers_received", label: "Teklif Alındı" },
  { id: "payment_approval_pending", label: "Ödeme Onayı" },
  { id: "driver_selected", label: "Şoför Seçildi" },
  { id: "driver_en_route", label: "Şoför Yolda" },
  { id: "at_pickup", label: "Yükleme Noktasında" },
  { id: "picked_up", label: "Yük Alındı" },
  { id: "delivered", label: "Teslim Edildi" },
  { id: "completed", label: "Tamamlandı" },
];

const nextLoadStatus: Record<string, string> = {
  driver_selected: "driver_en_route",
  driver_en_route: "at_pickup",
  at_pickup: "picked_up",
  picked_up: "en_route_to_delivery",
  en_route_to_delivery: "delivered",
  delivered: "completed",
};

function getAdminStatusOptions(load: any) {
  if (["completed", "cancelled"].includes(load.status)) return [];
  const options: string[] = [];
  const next = nextLoadStatus[load.status];
  if (next) options.push(next);
  options.push("cancelled");
  return [...new Set(options)];
}

export function LoadDetailDrawer({
  data,
  note,
  setNote,
  busy,
  mutate,
}: LoadDrawerProps) {
  const load = data.load || data;
  const options = getAdminStatusOptions(load);
  const [targetStatus, setTargetStatus] = useState(options[0] || "");
  const selectedStatus = options.includes(targetStatus) ? targetStatus : options[0] || "";

  // Pipeline step index
  const currentStepIdx = pipelineSteps.findIndex(s => s.id === load.status);

  // Price calculations
  const totalAmountTl = load.agreedPriceTl || load.basePriceTl || 0;
  const creditUsedTl = (load.paymentApproval?.creditCents || 0) / 100;
  const cashPayableTl = (load.paymentApproval?.customerPayableCents ?? Math.round(totalAmountTl * 100)) / 100;
  const driverCompensationTl = load.paymentApproval?.compensationTransactionId
    ? load.paymentApproval.creditCents / 100
    : 0;
  const commissionTl = (load.driverCommissionCents || 0) / 100;

  return (
    <div>
      {/* Top Header */}
      <div style={{ background: "#f8faf8", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
              {load.title || "Nakliye İlanı"}
              <StatusBadge value={load.status} />
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              📍 <b>{load.pickup?.city || "—"} ({load.pickup?.district || ""})</b> ➔ <b>{load.delivery?.city || "—"} ({load.delivery?.district || ""})</b>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Toplam Tutar</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)" }}>
              {formatMoney(totalAmountTl)}
            </div>
          </div>
        </div>
      </div>

      {/* Modern Pipeline Stepper */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
          Taşıma İlerleme Süreci
        </div>
        <div className="status-pipeline">
          {pipelineSteps.map((step, idx) => {
            const isCompleted = currentStepIdx > idx;
            const isCurrent = currentStepIdx === idx;
            return (
              <React.Fragment key={step.id}>
                <div
                  className={`pipeline-step ${isCurrent ? "active" : isCompleted ? "completed" : ""}`}
                >
                  {isCompleted ? "✓ " : `${idx + 1}. `}
                  {step.label}
                </div>
                {idx < pipelineSteps.length - 1 && <span className="pipeline-arrow">›</span>}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Transparent Financial & Payment Breakdown Card */}
      <div className="price-breakdown-card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          💰 Finansal Detay ve Şoför Ödeme Dağılımı
        </div>
        <div className="breakdown-row">
          <span>Toplam Nakliye Bedeli</span>
          <b>{formatMoney(totalAmountTl)}</b>
        </div>
        <div className="breakdown-row" style={{ color: "#185abc" }}>
          <span>Kullanılan Kurumsal Kredi</span>
          <b>- {formatMoney(creditUsedTl)}</b>
        </div>
        <div className="breakdown-row" style={{ color: "#8f5809" }}>
          <span>Müşteriden Alınacak Nakit Tutar</span>
          <b>{formatMoney(cashPayableTl)}</b>
        </div>
        <div className="breakdown-row" style={{ color: "#1e5c3a" }}>
          <span>Şoför Cüzdanına Yüklenen Kredi Karşılığı</span>
          <b>+ {formatMoney(driverCompensationTl)}</b>
        </div>
        <div className="breakdown-row">
          <span>Platform Hizmet Komisyonu (%10)</span>
          <span>{formatMoney(commissionTl)}</span>
        </div>
        <div className="breakdown-row total">
          <span>Şoför Ödeme Onay Durumu</span>
          <StatusBadge value={load.paymentApproval ? load.paymentApproval.status : "Gerekmiyor"} />
        </div>
      </div>

      {/* General Load Information */}
      <div style={{ margin: "16px 0" }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>Taşıma ve İletişim Bilgileri</h4>
        <div className="info-grid">
          <div><small>Müşteri</small><b>{data.customer?.name || "—"}</b></div>
          <div><small>Şoför</small><b>{data.driver?.name || "Atanmadı"}</b></div>
          <div><small>Tahmini Mesafe</small><b>{load.estimatedKm || 0} km</b></div>
          <div><small>Yük Tipi / Ağırlık</small><b>{load.loadType || "Genel"} · {load.weightKg ? `${load.weightKg} kg` : "—"}</b></div>
          <div><small>Yükleme Adresi</small><b>{load.pickup?.address || "—"}</b></div>
          <div><small>Teslimat Adresi</small><b>{load.delivery?.address || "—"}</b></div>
        </div>
      </div>

      {/* Delivery Proof Photo / Code */}
      {load.status === "completed" && (
        <div style={{ padding: 14, background: "#e8f5ed", border: "1px solid #c2e2ce", borderRadius: 10, margin: "16px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e5c3a" }}>✅ Teslimat Başarıyla Tamamlandı</div>
          <div style={{ fontSize: 12, color: "#2e7d32", marginTop: 4 }}>
            Teslimat doğrulama kodu ve teslimat görseli sistem tarafından arşivlenmiştir.
          </div>
        </div>
      )}

      {/* Status History Timeline */}
      <div style={{ margin: "16px 0" }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>İşlem ve Durum Geçmişi</h4>
        {(data.statusHistory || []).length > 0 ? (
          <div className="timeline">
            {data.statusHistory.map((evt: any) => (
              <div key={evt.id}>
                <i />
                <span>
                  <b>{getLabel(evt.toStatus)}</b>
                  <small>
                    {formatDate(evt.changedAt || evt.createdAt)} · {getLabel(evt.changedByRole || evt.actorRole)}
                  </small>
                  {evt.note && <p style={{ margin: "4px 0 0", color: "var(--ink)" }}>{evt.note}</p>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>Bu ilan için kaydedilmiş durum geçmişi yok.</p>
        )}
      </div>

      {/* Admin Status Mutation Action */}
      <div className="action-box">
        <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>Yönetici Operasyonel Müdahalesi</h4>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
          Sistem akış bütünlüğü için ilan durumu yalnızca sonraki mantıksal adıma ilerletilebilir veya iptal edilebilir.
          Şoförün ödeme onayı admin tarafından atlanamaz.
        </p>

        {options.length > 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Hedef Durum:
              <select
                value={selectedStatus}
                onChange={e => setTargetStatus(e.target.value)}
                style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 6, border: "1px solid var(--line)" }}
              >
                {options.map(opt => (
                  <option key={opt} value={opt}>{getLabel(opt)}</option>
                ))}
              </select>
            </label>

            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="İşlem ve değişiklik gerekçesi (zorunludur)..."
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, minHeight: 70 }}
            />

            <button
              type="button"
              className={selectedStatus === "cancelled" ? "danger-button" : "primary-button"}
              disabled={busy || !selectedStatus || !note.trim()}
              onClick={() =>
                void mutate(
                  `/loads/${load.id}/status`,
                  { status: selectedStatus, note },
                  "İlan durumu başarıyla güncellendi."
                )
              }
            >
              Durumu Güncelle
            </button>
          </div>
        ) : (
          <div style={{ padding: 12, background: "#fafbfa", borderRadius: 8, fontSize: 13, color: "var(--muted)" }}>
            Bu ilan tamamlanmış veya iptal edilmiştir; yeni bir duruma geçirilemez.
          </div>
        )}
      </div>
    </div>
  );
}
