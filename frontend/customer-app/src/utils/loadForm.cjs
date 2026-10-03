'use strict';

function number(value) {
  if (typeof value === 'number') return value;
  return Number(String(value || '').replace(',', '.'));
}

function scheduledAtISO(dateValue, timeValue) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || '').trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeValue || '').trim());
  if (!dateMatch || !timeMatch) return null;
  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (localDate.getFullYear() !== year || localDate.getMonth() !== month - 1 || localDate.getDate() !== day || localDate.getHours() !== hour || localDate.getMinutes() !== minute) return null;
  return localDate.toISOString();
}

function validateStep(step, draft, now = new Date()) {
  const errors = {};
  const form = draft?.form || draft || {};
  const routeDraft = draft?.routeDraft || draft || {};
  const cargoDetails = form.cargoDetails || {};

  if (step === 1) {
    if (!['ev_esyasi', 'mobilya', 'beyaz_esya', 'paletli_yuk', 'motosiklet', 'ticari_yuk', 'parsiyel_yuk', 'diger'].includes(form.cargoType)) {
      errors.cargoType = 'Devam etmek için yük türünü seçin.';
    }
    if (form.cargoType === 'diger' && !String(form.cargoTypeNote || '').trim()) {
      errors.cargoTypeNote = 'Diğer yük türünü kısaca açıklayın.';
    }
  }

  if (step === 2) {
    switch (form.cargoType) {
      case 'ev_esyasi':
        if (!cargoDetails.moveType) {
          errors.moveType = 'Taşıma tipini seçin (Komple veya Parça).';
        } else if (cargoDetails.moveType === 'komple' && !cargoDetails.homeSize) {
          errors.homeSize = 'Ev büyüklüğünü seçin.';
        } else if (cargoDetails.moveType === 'parca' && !String(cargoDetails.itemSummary || form.description || '').trim()) {
          errors.itemSummary = 'Taşınacak eşyaları kısaca listeleyin.';
        }
        if (cargoDetails.hasSpecialItems && !String(cargoDetails.specialItemsDescription || '').trim()) {
          errors.specialItemsDescription = 'Özel / ağır eşyaları belirtin (örn. piyano, kasa).';
        }
        if (form.pickupFloor !== undefined && form.pickupFloor !== '' && form.pickupFloor !== null && !Number.isInteger(number(form.pickupFloor))) {
          errors.pickupFloor = 'Çıkış katı tam sayı olmalıdır.';
        }
        if (form.deliveryFloor !== undefined && form.deliveryFloor !== '' && form.deliveryFloor !== null && !Number.isInteger(number(form.deliveryFloor))) {
          errors.deliveryFloor = 'Varış katı tam sayı olmalıdır.';
        }
        if (form.helperNeeded && (!Number.isInteger(number(form.helperCount)) || number(form.helperCount) < 1)) {
          errors.helperCount = 'Yardımcı personel sayısı en az 1 olmalıdır.';
        }
        break;

      case 'mobilya':
        if ((!cargoDetails.items || cargoDetails.items.length === 0) && !String(form.description || '').trim()) {
          errors.furnitureItems = 'En az bir mobilya seçin veya açıklama ekleyin.';
        }
        if (form.pickupFloor !== undefined && form.pickupFloor !== '' && form.pickupFloor !== null && !Number.isInteger(number(form.pickupFloor))) {
          errors.pickupFloor = 'Çıkış katı tam sayı olmalıdır.';
        }
        if (form.deliveryFloor !== undefined && form.deliveryFloor !== '' && form.deliveryFloor !== null && !Number.isInteger(number(form.deliveryFloor))) {
          errors.deliveryFloor = 'Varış katı tam sayı olmalıdır.';
        }
        if (form.helperNeeded && (!Number.isInteger(number(form.helperCount)) || number(form.helperCount) < 1)) {
          errors.helperCount = 'Yardımcı personel sayısı en az 1 olmalıdır.';
        }
        break;

      case 'beyaz_esya':
        if ((!cargoDetails.items || cargoDetails.items.length === 0) && !String(form.description || '').trim()) {
          errors.applianceItems = 'En az bir beyaz eşya seçin veya açıklama ekleyin.';
        }
        if (form.pickupFloor !== undefined && form.pickupFloor !== '' && form.pickupFloor !== null && !Number.isInteger(number(form.pickupFloor))) {
          errors.pickupFloor = 'Çıkış katı tam sayı olmalıdır.';
        }
        if (form.deliveryFloor !== undefined && form.deliveryFloor !== '' && form.deliveryFloor !== null && !Number.isInteger(number(form.deliveryFloor))) {
          errors.deliveryFloor = 'Varış katı tam sayı olmalıdır.';
        }
        if (form.helperNeeded && (!Number.isInteger(number(form.helperCount)) || number(form.helperCount) < 1)) {
          errors.helperCount = 'Yardımcı personel sayısı en az 1 olmalıdır.';
        }
        break;

      case 'motosiklet':
        if (!cargoDetails.motorcycleType) {
          errors.motorcycleType = 'Motosiklet türünü seçin.';
        }
        break;

      case 'paletli_yuk':
        if (!(number(cargoDetails.palletCount) > 0)) {
          errors.palletCount = 'Palet sayısı en az 1 olmalıdır.';
        }
        break;

      case 'ticari_yuk':
        if (!String(cargoDetails.commercialType || form.description || '').trim()) {
          errors.commercialType = 'Ticari yük tipini belirtin.';
        }
        break;

      case 'parsiyel_yuk':
        if (!(number(cargoDetails.pieceCount) > 0) && !String(form.description || '').trim()) {
          errors.pieceCount = 'Parça sayısını girin veya açıklama ekleyin.';
        }
        break;

      case 'diger':
        if (!String(form.cargoTypeNote || form.description || '').trim()) {
          errors.cargoTypeNote = 'Yük hakkında bilgi verin.';
        }
        break;

      default:
        break;
    }
  }

  if (step === 2) {
    for (const [key, max] of [['weight', 100000], ['volume', 125000], ['length', 5000], ['width', 5000], ['height', 5000]]) {
      if (form[key] !== undefined && form[key] !== '' && (!Number.isFinite(number(form[key])) || number(form[key]) <= 0 || number(form[key]) > max)) {
        errors[key] = 'Geçerli, sıfırdan büyük bir değer girin.';
      }
    }
    if (form.helperNeeded && (!Number.isInteger(number(form.helperCount)) || number(form.helperCount) < 1 || number(form.helperCount) > 20)) errors.helperCount = 'Yardımcı sayısı en az 1, en fazla 20 olmalıdır.';
    for (const key of ['pickupFloor', 'deliveryFloor']) {
      if (form[key] !== undefined && form[key] !== '' && (!Number.isInteger(number(form[key])) || number(form[key]) < -5 || number(form[key]) > 100)) errors[key] = 'Kat -5 ile 100 arasında tam sayı olmalıdır.';
    }
  }

  if (step === 3) {
    if (!routeDraft.pickup) errors.pickup = 'Yükün alınacağı başlangıç adresini seçin.';
    if (!routeDraft.dropoff) errors.dropoff = 'Yükün teslim edileceği varış adresini seçin.';
    if (Array.isArray(routeDraft.stops)) {
      routeDraft.stops.forEach((stop, index) => {
        if (!stop.address || (!stop.coordinate && stop.latitude === undefined)) {
          errors[`stop_${index}`] = `${index + 1}. ara durak adresini seçin.`;
        }
      });
    }
    if (routeDraft.pickup && routeDraft.dropoff && !routeDraft.route) {
      errors.route = 'Rota hesaplanıyor, lütfen bekleyin.';
    }
  }

  if (step === 4) {
    if (!['immediate', 'today', 'scheduled'].includes(form.urgencyType)) {
      errors.urgencyType = 'Nakliye zamanını seçin.';
    }
    if (form.urgencyType === 'scheduled') {
      const scheduledAt = scheduledAtISO(form.scheduledDate, form.scheduledTime);
      if (!scheduledAt) {
        if (!form.scheduledDate) errors.scheduledDate = 'Nakliye tarihini seçin.';
        if (!form.scheduledTime) errors.scheduledTime = 'Nakliye saatini seçin.';
        if (form.scheduledDate && form.scheduledTime) errors.scheduledTime = 'Geçerli bir tarih ve saat seçin.';
      } else if (new Date(scheduledAt) <= now) {
        errors.scheduledTime = 'Planlı nakliye tarihi ve saati gelecekte olmalıdır.';
      }
    }
  }

  if (step === 5) {
    if (form.vehicleType && !['minivan', 'panelvan', 'kamyonet', 'acik_kasa', 'kapali_kasa', 'kamyon', 'tir', 'farketmez'].includes(form.vehicleType)) {
      errors.vehicleType = 'Geçerli bir araç tipi seçin.';
    }
  }

  return errors;
}

function validateLoadFormFields(draft, now = new Date()) {
  const errors = {};
  for (let s = 1; s <= 5; s++) {
    const stepErrors = validateStep(s, draft, now);
    if (stepErrors) {
      Object.assign(errors, stepErrors);
    }
  }
  return errors;
}

function validateLoadForm(draft, now = new Date()) {
  return Object.values(validateLoadFormFields(draft, now))[0] || '';
}

function buildPricingFields(form = {}) {
  const positive = (value, fallback) => Number.isFinite(number(value)) && number(value) > 0 ? number(value) : fallback;
  const floor = value => Number.isInteger(number(value)) ? number(value) : 0;
  return {
    urgencyType: form.urgencyType || 'immediate',
    ...(form.urgencyType === 'scheduled' ? { scheduledAt: scheduledAtISO(form.scheduledDate, form.scheduledTime) } : {}),
    cargoType: form.cargoType,
    cargoTypeNote: form.cargoType === 'diger' ? String(form.cargoTypeNote || '').trim() : '',
    cargoDetails: form.cargoDetails || {},
    vehicleType: form.vehicleType || 'farketmez',
    dimensions: { lengthCm: positive(form.length, 100), widthCm: positive(form.width, 100), heightCm: positive(form.height, 100), weightKg: positive(form.weight, 50), ...(form.volume ? { volumeM3: positive(form.volume, 0) } : {}) },
    pickupFloor: floor(form.pickupFloor), deliveryFloor: floor(form.deliveryFloor),
    pickupElevatorAvailable: Boolean(form.pickupElevatorAvailable), deliveryElevatorAvailable: Boolean(form.deliveryElevatorAvailable),
    helperNeeded: Boolean(form.helperNeeded), helperCount: form.helperNeeded ? positive(form.helperCount, 1) : 0,
  };
}

module.exports = { buildPricingFields, number, scheduledAtISO, validateLoadForm, validateLoadFormFields, validateStep };


