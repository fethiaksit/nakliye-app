export const LOAD_STATUS_LABELS = Object.freeze({
  draft: 'TASLAK',
  published: 'YAYINDA',
  driver_selected: 'ŞOFÖR SEÇİLDİ',
  driver_en_route: 'ŞOFÖR YOLA ÇIKTI',
  at_pickup: 'YÜKLEME NOKTASINDA',
  picked_up: 'YÜK ALINDI',
  en_route_to_delivery: 'TESLİM NOKTASINA GİDİYOR',
  delivered: 'TESLİM EDİLDİ',
  completed: 'TAMAMLANDI',
  cancelled: 'İPTAL EDİLDİ',
});

export function canonicalLoadStatus(status) {
  if (status === 'open' || status === 'offers_received') return 'published';
  if (status === 'in_transit') return 'en_route_to_delivery';
  return status;
}

export function loadStatusLabel(status) {
  return LOAD_STATUS_LABELS[canonicalLoadStatus(status)] || 'BİLİNMİYOR';
}

export function isOfferableLoadStatus(status) {
  return canonicalLoadStatus(status) === 'published';
}

const DRIVER_ACTIONS = Object.freeze({
  driver_selected: {
    nextStatus: 'driver_en_route', label: 'Yola Çıktım', icon: 'navigate-circle-outline',
    title: 'Yola çıkışı onayla', message: 'Yükleme noktasına doğru yola çıktığınızı onaylayın.', confirmLabel: 'Yola Çıktım', successMessage: 'Yola çıkış durumu kaydedildi.',
  },
  driver_en_route: {
    nextStatus: 'at_pickup', label: 'Yükleme Noktasına Geldim', icon: 'location-outline',
    title: 'Varışı onayla', message: 'Yükleme noktasına ulaştığınızı onaylayın.', confirmLabel: 'Geldim', successMessage: 'Yükleme noktasına varış kaydedildi.',
  },
  at_pickup: {
    nextStatus: 'picked_up', label: 'Yükü Aldım', icon: 'cube-outline',
    title: 'Yük alımını onayla', message: 'Yükü teslim aldığınızı onaylayın.', confirmLabel: 'Yükü Aldım', successMessage: 'Yük alımı kaydedildi.',
  },
  picked_up: {
    nextStatus: 'en_route_to_delivery', label: 'Teslimat İçin Yola Çıktım', icon: 'navigate-outline',
    title: 'Teslimat yolculuğunu başlat', message: 'Teslim noktasına doğru yola çıktığınızı onaylayın.', confirmLabel: 'Yola Çıktım', successMessage: 'Teslimat yolculuğu başlatıldı.',
  },
  en_route_to_delivery: {
    nextStatus: 'delivered', label: 'Teslim Ettim', icon: 'checkmark-done-circle-outline',
    title: 'Teslimatı onayla', message: 'Yükün teslim noktasında teslim edildiğini onaylayın.', confirmLabel: 'Teslim Ettim', successMessage: 'Teslimat kaydedildi.',
  },
  delivered: {
    nextStatus: 'completed', label: 'Nakliyeyi Tamamla', icon: 'checkmark-circle-outline',
    title: 'Nakliyeyi tamamla', message: 'Teslim edilen nakliye işini tamamlandı olarak kapatın.', confirmLabel: 'Tamamla', successMessage: 'Nakliye tamamlandı.',
  },
});

export function driverStatusAction(status) {
  return DRIVER_ACTIONS[canonicalLoadStatus(status)] || null;
}
