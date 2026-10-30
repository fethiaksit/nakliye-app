const { test } = require('node:test');
const assert = require('node:assert/strict');
test('4100 / 60 payment breakdown preserves gross and cash amounts', async () => {
 const { paymentBreakdown } = await import('../../../shared/paymentApproval.mjs');
 assert.deepEqual(paymentBreakdown(410000,6000), { amountCents:410000,creditCents:6000,customerPayableCents:404000 });
 assert.equal(paymentBreakdown(410000,0).customerPayableCents,410000);
 assert.throws(()=>paymentBreakdown(410000,410001));
 assert.throws(()=>paymentBreakdown(410000,-1));
});
