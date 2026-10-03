export const LOAD_TIMING_OPTIONS = [
  { value: 'immediate', label: 'Hemen' },
  { value: 'today', label: 'Bugün' },
  { value: 'scheduled', label: 'Planlı' },
];

export const CARGO_TYPE_OPTIONS = [
  { value: 'ev_esyasi', label: 'Ev eşyası', icon: 'home-outline', description: 'Komple ev veya parça ev eşyası taşıma' },
  { value: 'mobilya', label: 'Mobilya', icon: 'bed-outline', description: 'Koltuk, yatak, dolap, masa vb. mobilyalar' },
  { value: 'beyaz_esya', label: 'Beyaz eşya', icon: 'tv-outline', description: 'Buzdolabı, çamaşır/bulaşık makinesi, TV' },
  { value: 'paletli_yuk', label: 'Paletli yük', icon: 'layers-outline', description: 'Standart veya endüstriyel paletli yükler' },
  { value: 'motosiklet', label: 'Motosiklet', icon: 'bicycle-outline', description: 'Scooter, touring, enduro vb. motosikletler' },
  { value: 'ticari_yuk', label: 'Ticari yük', icon: 'business-outline', description: 'Koli, kutu, ürün ve kurumsal sevkiyat' },
  { value: 'parsiyel_yuk', label: 'Parsiyel yük', icon: 'cube-outline', description: 'Parça yük, hafif ve orta hacimli taşımalar' },
  { value: 'diger', label: 'Diğer', icon: 'ellipsis-horizontal-circle-outline', description: 'Özel taşımalar ve diğer yük türleri' },
];

export const STOP_TYPE_OPTIONS = [
  { value: 'pickup', label: 'Yük alınacak', shortLabel: 'Alınacak' },
  { value: 'delivery', label: 'Yük bırakılacak', shortLabel: 'Bırakılacak' },
  { value: 'both', label: 'Yük alınacak ve bırakılacak', shortLabel: 'Alınacak + Bırakılacak' },
];

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'farketmez', label: 'Uygun aracı sistem önersin', description: 'Yükünüze en uygun araçlar teklif verir' },
  { value: 'minivan', label: 'Minivan', description: '500 kg ve 4 m³ kapasiteye kadar küçük yükler' },
  { value: 'panelvan', label: 'Panelvan', description: 'Hafif yükler ve küçük eşyalar için' },
  { value: 'kamyonet', label: 'Kamyonet', description: 'Ev eşyası ve mobilyalar için' },
  { value: 'acik_kasa', label: 'Açık kasa', description: 'Açık kasa taşımaya uygun yükler' },
  { value: 'kapali_kasa', label: 'Kapalı kasa', description: 'Hava koşullarına karşı korumalı' },
  { value: 'kamyon', label: 'Kamyon', description: 'Büyük hacimli ve ağır yükler' },
  { value: 'tir', label: 'TIR', description: 'Yüksek kapasiteli uzun yol sevkiyatı' },
];

const labelFor = (options, value) => options.find(option => option.value === value)?.label || 'Belirtilmedi';

export const urgencyTypeLabel = value => labelFor(LOAD_TIMING_OPTIONS, value);
export const cargoTypeLabel = value => labelFor(CARGO_TYPE_OPTIONS, value);
export const vehicleTypeLabel = value => labelFor(VEHICLE_TYPE_OPTIONS, value);
export const stopTypeLabel = value => labelFor(STOP_TYPE_OPTIONS, value);

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

const extractShortLocation = location => {
  if (!location) return '';
  if (location.district && location.city && location.district !== location.city) {
    return `${location.district}`;
  }
  if (location.district) return location.district;
  if (location.city) return location.city;
  const parts = String(location.address || location.formattedAddress || '').split(',');
  return parts[0]?.trim() || '';
};

export const generateLoadTitle = (cargoType, cargoDetails = {}, cargoTypeNote = '', pickup = null, delivery = null) => {
  let main = '';
  switch (cargoType) {
    case 'ev_esyasi':
      if (cargoDetails.moveType === 'komple' && cargoDetails.homeSize) {
        main = `${cargoDetails.homeSize} Komple Ev Taşıma`;
      } else if (cargoDetails.moveType === 'parca') {
        main = 'Parça Ev Eşyası Taşıma';
      } else {
        main = 'Ev Eşyası Taşıma';
      }
      break;
    case 'mobilya': {
      const items = cargoDetails.items || [];
      const totalCount = items.reduce((sum, item) => sum + (Number(item.count) || 1), 0);
      main = totalCount > 0 ? `${totalCount} Parça Mobilya Taşıma` : 'Mobilya Taşıma';
      break;
    }
    case 'beyaz_esya': {
      const items = cargoDetails.items || [];
      const totalCount = items.reduce((sum, item) => sum + (Number(item.count) || 1), 0);
      main = totalCount > 0 ? `${totalCount} Parça Beyaz Eşya Taşıma` : 'Beyaz Eşya Taşıma';
      break;
    }
    case 'motosiklet':
      main = cargoDetails.motorcycleType ? `${cargoDetails.motorcycleType} Motosiklet Taşıma` : 'Motosiklet Taşıma';
      break;
    case 'paletli_yuk':
      main = cargoDetails.palletCount ? `${cargoDetails.palletCount} Palet Yük Taşıma` : 'Paletli Yük Taşıma';
      break;
    case 'ticari_yuk':
      main = cargoDetails.commercialType ? `${cargoDetails.commercialType} Ticari Yük` : 'Ticari Yük Taşıma';
      break;
    case 'parsiyel_yuk':
      main = cargoDetails.pieceCount ? `${cargoDetails.pieceCount} Parça Parsiyel Yük` : 'Parsiyel Yük Taşıma';
      break;
    case 'diger':
      main = cargoTypeNote ? `${cargoTypeNote.slice(0, 30)}` : 'Özel Yük Taşıma';
      break;
    default:
      main = 'Nakliye Talebi';
  }

  const from = extractShortLocation(pickup);
  const to = extractShortLocation(delivery);
  if (from && to) {
    return `${main} · ${from} → ${to}`;
  }
  return main;
};

export const generateLoadDescription = (cargoType, cargoDetails = {}, cargoTypeNote = '', form = {}) => {
  const parts = [];
  const sizeLabels = { small: 'Birkaç koli / küçük eşya', medium: 'Birkaç büyük eşya', large: 'Çok sayıda büyük eşya', unknown: 'Miktardan emin değilim' };
  if (sizeLabels[cargoDetails.loadSize]) parts.push(`Yaklaşık yük: ${sizeLabels[cargoDetails.loadSize]}.`);

  switch (cargoType) {
    case 'ev_esyasi':
      if (cargoDetails.moveType === 'komple') {
        parts.push(`${cargoDetails.homeSize || 'Komple'} ev eşyası taşınacaktır.`);
      } else {
        parts.push('Parça ev eşyası taşınacaktır.');
        if (cargoDetails.itemSummary) parts.push(`Eşyalar: ${cargoDetails.itemSummary}`);
      }
      if (cargoDetails.hasSpecialItems && cargoDetails.specialItemsDescription) {
        parts.push(`Özel eşyalar: ${cargoDetails.specialItemsDescription}`);
      }
      break;
    case 'mobilya': {
      const items = cargoDetails.items || [];
      if (items.length > 0) {
        parts.push(`Taşınacak mobilyalar: ${items.map(i => `${i.name} (${i.count} adet)`).join(', ')}.`);
      } else {
        parts.push('Mobilya taşınacaktır.');
      }
      break;
    }
    case 'beyaz_esya': {
      const items = cargoDetails.items || [];
      if (items.length > 0) {
        parts.push(`Taşınacak beyaz eşyalar: ${items.map(i => `${i.name} (${i.count} adet)`).join(', ')}.`);
      } else {
        parts.push('Beyaz eşya taşınacaktır.');
      }
      break;
    }
    case 'motosiklet':
      parts.push(`${cargoDetails.motorcycleType || 'Motosiklet'} nakliyesi yapılacaktır.`);
      break;
    case 'paletli_yuk':
      parts.push(`${cargoDetails.palletCount || 1} adet paletli yük taşınacaktır.`);
      break;
    case 'ticari_yuk':
      parts.push(`${cargoDetails.commercialType || 'Ticari yük'} sevkiyatı yapılacaktır.`);
      break;
    case 'parsiyel_yuk':
      parts.push(`${cargoDetails.pieceCount || 1} parça parsiyel yük taşınacaktır.`);
      break;
    case 'diger':
      parts.push(cargoTypeNote ? `${cargoTypeNote} taşınacaktır.` : 'Özel nakliye talebi.');
      break;
    default:
      parts.push('Nakliye talebi.');
  }

  if (form.pickupFloor !== undefined && form.pickupFloor !== '' && form.pickupFloor !== null) {
    parts.push(`Çıkış: ${form.pickupFloor}. kat (${form.pickupElevatorAvailable ? 'asansör var' : 'asansör yok'}).`);
  }
  if (form.deliveryFloor !== undefined && form.deliveryFloor !== '' && form.deliveryFloor !== null) {
    parts.push(`Varış: ${form.deliveryFloor}. kat (${form.deliveryElevatorAvailable ? 'asansör var' : 'asansör yok'}).`);
  }

  if (form.helperNeeded) {
    parts.push(`${form.helperCount || 1} yardımcı eleman talep edilmektedir.`);
  }
  if (cargoDetails.packagingRequired) {
    parts.push('Paketleme hizmeti talep edilmektedir.');
  }
  if (cargoDetails.assemblyRequired) {
    parts.push('Montaj / demontaj hizmeti talep edilmektedir.');
  }

  return parts.join(' ');
};
