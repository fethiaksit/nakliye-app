const {test}=require('node:test');
const assert=require('node:assert/strict');
const walletModule=import('../../../shared/walletMoney.mjs');
test('wallet input accepts decimal commas without rounding extra digits or unsafe amounts',async()=>{
 const {parseWalletUnits}=await walletModule;
 for(const [text,want] of [['7,5',750],['2000.01',200001],['-12,50',-1250],['1.005',null],['1e3',null],['',null],['NaN',null],['90000000000.01',null],['90000000000',9000000000000]]) assert.equal(parseWalletUnits(text),want,text);
});
test('wallet amounts retain kuruş on screen',async()=>{
 const {formatWalletCents}=await walletModule;
 assert.match(formatWalletCents(12345),/123,45/);
 assert.match(formatWalletCents(0),/0,00/);
});
test('wallet usage preview deducts decimal-comma amounts in kuruş', async () => {
 const {walletUsagePreview}=await walletModule;
 assert.deepEqual(walletUsagePreview('1000,25', 100025, 750050), {amountCents:100025, payableCents:650025, valid:true});
});
test('wallet usage preview rejects invalid, excessive and negative amounts', async () => {
 const {walletUsagePreview}=await walletModule;
 for(const text of ['', '0', '-1', '1.005', '1e3', '1000.26']) {
  const preview=walletUsagePreview(text,100025,750050);
  assert.equal(preview.valid,false,text);
  assert.equal(preview.payableCents,750050,text);
 }
 assert.equal(walletUsagePreview('10',10000,500).valid,false);
});
