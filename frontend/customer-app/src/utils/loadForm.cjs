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

function validateLoadFormFields(form, now = new Date()) {
  const errors = {};
  if (!String(form.title || '').trim()) errors.title = 'Yük başlığı zorunludur.';
  if (!String(form.description || '').trim()) errors.description = 'Yük açıklaması zorunludur.';
  if (!['immediate', 'today', 'scheduled'].includes(form.urgencyType)) errors.urgencyType = 'Nakliye zamanını seçin.';
  if (!['ev_esyasi', 'mobilya', 'beyaz_esya', 'paletli_yuk', 'motosiklet', 'ticari_yuk', 'parsiyel_yuk', 'diger'].includes(form.cargoType)) errors.cargoType = 'Nakliye türünü seçin.';
  if (form.cargoType === 'diger' && !String(form.cargoTypeNote || '').trim()) errors.cargoTypeNote = 'Diğer nakliye türünü kısaca açıklayın.';
  if (!['panelvan', 'kamyonet', 'acik_kasa', 'kapali_kasa', 'kamyon', 'tir', 'farketmez'].includes(form.vehicleType)) errors.vehicleType = 'Araç ihtiyacını seçin.';
  if (form.urgencyType === 'scheduled') {
    const scheduledAt = scheduledAtISO(form.scheduledDate, form.scheduledTime);
    if (!scheduledAt) {
      if (!form.scheduledDate) errors.scheduledDate = 'Nakliye tarihini seçin.';
      if (!form.scheduledTime) errors.scheduledTime = 'Nakliye saatini seçin.';
      if (form.scheduledDate && form.scheduledTime) errors.scheduledTime = 'Geçerli bir tarih ve saat seçin.';
    } else if (new Date(scheduledAt) <= now) errors.scheduledTime = 'Planlı nakliye tarihi ve saati gelecekte olmalıdır.';
  }
  for (const [field, value, label] of [['weight', form.weight, 'Ağırlık'], ['length', form.length, 'Uzunluk'], ['width', form.width, 'Genişlik'], ['height', form.height, 'Yükseklik']]) {
    if (!(number(value) > 0)) errors[field] = `${label} sıfırdan büyük olmalıdır.`;
  }
  for (const [field, value, label] of [['pickupFloor', form.pickupFloor, 'Çıkış katı'], ['deliveryFloor', form.deliveryFloor, 'Varış katı']]) {
    if (!Number.isInteger(number(value))) errors[field] = `${label} tam sayı olmalıdır.`;
  }
  if (form.helperNeeded && (!Number.isInteger(number(form.helperCount)) || number(form.helperCount) < 1)) errors.helperCount = 'Yardımcı personel sayısı en az 1 olmalıdır.';
  return errors;
}

function validateLoadForm(form, now = new Date()) {
  return Object.values(validateLoadFormFields(form, now))[0] || '';
}

module.exports = { number, scheduledAtISO, validateLoadForm, validateLoadFormFields };
