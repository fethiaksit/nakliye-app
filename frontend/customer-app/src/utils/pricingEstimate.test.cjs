const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPricingEstimate } = require('./pricingEstimate.cjs');

test('listing summary accepts a current server estimate and rejects an old pricing response', () => {
 const current = { algorithmVersion: 'city-v2', recommendedPrice: 2750, minPrice: 2500, maxPrice: 3150 };
 assert.equal(verifyPricingEstimate(current), current);
 for (const data of [{ recommendedPrice: 700 }, { ...current, algorithmVersion: 'legacy' }, { ...current, recommendedPrice: 0 }, { ...current, minPrice: 4000 }, null]) {
  assert.throws(() => verifyPricingEstimate(data));
 }
});
test('manual quotes remain available without an invented price', () => {
 const manual = { algorithmVersion: 'city-v2', manualQuoteRequired: true, recommendedPrice: 0, minPrice: 0, maxPrice: 0 };
 assert.equal(verifyPricingEstimate(manual), manual);
});
