import React, { useEffect, useMemo, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { decodeGooglePolyline } from '../utils/polyline';
import { formatMoney, toFiniteNumber } from '../utils/presentation';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from '../config/maps';
import MapAdapter from '../../../shared/maps/MapAdapter';
import MapUnavailable from '../../../shared/maps/MapUnavailable';
import { isExpoGo } from '../../../shared/maps/mapRuntime';

const asCoordinate = location => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
};

export default function DriverRouteMap({ load }) {
  const mapRef = useRef(null);
  const pickup = asCoordinate(load?.pickup);
  const dropoff = asCoordinate(load?.delivery);
  const coordinates = useMemo(() => {
    if (Array.isArray(load?.routeCoordinates) && load.routeCoordinates.length > 1) return load.routeCoordinates;
    return decodeGooglePolyline(load?.routeEncodedPolyline || load?.encodedPolyline);
  }, [load?.encodedPolyline, load?.routeCoordinates, load?.routeEncodedPolyline]);
  const mapCoordinates = coordinates.length > 1 ? coordinates : [pickup, dropoff].filter(Boolean);

  useEffect(() => {
    if (mapCoordinates.length > 1) mapRef.current?.fitToCoordinates(mapCoordinates, { edgePadding: { top: 48, right: 36, bottom: 48, left: 36 }, animated: false });
  }, [mapCoordinates]);

  if (!pickup || !dropoff) return null;
  const openInMaps = async () => {
    const destination = `${dropoff.latitude},${dropoff.longitude}`;
    const origin = `${pickup.latitude},${pickup.longitude}`;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    } catch (error) {
      if (__DEV__) console.warn('[MAPS] Google Maps link could not be opened.', error?.message);
    }
  };
  return <View style={styles.root}>
    <Text style={styles.title}>Google rota bilgisi</Text>
    <View style={styles.frame}>
      {(isExpoGo || nativeGoogleMapsConfigured) ? <MapAdapter mapRef={mapRef} style={styles.map} initialRegion={{ latitude: pickup.latitude, longitude: pickup.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }} markers={[{ id: 'pickup', coordinate: pickup, pinColor: '#3658cb', title: 'Alınacak konum', description: load.pickup?.address }, { id: 'dropoff', coordinate: dropoff, pinColor: '#ed7a32', title: 'Teslimat konumu', description: load.delivery?.address }]} polylineCoordinates={coordinates} fallback={<MapUnavailable pickup={{ ...pickup, address: load.pickup?.address }} dropoff={{ ...dropoff, address: load.delivery?.address }} distanceLabel={`${toFiniteNumber(load.routeDistanceMeters, toFiniteNumber(load.estimatedKm) * 1000) / 1000} km`} durationLabel={`${Math.round(toFiniteNumber(load.routeDurationSeconds) / 60)} dk`} priceLabel={formatMoney(load.estimatedPrice || load.basePriceTl || load.agreedPriceTl)} />} /> : <MapUnavailable message={nativeGoogleMapsMessage} pickup={{ ...pickup, address: load.pickup?.address }} dropoff={{ ...dropoff, address: load.delivery?.address }} distanceLabel={`${toFiniteNumber(load.routeDistanceMeters, toFiniteNumber(load.estimatedKm) * 1000) / 1000} km`} durationLabel={`${Math.round(toFiniteNumber(load.routeDurationSeconds) / 60)} dk`} priceLabel={formatMoney(load.estimatedPrice || load.basePriceTl || load.agreedPriceTl)} />}
    </View>
    <View style={styles.metrics}><View><Text style={styles.metricLabel}>MESAFE</Text><Text style={styles.metricValue}>{toFiniteNumber(load.routeDistanceMeters, toFiniteNumber(load.estimatedKm) * 1000) / 1000} km</Text></View><View><Text style={styles.metricLabel}>TAHMİNİ SÜRE</Text><Text style={styles.metricValue}>{Math.round(toFiniteNumber(load.routeDurationSeconds) / 60)} dk</Text></View><View><Text style={styles.metricLabel}>TAHMİNİ FİYAT</Text><Text style={styles.metricValue}>{formatMoney(load.estimatedPrice || load.basePriceTl || load.agreedPriceTl)}</Text></View></View>
    <Pressable style={styles.mapsButton} onPress={() => void openInMaps()} accessibilityRole="button" accessibilityLabel="Rotayı Google Haritalar'da aç"><Text style={styles.mapsButtonText}>Google Haritalar’da aç</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { marginTop: 16 }, title: { color: '#25314b', fontSize: 16, fontWeight: '800', marginBottom: 9 }, frame: { borderColor: '#dbe3ef', borderRadius: 14, borderWidth: 1, height: 225, overflow: 'hidden' }, map: { flex: 1 }, nativeMapError: { alignItems: 'center', backgroundColor: '#fff6f4', flex: 1, justifyContent: 'center', padding: 24 }, nativeMapErrorText: { color: '#a74238', fontSize: 13, fontWeight: '800', lineHeight: 20, textAlign: 'center' }, nativeMapErrorHint: { color: '#7a8495', fontSize: 11, lineHeight: 17, marginTop: 7, textAlign: 'center' }, metrics: { backgroundColor: '#eef1ff', borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, padding: 12 }, metricLabel: { color: '#7180ab', fontSize: 9, fontWeight: '800' }, metricValue: { color: '#344bc0', fontSize: 12, fontWeight: '800', marginTop: 4 }, mapsButton: { alignItems: 'center', borderColor: '#cad5fc', borderRadius: 10, borderWidth: 1, marginTop: 10, minHeight: 42, justifyContent: 'center' }, mapsButtonText: { color: '#3658cb', fontSize: 12, fontWeight: '800' },
});
