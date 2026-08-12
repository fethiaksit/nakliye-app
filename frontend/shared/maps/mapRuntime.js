export function hasCoordinate(location) {
  return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

export function directionsURL(pickup, dropoff) {
  if (!hasCoordinate(pickup) || !hasCoordinate(dropoff)) return '';
  const origin = `${Number(pickup.latitude)},${Number(pickup.longitude)}`;
  const destination = `${Number(dropoff.latitude)},${Number(dropoff.longitude)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
