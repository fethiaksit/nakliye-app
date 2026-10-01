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
  cargoDetails: { items: [{ name: 'Buzdolabı', count: 1 }] },
  pickup: { formattedAddress: 'İzmir' },
  dropoff: { formattedAddress: 'Manisa' },
  route: { distanceMeters: 40000 },
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
  assert.match(validateLoadForm({ ...completeForm, cargoType: 'diger', cargoTypeNote: '' }), /kısaca açıklayın/);
  assert.match(validateLoadForm({ ...completeForm, helperCount: '0' }), /en az 1/);
});

test('field validation exposes every invalid control for inline feedback', () => {
  const errors = validateLoadFormFields({
    ...completeForm,
    cargoType: '',
    pickup: null,
    dropoff: null,
    route: null,
    scheduledDate: '',
    scheduledTime: '',
  }, new Date('2029-01-01T00:00:00Z'));
  assert.deepEqual(Object.keys(errors).sort(), ['cargoType', 'dropoff', 'pickup', 'scheduledDate', 'scheduledTime']);
});

test('a planned listing cannot select a past date and time', () => {
  const errors = validateLoadFormFields({ ...completeForm, scheduledDate: '2028-12-31', scheduledTime: '23:59' }, new Date('2029-01-01T00:00:00Z'));
  assert.match(errors.scheduledTime, /gelecekte/);
});

test('validateStep validates step 1 cargoType and other cargo explanation', () => {
  const { validateStep } = require('./loadForm.cjs');
  // Empty category returns exact Turkish error
  const emptyRes = validateStep(1, { form: { cargoType: '' } });
  assert.equal(emptyRes.cargoType, 'Devam etmek için yük türünü seçin.');

  // All 8 categories pass step 1
  assert.deepEqual(validateStep(1, { form: { cargoType: 'ev_esyasi' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'mobilya' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'beyaz_esya' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'motosiklet' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'paletli_yuk' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'ticari_yuk' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'parsiyel_yuk' } }), {});
  assert.deepEqual(validateStep(1, { form: { cargoType: 'diger', cargoTypeNote: 'Piyano' } }), {});

  // Diger requires note
  assert.ok(validateStep(1, { form: { cargoType: 'diger', cargoTypeNote: '' } }).cargoTypeNote);

  // Flat draft object shape also works
  assert.deepEqual(validateStep(1, { cargoType: 'ev_esyasi' }), {});
});

test('validateStep validates dynamic cargo details in step 2', () => {
  const { validateStep } = require('./loadForm.cjs');
  // Ev esyasi without moveType
  assert.ok(validateStep(2, { form: { cargoType: 'ev_esyasi', cargoDetails: {}, pickupFloor: '1', deliveryFloor: '2' } }).moveType);
  // Ev esyasi komple without homeSize
  assert.ok(validateStep(2, { form: { cargoType: 'ev_esyasi', cargoDetails: { moveType: 'komple' }, pickupFloor: '1', deliveryFloor: '2' } }).homeSize);
  // Motosiklet without motorcycleType
  assert.ok(validateStep(2, { form: { cargoType: 'motosiklet', cargoDetails: {} } }).motorcycleType);
  // Paletli yuk with 0 count
  assert.ok(validateStep(2, { form: { cargoType: 'paletli_yuk', cargoDetails: { palletCount: 0 } } }).palletCount);
});

test('validateStep validates route and stops in step 3', () => {
  const { validateStep } = require('./loadForm.cjs');
  assert.ok(validateStep(3, { form: {}, routeDraft: { pickup: null, dropoff: null } }).pickup);
  assert.ok(validateStep(3, { form: {}, routeDraft: { pickup: { formattedAddress: 'A' }, dropoff: null } }).dropoff);
  assert.ok(validateStep(3, { form: {}, routeDraft: { pickup: { formattedAddress: 'A' }, dropoff: { formattedAddress: 'B' }, stops: [{ address: '' }] } }).stop_0);
});

test('validateLoadFormFields catches incomplete clean drafts and allows fully populated drafts', () => {
  const cleanDraft = {
    form: {
      cargoType: '',
      urgencyType: 'immediate',
      cargoDetails: {},
    },
    routeDraft: {
      pickup: null,
      dropoff: null,
      stops: [],
      route: null,
    },
  };
  const cleanErrors = validateLoadFormFields(cleanDraft);
  assert.equal(cleanErrors.cargoType, 'Devam etmek için yük türünü seçin.');
  assert.equal(cleanErrors.pickup, 'Yükün alınacağı başlangıç adresini seçin.');
  assert.equal(cleanErrors.dropoff, 'Yükün teslim edileceği varış adresini seçin.');

  const completeDraft = {
    form: {
      cargoType: 'motosiklet',
      cargoDetails: { motorcycleType: 'scooter' },
      urgencyType: 'immediate',
      vehicleType: 'panelvan',
    },
    routeDraft: {
      pickup: { formattedAddress: 'İzmir Konak', coordinate: { latitude: 38.4, longitude: 27.1 } },
      dropoff: { formattedAddress: 'İzmir Bornova', coordinate: { latitude: 38.46, longitude: 27.2 } },
      stops: [],
      route: { distanceMeters: 12000 },
    },
  };
  const completeErrors = validateLoadFormFields(completeDraft);
  assert.deepEqual(completeErrors, {});
});
