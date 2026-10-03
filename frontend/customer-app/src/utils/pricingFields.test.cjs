const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPricingFields, validateStep } = require('./loadForm.cjs');

test('preview and creation share simple cargo answers, handling and helper fields', () => {
 const fields = buildPricingFields({ weight: '2000', volume: '12,5', vehicleType: 'kamyonet', urgencyType: 'today', helperNeeded: true, helperCount: '2', pickupFloor: '3', pickupElevatorAvailable: true, cargoDetails: { pickupElevatorSuitable: false, loadingResponsibility: 'driver', unloadingResponsibility: 'customer' } });
 assert.deepEqual(fields.dimensions, { weightKg: 2000, lengthCm: 100, widthCm: 100, heightCm: 100 });
 assert.equal(fields.cargoDetails.capacityInput, 'simple-v1');
 assert.equal(fields.helperCount, 2);
 assert.equal(fields.pickupFloor, 3);
 assert.equal(fields.cargoDetails.unloadingResponsibility, 'customer');
 assert.equal(fields.urgencyType, 'today');
 assert.equal(fields.scheduledAt, undefined);
});
test('minivan is accepted and invalid physical data is rejected before estimating', () => {
 assert.deepEqual(validateStep(5, { vehicleType: 'minivan' }), {});
 const errors = validateStep(2, { cargoType: 'diger', cargoTypeNote: 'Koli', volume: '-5', weight: 'x', helperNeeded: true, helperCount: '21' });
 assert.equal(errors.volume, undefined);
 assert.ok(errors.weight);
 assert.ok(errors.helperCount);
});

test('missing customer weight is left for server inference without sending obsolete volume', () => {
 const fields = buildPricingFields({ cargoType: 'mobilya', volume: '99', cargoDetails: { items: [{ name: 'Kanepe', count: 2 }] } });
 assert.equal(fields.dimensions.weightKg, 0);
 assert.equal(fields.dimensions.volumeM3, undefined);
 assert.deepEqual(fields.cargoDetails.items, [{ name: 'Kanepe', count: 2 }]);
});

test('the visibly selected default Euro pallet size is sent to the server', () => {
 assert.equal(buildPricingFields({ cargoType: 'paletli_yuk', cargoDetails: { palletCount: 3 } }).cargoDetails.palletSize, 'euro');
 assert.equal(buildPricingFields({ cargoType: 'paletli_yuk', cargoDetails: { palletCount: 3, palletSize: 'custom' } }).cargoDetails.palletSize, 'custom');
});
