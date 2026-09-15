// Parse TL or percentages into integer hundredths; never round user input.
export function parseWalletUnits(text) {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(String(text).trim());
  if (!match) return null;
  const units = Number(`${match[2]}${(match[3] || '').padEnd(2, '0')}`);
  if (!Number.isSafeInteger(units) || units > 9000000000000) return null;
  return match[1] ? -units : units;
}
export function formatWalletCents(cents = 0) {
  return new Intl.NumberFormat('tr-TR', {style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(cents || 0) / 100);
}
