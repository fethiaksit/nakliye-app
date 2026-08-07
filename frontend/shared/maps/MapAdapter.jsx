import React from 'react';

import MapUnavailable from './MapUnavailable';
import { getNativeMaps, isExpoGo } from './mapRuntime';

class NativeMapBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    if (__DEV__) console.warn('[MAPS] Native map rendering failed; showing fallback.', error?.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Consumers pass plain marker/polyline data. This prevents MapView, Marker
// and Polyline from being imported by screens that must also run in Expo Go.
export default function MapAdapter({ fallback, mapRef, markers = [], polylineCoordinates, ...mapProps }) {
  const maps = getNativeMaps();
  if (!maps?.default || !maps.Marker) return fallback || <MapUnavailable />;

  const NativeMap = maps.default;
  const NativeMarker = maps.Marker;
  const NativePolyline = maps.Polyline;
  // Expo Go on iOS ships Apple Maps, not an app-specific Google Maps SDK key.
  // A development build uses the configured Google provider.  Do not force an
  // unavailable provider in Expo Go; Google Places/Routes data still comes
  // from the backend in both cases.
  const provider = isExpoGo ? undefined : maps.PROVIDER_GOOGLE;
  const unavailable = fallback || <MapUnavailable />;
  return <NativeMapBoundary fallback={unavailable}>
    <NativeMap ref={mapRef} {...mapProps} {...(provider ? { provider } : {})}>
      {markers.filter(marker => marker?.coordinate).map(({ id, ...marker }) => <NativeMarker key={id || `${marker.coordinate.latitude},${marker.coordinate.longitude}`} {...marker} />)}
      {NativePolyline && Array.isArray(polylineCoordinates) && polylineCoordinates.length > 1 ? <NativePolyline coordinates={polylineCoordinates} strokeColor="#2563eb" strokeWidth={5} /> : null}
    </NativeMap>
  </NativeMapBoundary>;
}
