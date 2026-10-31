export function paymentBreakdown(amountCents, creditCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(creditCents) || creditCents < 0 || creditCents > amountCents) throw new RangeError('Geçersiz ödeme tutarı');
  return { amountCents, creditCents, customerPayableCents: amountCents - creditCents };
}
