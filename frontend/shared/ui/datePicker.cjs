'use strict';

function asValidDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function clampToMinimum(value, minimumDate) {
  const selected = asValidDate(value) || new Date();
  const minimum = asValidDate(minimumDate);
  return minimum && selected < minimum ? minimum : selected;
}

function sameInstant(left, right) {
  const leftDate = asValidDate(left);
  const rightDate = asValidDate(right);
  return Boolean(leftDate && rightDate && leftDate.getTime() === rightDate.getTime());
}

function formatPickerValue(mode, value, locale = 'tr-TR') {
  const date = asValidDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, mode === 'date'
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { hour: '2-digit', minute: '2-digit' }).format(date);
}

module.exports = { asValidDate, clampToMinimum, formatPickerValue, sameInstant };
