import React from 'react';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import MapUnavailable from './MapUnavailable';

class NativeMapBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    if (__DEV__) console.warn('[MAPS] Google map rendering failed.', error?.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Every rendered native map explicitly uses Google. Missing native setup is
// surfaced by the caller; there is deliberately no MapKit provider fallback.
export default function MapAdapter({ fallback, mapRef, markers = [], polylineCoordinates, ...mapProps }) {
  const unavailable = fallback || <MapUnavailable />;
  return <NativeMapBoundary fallback={unavailable}>
    <MapView ref={mapRef} {...mapProps} provider={PROVIDER_GOOGLE}>
      {markers.filter(marker => marker?.coordinate).map(({ id, ...marker }) => <Marker key={id || `${marker.coordinate.latitude},${marker.coordinate.longitude}`} {...marker} />)}
      {Array.isArray(polylineCoordinates) && polylineCoordinates.length > 1 ? <Polyline coordinates={polylineCoordinates} strokeColor="#2563eb" strokeWidth={5} /> : null}
    </MapView>
  </NativeMapBoundary>;
}
