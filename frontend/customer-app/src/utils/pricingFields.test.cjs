const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPricingFields, validateStep } = require('./loadForm.cjs');

test('preview and creation share normalized volume, handling and helper fields', () => {
 const fields = buildPricingFields({ weight: '2000', volume: '12,5', vehicleType: 'kamyonet', urgencyType: 'today', helperNeeded: true, helperCount: '2', pickupFloor: '3', pickupElevatorAvailable: true, cargoDetails: { pickupElevatorSuitable: false, loadingResponsibility: 'driver', unloadingResponsibility: 'customer' } });
 assert.deepEqual(fields.dimensions, { weightKg: 2000, lengthCm: 100, widthCm: 100, heightCm: 100, volumeM3: 12.5 });
 assert.equal(fields.helperCount, 2);
 assert.equal(fields.pickupFloor, 3);
 assert.equal(fields.cargoDetails.unloadingResponsibility, 'customer');
 assert.equal(fields.urgencyType, 'today');
 assert.equal(fields.scheduledAt, undefined);
});
test('minivan is accepted and invalid physical data is rejected before estimating', () => {
 assert.deepEqual(validateStep(5, { vehicleType: 'minivan' }), {});
 const errors = validateStep(2, { cargoType: 'diger', cargoTypeNote: 'Koli', volume: '-5', weight: 'x', helperNeeded: true, helperCount: '21' });
 assert.ok(errors.volume);
 assert.ok(errors.weight);
 assert.ok(errors.helperCount);
});
