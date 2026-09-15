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
