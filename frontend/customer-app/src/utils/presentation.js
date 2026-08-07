import { apiOrigin } from '../config/api';

export function toFiniteNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const raw = value.trim().replace(/\s/g, '');
  if (!raw) return fallback;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatMoney(value, fallback = 'Fiyat hesaplanamadı') {
  const amount = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(amount)) return fallback;
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount);
}

export function resolveMediaUrl(path) {
  if (!path || typeof path !== 'string') return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiOrigin}/${path.replace(/^\/+/, '')}`;
}

export function loadStatusLabel(status) {
  return ({ draft: 'Taslak', published: 'Yayında', open: 'Yayında', offers_received: 'Teklif Geldi', driver_selected: 'Şoför Seçildi', in_transit: 'Yolda', completed: 'Tamamlandı', cancelled: 'İptal Edildi' })[status] || 'Bilinmiyor';
}
