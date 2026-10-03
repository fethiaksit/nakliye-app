'use strict';

// Only the centralized city tariff may supply the listing summary price.
function verifyPricingEstimate(data) {
  const prices = [data?.recommendedPrice, data?.minPrice, data?.maxPrice];
  if (data?.algorithmVersion !== 'city-v2' || !prices.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Güncel fiyat tahmini alınamadı.');
  }
  if (data.manualQuoteRequired === true) {
    if (!prices.every(value => value === 0)) throw new Error('Geçersiz özel teklif tahmini.');
  } else if (data.recommendedPrice <= 0 || data.minPrice <= 0 || data.minPrice > data.recommendedPrice || data.maxPrice < data.recommendedPrice) {
    throw new Error('Geçersiz fiyat tahmini.');
  }
  return data;
}

// Estimates are optional guidance; creation performs its own server validation.
function isPublishDisabled({ saving = false } = {}) { return Boolean(saving); }

module.exports = { verifyPricingEstimate, isPublishDisabled };
