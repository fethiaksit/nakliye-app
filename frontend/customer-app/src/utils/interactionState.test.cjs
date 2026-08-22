'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { asValidDate, clampToMinimum, formatPickerValue } = require('../../../shared/ui/datePicker.cjs');
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
