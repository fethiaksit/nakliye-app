import React, { useEffect, useMemo, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { decodeGooglePolyline } from '../utils/polyline';
import { formatMoney, toFiniteNumber } from '../utils/presentation';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from '../config/maps';
import MapAdapter from '../../../shared/maps/MapAdapter';
import MapUnavailable from '../../../shared/maps/MapUnavailable';
import Icon from '../../../shared/ui/Icon';
import { useToast } from '../../../shared/ui/feedback';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';

const asCoordinate = location => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
};

export default function DriverRouteMap({ load }) {
  const { showToast } = useToast();
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
      showToast('Google Haritalar bağlantısı açılamadı.', { type: 'error' });
    }
  };
  return <View style={styles.root}>
    <View style={styles.titleRow}><View style={styles.titleIcon}><Icon name="map-outline" size={20} color={colors.primary} /></View><Text style={styles.title}>Rota bilgisi</Text></View>
    <View style={styles.frame}>
      {nativeGoogleMapsConfigured ? <MapAdapter mapRef={mapRef} style={styles.map} initialRegion={{ latitude: pickup.latitude, longitude: pickup.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }} markers={[{ id: 'pickup', coordinate: pickup, pinColor: '#3658cb', title: 'Alınacak konum', description: load.pickup?.address }, { id: 'dropoff', coordinate: dropoff, pinColor: '#ed7a32', title: 'Teslimat konumu', description: load.delivery?.address }]} polylineCoordinates={coordinates} fallback={<MapUnavailable pickup={{ ...pickup, address: load.pickup?.address }} dropoff={{ ...dropoff, address: load.delivery?.address }} distanceLabel={`${toFiniteNumber(load.routeDistanceMeters, toFiniteNumber(load.estimatedKm) * 1000) / 1000} km`} durationLabel={`${Math.round(toFiniteNumber(load.routeDurationSeconds) / 60)} dk`} priceLabel={formatMoney(load.estimatedPrice || load.basePriceTl || load.agreedPriceTl)} />} /> : <MapUnavailable message={nativeGoogleMapsMessage} pickup={{ ...pickup, address: load.pickup?.address }} dropoff={{ ...dropoff, address: load.delivery?.address }} distanceLabel={`${toFiniteNumber(load.routeDistanceMeters, toFiniteNumber(load.estimatedKm) * 1000) / 1000} km`} durationLabel={`${Math.round(toFiniteNumber(load.routeDurationSeconds) / 60)} dk`} priceLabel={formatMoney(load.estimatedPrice || load.basePriceTl || load.agreedPriceTl)} />}
    </View>
    <View style={styles.metrics}><View><Text style={styles.metricLabel}>MESAFE</Text><Text style={styles.metricValue}>{toFiniteNumber(load.routeDistanceMeters, toFiniteNumber(load.estimatedKm) * 1000) / 1000} km</Text></View><View><Text style={styles.metricLabel}>TAHMİNİ SÜRE</Text><Text style={styles.metricValue}>{Math.round(toFiniteNumber(load.routeDurationSeconds) / 60)} dk</Text></View><View><Text style={styles.metricLabel}>TAHMİNİ FİYAT</Text><Text style={styles.metricValue}>{formatMoney(load.estimatedPrice || load.basePriceTl || load.agreedPriceTl)}</Text></View></View>
    <Pressable style={styles.mapsButton} onPress={() => void openInMaps()} accessibilityRole="button" accessibilityLabel="Rotayı Google Haritalar'da aç"><Icon name="open-outline" size={17} color={colors.primary} /><Text style={styles.mapsButtonText}>Google Haritalar’da aç</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.md }, titleRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.sm }, titleIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginRight: spacing.sm, width: 38 }, title: { ...typography.h3, color: colors.ink }, frame: { borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, height: 225, overflow: 'hidden' }, map: { flex: 1 }, nativeMapError: { alignItems: 'center', backgroundColor: colors.dangerSoft, flex: 1, justifyContent: 'center', padding: spacing.xl }, nativeMapErrorText: { ...typography.smallMedium, color: colors.danger, textAlign: 'center' }, nativeMapErrorHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, metrics: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, padding: spacing.sm }, metricLabel: { ...typography.caption, color: colors.textMuted }, metricValue: { ...typography.smallMedium, color: colors.primaryDark, marginTop: spacing.xxs }, mapsButton: { alignItems: 'center', borderColor: '#C9E1DB', borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, minHeight: 42, justifyContent: 'center' }, mapsButtonText: { ...typography.smallMedium, color: colors.primaryDark },
});
