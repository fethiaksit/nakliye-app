const toDraftLocation = location => location ? {
  formattedAddress: location.address || '',
  coordinate: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
  placeId: location.placeId || '',
  street: location.street || '',
  streetNumber: location.streetNumber || '',
  neighborhood: location.neighborhood || '',
  district: location.district || '',
  city: location.city || '',
  province: location.province || '',
  postalCode: location.postalCode || '',
  country: location.country || '',
  countryCode: location.countryCode || '',
} : null;

function toDraftStop(stop, index) {
  if (!stop) return null;
  return {
    id: stop.id || `stop-${Date.now()}-${index}`,
    order: stop.order || index + 1,
    address: stop.address || '',
    placeId: stop.placeId || '',
    coordinate: { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
    stopType: stop.stopType || 'pickup',
    note: stop.note || '',
  };
}

function buildRepeatDraft(load = {}) {
  const stops = Array.isArray(load.stops) ? load.stops.map(toDraftStop).filter(Boolean) : [];
  return {
    form: {
      title: load.title || '', description: load.description || '', urgencyType: 'immediate', scheduledDate: '', scheduledTime: '',
      cargoType: load.cargoType || '', cargoTypeNote: load.cargoTypeNote || '', vehicleType: load.vehicleType || 'farketmez',
      cargoDetails: load.cargoDetails ? JSON.parse(JSON.stringify(load.cargoDetails)) : {},
      weight: String(load.dimensions?.weightKg || ''), length: String(load.dimensions?.lengthCm || ''),
      width: String(load.dimensions?.widthCm || ''), height: String(load.dimensions?.heightCm || ''),
      pickupFloor: String(load.pickupFloor ?? 0), deliveryFloor: String(load.deliveryFloor ?? 0),
      pickupElevatorAvailable: Boolean(load.pickupElevatorAvailable), deliveryElevatorAvailable: Boolean(load.deliveryElevatorAvailable),
      helperNeeded: Boolean(load.helperNeeded), helperCount: String(load.helperCount || 1),
    },
    routeDraft: { pickup: toDraftLocation(load.pickup), dropoff: toDraftLocation(load.delivery), stops, route: null },
  };
}

module.exports = { buildRepeatDraft };
