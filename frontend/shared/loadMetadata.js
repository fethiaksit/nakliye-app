export const LOAD_TIMING_OPTIONS = [
  { value: 'immediate', label: 'Hemen' },
  { value: 'today', label: 'Bugün' },
  { value: 'scheduled', label: 'Planlı' },
];

export const CARGO_TYPE_OPTIONS = [
  { value: 'ev_esyasi', label: 'Ev eşyası' },
  { value: 'mobilya', label: 'Mobilya' },
  { value: 'beyaz_esya', label: 'Beyaz eşya' },
  { value: 'paletli_yuk', label: 'Paletli yük' },
  { value: 'motosiklet', label: 'Motosiklet' },
  { value: 'ticari_yuk', label: 'Ticari yük' },
  { value: 'parsiyel_yuk', label: 'Parsiyel yük' },
  { value: 'diger', label: 'Diğer' },
];

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'panelvan', label: 'Panelvan' },
  { value: 'kamyonet', label: 'Kamyonet' },
  { value: 'acik_kasa', label: 'Açık kasa' },
  { value: 'kapali_kasa', label: 'Kapalı kasa' },
  { value: 'kamyon', label: 'Kamyon' },
  { value: 'tir', label: 'TIR' },
  { value: 'farketmez', label: 'Fark etmez' },
];

const labelFor = (options, value) => options.find(option => option.value === value)?.label || 'Belirtilmedi';

export const urgencyTypeLabel = value => labelFor(LOAD_TIMING_OPTIONS, value);
export const cargoTypeLabel = value => labelFor(CARGO_TYPE_OPTIONS, value);
export const vehicleTypeLabel = value => labelFor(VEHICLE_TYPE_OPTIONS, value);

export const formatListingTime = load => {
  if (load?.urgencyType === 'immediate') return 'Hemen';
  if (load?.urgencyType === 'today') return 'Bugün';
  if (load?.urgencyType === 'scheduled' && load?.scheduledAt) {
    const date = new Date(load.scheduledAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
    }
  }
  return 'Belirtilmedi';
};
