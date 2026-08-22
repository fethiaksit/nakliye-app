'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduledAtISO, validateLoadForm, validateLoadFormFields } = require('./loadForm.cjs');

const completeForm = {
  title: 'Buzdolabı taşıma',
  description: 'Paketli ve taşımaya hazır.',
  urgencyType: 'scheduled',
  scheduledDate: '2030-06-15',
  scheduledTime: '14:30',
  cargoType: 'beyaz_esya',
  cargoTypeNote: '',
  vehicleType: 'kapali_kasa',
  weight: '95',
  length: '80',
  width: '75',
  height: '190',
  pickupFloor: '3',
  deliveryFloor: '1',
  helperNeeded: true,
  helperCount: '2',
};

test('planned date and time become one valid instant', () => {
  const scheduledAt = scheduledAtISO('2030-06-15', '14:30');
  assert.ok(scheduledAt);
  assert.equal(Number.isNaN(new Date(scheduledAt).getTime()), false);
});

test('invalid calendar values are rejected instead of rolling over', () => {
  assert.equal(scheduledAtISO('2030-02-31', '14:30'), null);
  assert.equal(scheduledAtISO('2030-06-15', '24:00'), null);
});

test('a complete planned listing passes operational validation', () => {
  assert.equal(validateLoadForm(completeForm, new Date('2029-01-01T00:00:00Z')), '');
});

test('other cargo and helper selection require their dependent details', () => {
  assert.match(validateLoadForm({ ...completeForm, cargoType: 'diger' }), /kısaca açıklayın/);
  assert.match(validateLoadForm({ ...completeForm, helperCount: '0' }), /en az 1/);
});

test('field validation exposes every invalid control for inline feedback', () => {
  const errors = validateLoadFormFields({
    ...completeForm,
    title: '',
    description: '',
    weight: '0',
    width: '',
    scheduledDate: '',
    scheduledTime: '',
  }, new Date('2029-01-01T00:00:00Z'));
  assert.deepEqual(Object.keys(errors).sort(), ['description', 'scheduledDate', 'scheduledTime', 'title', 'weight', 'width']);
});

test('a planned listing cannot select a past date and time', () => {
  const errors = validateLoadFormFields({ ...completeForm, scheduledDate: '2028-12-31', scheduledTime: '23:59' }, new Date('2029-01-01T00:00:00Z'));
  assert.match(errors.scheduledTime, /gelecekte/);
});
