'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isLatestLocationRequest, updateLocationDraft } = require('./locationSelection.cjs');

test('updating destination never changes origin', () => {
  const origin = { placeId: 'origin', formattedAddress: 'Bornova, İzmir' };
  const destination = { placeId: 'destination', formattedAddress: 'Kadıköy, İstanbul' };
  const current = { pickup: origin, dropoff: null };

  const next = updateLocationDraft(current, 'dropoff', destination);

  assert.strictEqual(next.pickup, origin);
  assert.strictEqual(next.dropoff, destination);
  assert.equal(current.dropoff, null);
});

test('updating origin never changes destination', () => {
  const origin = { placeId: 'origin', formattedAddress: 'Bornova, İzmir' };
  const destination = { placeId: 'destination', formattedAddress: 'Kadıköy, İstanbul' };
  const current = { pickup: null, dropoff: destination };

  const next = updateLocationDraft(current, 'pickup', origin);

  assert.strictEqual(next.pickup, origin);
  assert.strictEqual(next.dropoff, destination);
  assert.equal(current.pickup, null);
});

test('a stale reverse-geocode response is rejected even after selecting the same point again', () => {
  const sequences = { pickup: 3, dropoff: 7 };

  assert.equal(isLatestLocationRequest(sequences, 'pickup', 1), false);
  assert.equal(isLatestLocationRequest(sequences, 'pickup', 3), true);
  assert.equal(isLatestLocationRequest(sequences, 'dropoff', 6), false);
});
