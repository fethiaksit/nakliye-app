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

function buildRepeatDraft(load = {}) {
  return {
    form: {
      title: load.title || '', description: load.description || '', urgencyType: 'immediate', scheduledDate: '', scheduledTime: '',
      cargoType: load.cargoType || '', cargoTypeNote: load.cargoTypeNote || '', vehicleType: load.vehicleType || 'farketmez',
      weight: String(load.dimensions?.weightKg || ''), length: String(load.dimensions?.lengthCm || ''),
      width: String(load.dimensions?.widthCm || ''), height: String(load.dimensions?.heightCm || ''),
      pickupFloor: String(load.pickupFloor ?? 0), deliveryFloor: String(load.deliveryFloor ?? 0),
      pickupElevatorAvailable: Boolean(load.pickupElevatorAvailable), deliveryElevatorAvailable: Boolean(load.deliveryElevatorAvailable),
      helperNeeded: Boolean(load.helperNeeded), helperCount: String(load.helperCount || 1),
    },
    routeDraft: { pickup: toDraftLocation(load.pickup), dropoff: toDraftLocation(load.delivery), route: null },
  };
}

module.exports = { buildRepeatDraft };
