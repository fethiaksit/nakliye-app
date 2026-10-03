const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRepeatDraft } = require('./repeatLoad.cjs');

test('repeat load copies only listing form fields and forces a fresh schedule and route', () => {
  const draft = buildRepeatDraft({
    id: 'old-load', title: 'Paletli yük', description: 'Kırılabilir', status: 'completed', assignedDriverId: 'driver-1',
    deliveryCode: '123456', deliveryPhotoUrl: '/secret.jpg', walletUsedCents: 200000, agreedPriceTl: 10000,
    urgencyType: 'scheduled', scheduledAt: '2026-01-01T10:00:00Z', cargoType: 'paletli_yuk', vehicleType: 'kamyon',
    dimensions: { weightKg: 500, lengthCm: 120, widthCm: 80, heightCm: 100 },
    pickup: { address: 'İzmir', latitude: 38.4, longitude: 27.1 }, delivery: { address: 'İstanbul', latitude: 41, longitude: 29 },
    pickupFloor: 1, deliveryFloor: 2, helperNeeded: true, helperCount: 2,
  });
  assert.equal(draft.form.title, 'Paletli yük');
  assert.equal(draft.form.urgencyType, 'immediate');
  assert.equal(draft.form.scheduledDate, '');
  assert.equal(draft.routeDraft.route, null);
  assert.equal(draft.routeDraft.pickup.formattedAddress, 'İzmir');
  assert.equal('id' in draft.form, false);
  assert.equal('status' in draft.form, false);
  assert.equal('assignedDriverId' in draft.form, false);
  assert.equal('deliveryCode' in draft.form, false);
  assert.equal('deliveryPhotoUrl' in draft.form, false);
  assert.equal('walletUsedCents' in draft.form, false);
  assert.equal('agreedPriceTl' in draft.form, false);
});

test('repeat respects original auto-selection instead of locking the previously calculated class', () => {
 const draft = buildRepeatDraft({ vehicleType: 'kamyonet', requestedVehicleType: 'farketmez', dimensions: { volumeM3: 12, weightKg: 2000 } });
 assert.equal(draft.form.vehicleType, 'farketmez');
 assert.equal(draft.form.volume, undefined);
 assert.equal(buildRepeatDraft({ vehicleType: 'panelvan' }).form.vehicleType, 'panelvan');
});

test('repeat preserves optional reported weight but asks server to infer missing weight again', () => {
 const load = { dimensions: { weightKg: 750 }, cargoDetails: { capacityInput: 'simple-v1', reportedWeightKg: 0, palletCount: 3 } };
 assert.equal(buildRepeatDraft(load).form.weight, '');
 assert.equal(buildRepeatDraft({ ...load, cargoDetails: { ...load.cargoDetails, reportedWeightKg: 900 } }).form.weight, '900');
});
