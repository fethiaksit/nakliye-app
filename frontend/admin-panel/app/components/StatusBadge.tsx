"use client";

export type StatusType =
  | "pending"
  | "verified"
  | "approved"
  | "rejected"
  | "active"
  | "blocked"
  | "draft"
  | "published"
  | "offers_received"
  | "open"
  | "payment_approval_pending"
  | "driver_selected"
  | "driver_en_route"
  | "at_pickup"
  | "picked_up"
  | "en_route_to_delivery"
  | "in_transit"
  | "delivered"
  | "completed"
  | "cancelled"
  | "reviewing"
  | "resolved"
  | "dismissed"
  | string;

export const labelMap: Record<string, string> = {
  customer: "Müşteri",
  driver: "Şoför",
  active: "Aktif",
  blocked: "Engelli",
  individual: "Bireysel",
  corporate: "Kurumsal",
  shipment_reward: "Nakliye kazancı",
  shipment_usage: "Nakliyede kullanıldı",
  reversal: "İade",
  adjustment: "Düzeltme",
  pending: "Onay Bekliyor",
  verified: "Doğrulandı",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  draft: "TASLAK",
  published: "YAYINDA",
  offers_received: "TEKLİF ALINDI",
  open: "Açık",
  payment_approval_pending: "ŞOFÖR ÖDEME ONAYI BEKLENİYOR",
  driver_selected: "ŞOFÖR SEÇİLDİ",
  driver_en_route: "ŞOFÖR YOLA ÇIKTI",
  at_pickup: "YÜKLEME NOKTASINDA",
  picked_up: "YÜK ALINDI",
  en_route_to_delivery: "TESLİM NOKTASINA GİDİYOR",
  in_transit: "TESLİM NOKTASINA GİDİYOR",
  delivered: "TESLİM EDİLDİ",
  completed: "TAMAMLANDI",
  cancelled: "İPTAL EDİLDİ",
  admin: "Yönetici",
  customer_app: "Müşteri uygulaması",
  driver_app: "Şoför uygulaması",
  system: "Sistem",
  offer_acceptance: "Teklif kabulü",
  reviewing: "İnceleniyor",
  resolved: "Çözüldü",
  dismissed: "Reddedildi",
  identity: "Kimlik Belgesi",
  driver_license: "Sürücü Belgesi (Ehliyet)",
  vehicle_registration: "Araç Ruhsatı",
  src: "SRC Belgesi",
  src_document: "SRC Belgesi",
  psychotechnic: "Psikoteknik Belgesi",
  psychotechnical: "Psikoteknik Belgesi",
  insurance: "Sigorta Poliçesi",
  criminal_record: "Adli Sicil Kaydı",
  tax_plate: "Vergi Levhası",
  signature_circular: "İmza Sirküleri",
  trade_registry: "Ticaret Sicil Gazetesi",
  activity_certificate: "Faaliyet Belgesi",
  other: "Diğer Belge",
  payment_dispute: "Ödeme anlaşmazlığı",
  behavior: "Davranış / İletişim",
  damage: "Yük Hasarı",
  no_show: "Gelmeme / Gecikme",
  incorrect_load_info: "Yanlış yük bilgisi",
  safety: "Güvenlik İhlali",
  harassment: "Rahatsız Edici Davranış",
  fraud: "Şüpheli İşlem / Dolandırıcılık",
  spam: "Spam",
  inappropriate: "Uygunsuz İçerik",
  privacy: "Gizlilik İhlali",
};

export function getLabel(val?: string): string {
  if (!val) return "—";
  return labelMap[val] || val;
}

export function StatusBadge({ value, className = "" }: { value?: string; className?: string }) {
  const val = value?.toLowerCase() || "pending";
  let colorClass = "badge-gray";

  if (["verified", "approved", "completed", "active", "resolved"].includes(val)) {
    colorClass = "badge-green";
  } else if (["pending", "payment_approval_pending", "reviewing", "offers_received", "driver_selected", "driver_en_route", "at_pickup", "picked_up", "en_route_to_delivery", "in_transit"].includes(val)) {
    colorClass = "badge-amber";
  } else if (["rejected", "blocked", "cancelled", "dismissed"].includes(val)) {
    colorClass = "badge-red";
  } else if (["published", "open"].includes(val)) {
    colorClass = "badge-blue";
  }

  return (
    <span className={`badge-pill ${colorClass} ${className}`}>
      {getLabel(value)}
    </span>
  );
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatMoney(centsOrTl: number, isCents = false): string {
  const amount = isCents ? centsOrTl / 100 : centsOrTl;
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function getInitials(name?: string): string {
  if (!name) return "NG";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
