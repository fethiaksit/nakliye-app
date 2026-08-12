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
  const loopback = path.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/.*)?$/i);
  if (loopback) return `${apiOrigin}${loopback[1] || ''}`;
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiOrigin}/${path.replace(/^\/+/, '')}`;
}

// Backend photo payloads have existed as strings and object records. Normalize
// them once at the data boundary so every driver gallery uses { id, url } and
// never guesses whether an already-resolved URL needs an /api prefix.
export function normalizeLoadPhotos(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  return values.reduce((photos, item, index) => {
    const raw = typeof item === 'string' ? item : item?.url || item?.uri || item?.photoUrl || item?.photo_url || item?.imageUrl || item?.image_url;
    const url = resolveMediaUrl(raw);
    if (!url || seen.has(url)) return photos;
    seen.add(url);
    photos.push({ id: String(typeof item === 'object' && item?.id || index) + ':' + url, url });
    return photos;
  }, []);
}

export function loadStatusLabel(status) {
  return ({ draft: 'Taslak', published: 'Yayında', open: 'Yayında', offers_received: 'Teklif Geldi', driver_selected: 'Şoför Seçildi', in_transit: 'Yolda', completed: 'Tamamlandı', cancelled: 'İptal Edildi' })[status] || 'Bilinmiyor';
}
