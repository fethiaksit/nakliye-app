// The backend returns route geometry in the encoded polyline format.
// Keeping this tiny decoder local avoids an extra native dependency and lets
// the app render exactly the route the backend priced and persisted.
export function decodeGooglePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const decodeValue = () => {
    let result = 0;
    let shift = 0;
    while (index < encoded.length) {
      const value = encoded.charCodeAt(index++) - 63;
      if (value < 0) throw new Error('Geçersiz rota verisi');
      result |= (value & 0x1f) << shift;
      shift += 5;
      if (shift > 30) throw new Error('Geçersiz rota verisi');
      if (value < 0x20) return result & 1 ? ~(result >> 1) : result >> 1;
    }
    throw new Error('Geçersiz rota verisi');
  };

  try {
    while (index < encoded.length) {
      latitude += decodeValue();
      longitude += decodeValue();
      points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
    }
  } catch (error) {
    if (__DEV__) console.warn('[ROUTE] Encoded polyline could not be decoded.', { message: error?.message });
    return [];
  }
  return points;
}
