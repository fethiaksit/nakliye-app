import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { maps } from '../services/api';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from '../config/maps';

const DEFAULT_REGION = {
  latitude: 39.05,
  longitude: 35.2,
  latitudeDelta: 7.5,
  longitudeDelta: 7.5,
};

const number = value => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value || 0);
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Math.round(value || 0));
const pointKey = coordinate => `${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`;
const samePoint = (first, second) => Math.abs(first.latitude - second.latitude) < 0.000001 && Math.abs(first.longitude - second.longitude) < 0.000001;

function mapErrorMessage(error, fallback) {
  if (error?.code === 'ECONNABORTED') return 'Rota servisi zamanında yanıt vermedi. Tekrar deneyin.';
  if (!error?.response) return fallback;
  const responseError = error.response.data?.error;
  return typeof responseError === 'string' ? responseError : responseError?.message || fallback;
}

const newPlacesSessionToken = () => `nakliye-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;

function useAddressSearch(query, enabled, sessionToken) {
  const [state, setState] = useState({ loading: false, items: [], error: '' });

  useEffect(() => {
    const normalized = query.trim();
    if (!enabled || normalized.length < 2) {
      setState({ loading: false, items: [], error: '' });
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ loading: true, items: [], error: '' });
      try {
        const items = await maps.autocomplete(normalized, sessionToken, controller.signal);
        if (!controller.signal.aborted) setState({ loading: false, items, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setState({ loading: false, items: [], error: mapErrorMessage(error, 'Adres önerileri alınamadı.') });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, query, sessionToken]);

  return state;
}

const AddressField = memo(function AddressField({ accent, active, label, onActivate, onChange, onSelect, query, search }) {
  return <View style={styles.addressField}>
    <Pressable onPress={onActivate} style={[styles.addressInput, active && { borderColor: accent }]}>
      <View style={[styles.locationDot, { backgroundColor: accent }]} />
      <View style={styles.inputContent}>
        <Text style={styles.addressLabel}>{label}</Text>
        <TextInput
          value={query}
          onFocus={onActivate}
          onChangeText={onChange}
          placeholder="Adres yazın veya haritadan seçin"
          placeholderTextColor="#9aa3b2"
          style={styles.addressTextInput}
          returnKeyType="search"
        />
      </View>
      {search.loading && <ActivityIndicator color={accent} size="small" />}
    </Pressable>
    {active && query.trim().length >= 2 && <View style={styles.suggestions}>
      {search.items.map(item => <Pressable key={item.placeId || item.formattedAddress} style={styles.suggestion} onPress={() => void onSelect(item)}>
        <Text style={styles.suggestionTitle} numberOfLines={2}>{item.formattedAddress}</Text>
      </Pressable>)}
      {!search.loading && search.items.length === 0 && <Text style={styles.searchMessage}>{search.error || 'Bu adres için sonuç bulunamadı.'}</Text>}
    </View>}
  </View>;
});

export default function RoutePicker({ onLocationsChange, onRouteChange }) {
  const mapRef = useRef(null);
  const selectionRef = useRef({ pickup: '', dropoff: '' });
  const placesSessionsRef = useRef({ pickup: newPlacesSessionToken(), dropoff: newPlacesSessionToken() });
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [activeLocationField, setActiveLocationField] = useState('pickup');
  const [pickupQuery, setPickupQuery] = useState('');
  const [dropoffQuery, setDropoffQuery] = useState('');
  const [pickupFocused, setPickupFocused] = useState(false);
  const [dropoffFocused, setDropoffFocused] = useState(false);
  const [route, setRoute] = useState(null);
  const [routeState, setRouteState] = useState('Varış konumunu seçin.');
  const [locating, setLocating] = useState(false);

  const pickupSearch = useAddressSearch(pickupQuery, pickupFocused, placesSessionsRef.current.pickup);
  const dropoffSearch = useAddressSearch(dropoffQuery, dropoffFocused, placesSessionsRef.current.dropoff);

  const setRouteEmpty = useCallback(() => {
    setRoute(null);
    onRouteChange(null);
  }, [onRouteChange]);

  const updateLocation = useCallback((field, location) => {
    const nextPickup = field === 'pickup' ? location : pickupLocation;
    const nextDropoff = field === 'dropoff' ? location : dropoffLocation;
    if (field === 'pickup') {
      setPickupLocation(location);
      setPickupQuery(location?.formattedAddress || '');
      setPickupFocused(false);
    } else {
      setDropoffLocation(location);
      setDropoffQuery(location?.formattedAddress || '');
      setDropoffFocused(false);
    }
    onLocationsChange({ pickup: nextPickup, dropoff: nextDropoff });
    setRouteEmpty();
  }, [dropoffLocation, onLocationsChange, pickupLocation, setRouteEmpty]);

  const selectCoordinate = useCallback(async (field, coordinate) => {
    const selectionKey = pointKey(coordinate);
    selectionRef.current[field] = selectionKey;
    updateLocation(field, { coordinate, formattedAddress: '', resolvingAddress: true });
    try {
      const data = await maps.reverse(coordinate.latitude, coordinate.longitude);
      if (selectionRef.current[field] === selectionKey) {
        updateLocation(field, {
          coordinate,
          formattedAddress: data.formattedAddress,
          placeId: data.placeId,
          resolvingAddress: false,
        });
      }
    } catch (error) {
      if (selectionRef.current[field] === selectionKey) updateLocation(field, { coordinate, formattedAddress: '', resolvingAddress: false, geocodeError: true });
      Alert.alert('Adres alınamadı', mapErrorMessage(error, 'Seçilen konumun açık adresi alınamadı.'));
    }
  }, [updateLocation]);

  const selectSuggestion = useCallback(async (field, item) => {
    try {
      const location = await maps.placeDetails(item.placeId, placesSessionsRef.current[field]);
      const normalized = { coordinate: location.coordinate, formattedAddress: location.formattedAddress, placeId: location.placeId };
      selectionRef.current[field] = pointKey(normalized.coordinate);
      updateLocation(field, normalized);
      placesSessionsRef.current[field] = newPlacesSessionToken();
      mapRef.current?.animateToRegion({ ...normalized.coordinate, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 350);
    } catch (error) {
      Alert.alert('Adres seçilemedi', mapErrorMessage(error, 'Adres önerileri alınamadı.'));
    }
  }, [updateLocation]);

  const pickupLatitude = pickupLocation?.coordinate.latitude;
  const pickupLongitude = pickupLocation?.coordinate.longitude;
  const dropoffLatitude = dropoffLocation?.coordinate.latitude;
  const dropoffLongitude = dropoffLocation?.coordinate.longitude;

  useEffect(() => {
    if (!pickupLocation && !dropoffLocation) {
      setRouteState('Önce başlangıç, sonra varış konumunu seçin.');
      return undefined;
    }
    if (!pickupLocation) {
      setRouteState('Başlangıç konumunu seçin.');
      return undefined;
    }
    if (!dropoffLocation) {
      setRouteState('Varış konumunu seçin.');
      return undefined;
    }
    if (pickupLocation.resolvingAddress || dropoffLocation.resolvingAddress) {
      setRouteState('Adres bilgisi alınıyor…');
      return undefined;
    }
    if (pickupLocation.geocodeError || dropoffLocation.geocodeError) {
      setRouteState('Seçilen konumun adresi Google’dan alınamadı. Tekrar deneyin.');
      setRouteEmpty();
      return undefined;
    }
    if (samePoint(pickupLocation.coordinate, dropoffLocation.coordinate)) {
      setRouteState('Başlangıç ve varış konumları aynı olamaz.');
      setRouteEmpty();
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRouteState('Rota hesaplanıyor…');
      try {
        const data = await maps.calculate({
          pickup: pickupLocation.coordinate,
          dropoff: dropoffLocation.coordinate,
        }, controller.signal);
        if (!controller.signal.aborted) {
          setRoute(data);
          onRouteChange(data);
          setRouteState('Gerçek araç rotası hazır.');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setRouteEmpty();
          setRouteState(mapErrorMessage(error, 'Bu iki konum arasındaki rota hesaplanamadı.'));
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dropoffLatitude, dropoffLocation, dropoffLongitude, onRouteChange, pickupLatitude, pickupLocation, pickupLongitude, setRouteEmpty]);

  useEffect(() => {
    if (route?.routeCoordinates?.length > 1) {
      mapRef.current?.fitToCoordinates(route.routeCoordinates, {
        edgePadding: { top: 90, right: 36, bottom: 260, left: 36 },
        animated: true,
      });
    }
  }, [route]);

  const useCurrentLocation = useCallback(async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Konum izni verilmedi', 'Başlangıç adresini yazarak veya haritadan seçebilirsiniz.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setActiveLocationField('pickup');
      await selectCoordinate('pickup', coordinate);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
    } catch {
      Alert.alert('Konum alınamadı', 'Mevcut konumunuza ulaşılamadı. Adresi yazarak veya haritadan seçebilirsiniz.');
    } finally {
      setLocating(false);
    }
  }, [selectCoordinate]);

  const swapLocations = useCallback(() => {
    setPickupLocation(dropoffLocation);
    setDropoffLocation(pickupLocation);
    setPickupQuery(dropoffLocation?.formattedAddress || '');
    setDropoffQuery(pickupLocation?.formattedAddress || '');
    setPickupFocused(false);
    setDropoffFocused(false);
    onLocationsChange({ pickup: dropoffLocation, dropoff: pickupLocation });
    setRouteEmpty();
  }, [dropoffLocation, onLocationsChange, pickupLocation, setRouteEmpty]);

  const clearActiveLocation = useCallback(() => {
    selectionRef.current[activeLocationField] = '';
    updateLocation(activeLocationField, null);
  }, [activeLocationField, updateLocation]);

  return <View style={styles.container}>
    <View style={styles.titleRow}>
      <View>
        <Text style={styles.title}>Nakliye Rotası</Text>
        <Text style={styles.subtitle}>Konumları adresle arayın veya haritada işaretleyin.</Text>
      </View>
      <Pressable style={styles.swapButton} onPress={swapLocations} accessibilityLabel="Başlangıç ve varışı değiştir">
        <Text style={styles.swapText}>⇅</Text>
      </Pressable>
    </View>

    <AddressField
      accent="#3658cb"
      active={pickupFocused}
      label="Yük nereden alınacak?"
      onActivate={() => { setActiveLocationField('pickup'); setPickupFocused(true); setDropoffFocused(false); }}
      onChange={value => { setActiveLocationField('pickup'); setPickupFocused(true); setPickupQuery(value); }}
      onSelect={item => selectSuggestion('pickup', item)}
      query={pickupQuery}
      search={pickupSearch}
    />
    <AddressField
      accent="#ed7a32"
      active={dropoffFocused}
      label="Yük nereye teslim edilecek?"
      onActivate={() => { setActiveLocationField('dropoff'); setDropoffFocused(true); setPickupFocused(false); }}
      onChange={value => { setActiveLocationField('dropoff'); setDropoffFocused(true); setDropoffQuery(value); }}
      onSelect={item => selectSuggestion('dropoff', item)}
      query={dropoffQuery}
      search={dropoffSearch}
    />

    <View style={styles.actions}>
      <Pressable style={styles.currentLocationButton} onPress={useCurrentLocation} disabled={locating}>
        {locating ? <ActivityIndicator color="#3658cb" size="small" /> : <Text style={styles.currentLocationText}>◎ Mevcut konumumu kullan</Text>}
      </Pressable>
      <Pressable style={styles.clearButton} onPress={clearActiveLocation}>
        <Text style={styles.clearText}>Seçimi temizle</Text>
      </Pressable>
    </View>

    <View style={styles.mapFrame}>
		{nativeGoogleMapsConfigured ? <MapView
		ref={mapRef}
		provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        onPress={event => void selectCoordinate(activeLocationField, event.nativeEvent.coordinate)}
        onMapReady={() => route?.routeCoordinates?.length > 1 && mapRef.current?.fitToCoordinates(route.routeCoordinates, { edgePadding: { top: 90, right: 36, bottom: 260, left: 36 }, animated: false })}
      >
        {pickupLocation && <Marker coordinate={pickupLocation.coordinate} pinColor="#3658cb" title="Alınacak konum" description={pickupLocation.formattedAddress} draggable onDragEnd={event => void selectCoordinate('pickup', event.nativeEvent.coordinate)} />}
        {dropoffLocation && <Marker coordinate={dropoffLocation.coordinate} pinColor="#ed7a32" title="Teslimat konumu" description={dropoffLocation.formattedAddress} draggable onDragEnd={event => void selectCoordinate('dropoff', event.nativeEvent.coordinate)} />}
        {route?.routeCoordinates?.length > 1 && <Polyline coordinates={route.routeCoordinates} strokeColor="#2563eb" strokeWidth={5} />}
		</MapView> : <View style={styles.nativeMapError}><Text style={styles.nativeMapErrorText}>{nativeGoogleMapsMessage}</Text><Text style={styles.nativeMapErrorHint}>Yeni development build oluşturduktan sonra tekrar deneyin.</Text></View>}
      <View style={styles.mapHint}><Text style={styles.mapHintText}>Haritaya dokun: {activeLocationField === 'pickup' ? 'başlangıç' : 'varış'} seçiliyor</Text></View>
    </View>

    <View style={styles.routeStatus}><Text style={styles.routeStatusText}>{routeState}</Text>{routeState === 'Rota hesaplanıyor…' && <ActivityIndicator size="small" color="#3658cb" />}</View>

    {route && <View style={styles.priceCard}>
      <View style={styles.metric}><Text style={styles.metricLabel}>MESAFE</Text><Text style={styles.metricValue}>{number(route.distanceKm)} km</Text></View>
      <View style={styles.metric}><Text style={styles.metricLabel}>TAHMİNİ SÜRE</Text><Text style={styles.metricValue}>{Math.round(route.durationMinutes)} dk</Text></View>
      <View style={styles.priceDivider} />
      <Text style={styles.metricLabel}>KİLOMETRE ÜCRETİ</Text>
      <Text style={styles.rateValue}>{number(route.pricePerKm)} TL/km</Text>
      <Text style={styles.estimateLabel}>TAHMİNİ FİYAT</Text>
      <Text style={styles.estimateValue}>{money(route.estimatedPrice)}</Text>
      <Text style={styles.priceNote}>Bu tutar tahmini fiyattır. Yük detaylarına göre değişebilir.</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: '#202b43', fontSize: 17, fontWeight: '800' },
  subtitle: { color: '#7d8798', fontSize: 12, lineHeight: 17, marginTop: 3, maxWidth: 255 },
  swapButton: { alignItems: 'center', backgroundColor: '#eef1ff', borderRadius: 10, height: 38, justifyContent: 'center', width: 42 },
  swapText: { color: '#3658cb', fontSize: 22, fontWeight: '800' },
  addressField: { marginTop: 9 },
  addressInput: { alignItems: 'center', backgroundColor: '#fbfcff', borderColor: '#dfe5ef', borderRadius: 13, borderWidth: 1, flexDirection: 'row', minHeight: 66, paddingHorizontal: 12 },
  locationDot: { borderColor: '#fff', borderRadius: 8, borderWidth: 3, height: 16, marginRight: 10, width: 16 },
  inputContent: { flex: 1 },
  addressLabel: { color: '#657089', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  addressTextInput: { color: '#202b43', fontSize: 14, padding: 0 },
  suggestions: { backgroundColor: '#fff', borderColor: '#e2e7f0', borderRadius: 12, borderWidth: 1, marginTop: 5, overflow: 'hidden' },
  suggestion: { borderBottomColor: '#eff2f6', borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  suggestionTitle: { color: '#35415a', fontSize: 13, lineHeight: 18 },
  searchMessage: { color: '#7d8798', fontSize: 12, padding: 13 },
  actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  currentLocationButton: { alignItems: 'center', backgroundColor: '#eef1ff', borderRadius: 10, flexDirection: 'row', minHeight: 38, paddingHorizontal: 12 },
  currentLocationText: { color: '#3658cb', fontSize: 12, fontWeight: '800' },
  clearButton: { paddingHorizontal: 5, paddingVertical: 9 },
  clearText: { color: '#7d8798', fontSize: 12, fontWeight: '700' },
  mapFrame: { borderColor: '#dbe3ef', borderRadius: 16, borderWidth: 1, height: 270, marginTop: 12, overflow: 'hidden' },
  map: { flex: 1 }, nativeMapError: { alignItems: 'center', backgroundColor: '#fff6f4', flex: 1, justifyContent: 'center', padding: 24 }, nativeMapErrorText: { color: '#a74238', fontSize: 13, fontWeight: '800', lineHeight: 20, textAlign: 'center' }, nativeMapErrorHint: { color: '#7a8495', fontSize: 11, lineHeight: 17, marginTop: 7, textAlign: 'center' },
  mapHint: { backgroundColor: '#202b43df', borderRadius: 8, bottom: 12, left: 12, paddingHorizontal: 10, paddingVertical: 7, position: 'absolute' },
  mapHintText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  routeStatus: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 35, paddingHorizontal: 2 },
  routeStatusText: { color: '#657089', flex: 1, fontSize: 12 },
  priceCard: { backgroundColor: '#eef1ff', borderColor: '#dce3ff', borderRadius: 16, borderWidth: 1, marginTop: 2, padding: 16 },
  metric: { flex: 1 },
  metricLabel: { color: '#7581a4', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  metricValue: { color: '#263a85', fontSize: 16, fontWeight: '800', marginTop: 4 },
  priceDivider: { borderTopColor: '#d7def9', borderTopWidth: 1, marginVertical: 14 },
  rateValue: { color: '#35415a', fontSize: 14, fontWeight: '800', marginTop: 3 },
  estimateLabel: { color: '#526cc9', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 15 },
  estimateValue: { color: '#273dbe', fontSize: 28, fontWeight: '900', marginTop: 3 },
  priceNote: { color: '#7581a4', fontSize: 11, lineHeight: 16, marginTop: 8 },
});
