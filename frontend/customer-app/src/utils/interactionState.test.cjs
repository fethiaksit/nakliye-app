'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { asValidDate, clampToMinimum, formatPickerValue, pickerValueForOpen } = require('../../../shared/ui/datePicker.cjs');
const { canSendMessage, draftAfterSendAttempt, normalizeMessageDraft } = require('../../../shared/conversationComposer.cjs');

test('date picker displays a Turkish readable calendar date', () => {
  const value = new Date(2026, 7, 17, 12, 0, 0, 0);
  assert.equal(formatPickerValue('date', value), '17 Ağustos 2026');
});

test('date picker keeps a valid selected value and clamps past values', () => {
  const minimum = new Date(2026, 7, 17, 0, 0, 0, 0);
  const past = new Date(2026, 7, 16, 12, 0, 0, 0);
  const selected = new Date(2026, 7, 19, 12, 0, 0, 0);
  assert.equal(clampToMinimum(selected, minimum).getTime(), selected.getTime());
  assert.equal(clampToMinimum(past, minimum).getTime(), minimum.getTime());
  assert.equal(asValidDate('2026-08-17T09:00:00.000Z').toISOString(), '2026-08-17T09:00:00.000Z');
});

test('date picker accepts today and representative future calendar dates', () => {
  const minimum = new Date(2026, 7, 26, 0, 0, 0, 0);
  const dates = [
    new Date(2026, 7, 26, 12, 0, 0, 0),
    new Date(2026, 7, 27, 12, 0, 0, 0),
    new Date(2026, 8, 2, 12, 0, 0, 0),
    new Date(2026, 8, 15, 12, 0, 0, 0),
    new Date(2027, 0, 1, 12, 0, 0, 0),
  ];
  for (const date of dates) {
    assert.equal(pickerValueForOpen('date', date, minimum).getTime(), date.getTime());
  }

  const yearEndMinimum = new Date(2026, 11, 31, 0, 0, 0, 0);
  const nextYear = new Date(2027, 0, 1, 12, 0, 0, 0);
  assert.equal(pickerValueForOpen('date', nextYear, yearEndMinimum).getTime(), nextYear.getTime());
});

test('date picker opens at local noon and reopens on the existing selected date', () => {
  const minimum = new Date(2026, 7, 26, 0, 0, 0, 0);
  const now = new Date(2026, 7, 26, 23, 30, 0, 0);
  const firstOpen = pickerValueForOpen('date', null, minimum, now);
  assert.equal(firstOpen.getFullYear(), 2026);
  assert.equal(firstOpen.getMonth(), 7);
  assert.equal(firstOpen.getDate(), 26);
  assert.equal(firstOpen.getHours(), 12);

  const selected = new Date(2026, 8, 15, 12, 0, 0, 0);
  const reopened = pickerValueForOpen('date', selected, minimum, now);
  assert.equal(reopened.getTime(), selected.getTime());
});

test('time picker opens one hour ahead and reopens on the selected time', () => {
  const now = new Date(2026, 7, 26, 10, 15, 30, 0);
  const minimum = new Date(2026, 7, 26, 10, 30, 0, 0);
  const firstOpen = pickerValueForOpen('time', null, minimum, now);
  assert.equal(firstOpen.getHours(), 11);
  assert.equal(firstOpen.getMinutes(), 15);
  assert.equal(firstOpen.getSeconds(), 0);

  const selected = new Date(2026, 7, 26, 14, 45, 0, 0);
  const reopened = pickerValueForOpen('time', selected, minimum, now);
  assert.equal(reopened.getTime(), selected.getTime());
});

test('blank chat messages cannot be sent', () => {
  assert.equal(canSendMessage('   \n '), false);
  assert.equal(canSendMessage(' Merhaba '), true);
  assert.equal(normalizeMessageDraft(' Merhaba '), 'Merhaba');
});

test('chat draft is cleared only after success and only if unchanged', () => {
  assert.equal(draftAfterSendAttempt('Merhaba', 'Merhaba', true), '');
  assert.equal(draftAfterSendAttempt('Merhaba', 'Merhaba', false), 'Merhaba');
  assert.equal(draftAfterSendAttempt('Yeni metin', 'Merhaba', true), 'Yeni metin');
});
