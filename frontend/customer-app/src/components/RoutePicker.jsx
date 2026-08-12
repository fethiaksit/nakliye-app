import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';

import { maps } from '../services/api';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from '../config/maps';
import MapAdapter from '../../../shared/maps/MapAdapter';
import MapUnavailable from '../../../shared/maps/MapUnavailable';

const { isLatestLocationRequest, updateLocationDraft } = require('../utils/locationSelection.cjs');

const DEFAULT_REGION = {
  latitude: 39.05,
  longitude: 35.2,
  latitudeDelta: 7.5,
  longitudeDelta: 7.5,
};

const number = value => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value || 0);
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Math.round(value || 0));
const samePoint = (first, second) => Math.abs(first.latitude - second.latitude) < 0.000001 && Math.abs(first.longitude - second.longitude) < 0.000001;
const fallbackLocation = location => location ? { ...location.coordinate, address: location.formattedAddress } : null;

function mapErrorMessage(error, fallback) {
  if (error?.code === 'ECONNABORTED') return 'Harita servisi zamanında yanıt vermedi. Tekrar deneyin.';
  if (!error?.response) return error?.request || error?.code === 'ERR_NETWORK' ? 'Harita servisine ulaşılamadı. İnternet bağlantınızı kontrol edin.' : fallback;
  const responseError = error.response.data?.error;
  const code = responseError?.code;
  if (code === 'MAPS_TIMEOUT') return 'Adres servisi zamanında yanıt vermedi. Tekrar deneyin.';
  if (code === 'MAPS_NETWORK_ERROR') return 'Adres servisine ulaşılamadı. İnternet bağlantınızı kontrol edin.';
  if (code === 'MAPS_ZERO_RESULTS') return 'Bu konum için açık adres bulunamadı. Konumu tekrar seçin.';
  if (code === 'MAPS_RESOURCE_EXHAUSTED') return 'Adres servisi kullanım sınırına ulaştı. Lütfen daha sonra tekrar deneyin.';
  if (code === 'MAPS_INVALID_REQUEST') return 'Adres isteği doğrulanamadı. Konumu tekrar seçin.';
  if (code === 'MAPS_PERMISSION_DENIED' || code === 'MAPS_NOT_CONFIGURED') return 'Adres servisi şu anda kullanılamıyor.';
  return typeof responseError === 'string' ? responseError : responseError?.message || fallback;
}

const newPlacesSessionToken = () => `nakliye-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;

function useAddressSearch(query, enabled, sessionToken, locationBias) {
  const [state, setState] = useState({ loading: false, items: [], error: '' });

  useEffect(() => {
    const normalized = query.trim();
    if (!enabled || normalized.length < 3) {
      setState({ loading: false, items: [], error: '' });
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ loading: true, items: [], error: '' });
      try {
        const items = await maps.autocomplete(normalized, sessionToken, controller.signal, locationBias);
        if (!controller.signal.aborted) setState({ loading: false, items, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setState({ loading: false, items: [], error: mapErrorMessage(error, 'Adres önerileri alınamadı.') });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, locationBias?.latitude, locationBias?.longitude, query, sessionToken]);

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
    {active && query.trim().length >= 3 && <View style={styles.suggestions}>
      {search.items.map(item => <Pressable key={item.placeId || item.formattedAddress} style={styles.suggestion} onPress={() => void onSelect(item)}>
        <Text style={styles.suggestionTitle} numberOfLines={2}>{item.formattedAddress}</Text>
      </Pressable>)}
      {!search.loading && search.items.length === 0 && <Text style={styles.searchMessage}>{search.error || 'Bu adres için sonuç bulunamadı.'}</Text>}
    </View>}
  </View>;
});

export default function RoutePicker({ value, onLocationsChange, onRouteChange }) {
  const mapRef = useRef(null);
  const requestSequenceRef = useRef({ pickup: 0, dropoff: 0 });
  const reverseControllersRef = useRef({ pickup: null, dropoff: null });
  const detailsControllersRef = useRef({ pickup: null, dropoff: null });
  const locationsRef = useRef({ pickup: value?.pickup || null, dropoff: value?.dropoff || null });
  const placesSessionsRef = useRef({ pickup: newPlacesSessionToken(), dropoff: newPlacesSessionToken() });
  const [pickupLocation, setPickupLocation] = useState(value?.pickup || null);
  const [dropoffLocation, setDropoffLocation] = useState(value?.dropoff || null);
  const [activeLocationField, setActiveLocationField] = useState('pickup');
  const [pickupQuery, setPickupQuery] = useState(value?.pickup?.formattedAddress || '');
  const [dropoffQuery, setDropoffQuery] = useState(value?.dropoff?.formattedAddress || '');
  const [pickupFocused, setPickupFocused] = useState(false);
  const [dropoffFocused, setDropoffFocused] = useState(false);
  const [route, setRoute] = useState(value?.route || null);
  const [routeState, setRouteState] = useState(value?.route ? 'Gerçek araç rotası hazır.' : 'Varış konumunu seçin.');
  const [locating, setLocating] = useState(false);
  const [locationBias, setLocationBias] = useState(value?.pickup?.coordinate || value?.dropoff?.coordinate || null);

  const pickupSearch = useAddressSearch(pickupQuery, pickupFocused, placesSessionsRef.current.pickup, locationBias);
  const dropoffSearch = useAddressSearch(dropoffQuery, dropoffFocused, placesSessionsRef.current.dropoff, locationBias);

  useEffect(() => () => {
    reverseControllersRef.current.pickup?.abort();
    reverseControllersRef.current.dropoff?.abort();
    detailsControllersRef.current.pickup?.abort();
    detailsControllersRef.current.dropoff?.abort();
  }, []);

  useEffect(() => {
    if (value?.pickup === locationsRef.current.pickup && value?.dropoff === locationsRef.current.dropoff) return;
    reverseControllersRef.current.pickup?.abort();
    reverseControllersRef.current.dropoff?.abort();
    detailsControllersRef.current.pickup?.abort();
    detailsControllersRef.current.dropoff?.abort();
    ++requestSequenceRef.current.pickup;
    ++requestSequenceRef.current.dropoff;
    locationsRef.current = { pickup: value?.pickup || null, dropoff: value?.dropoff || null };
    setPickupLocation(value?.pickup || null);
    setDropoffLocation(value?.dropoff || null);
    setPickupQuery(value?.pickup?.formattedAddress || '');
    setDropoffQuery(value?.dropoff?.formattedAddress || '');
    setRoute(value?.route || null);
  }, [value?.dropoff, value?.pickup, value?.route]);

  const setRouteEmpty = useCallback(() => {
    setRoute(null);
    onRouteChange(null);
  }, [onRouteChange]);

  const updateLocation = useCallback((field, location) => {
    const nextLocations = updateLocationDraft(locationsRef.current, field, location);
    locationsRef.current = nextLocations;
    if (field === 'pickup') {
      setPickupLocation(location);
      setPickupQuery(location?.formattedAddress || '');
      setPickupFocused(false);
    } else {
      setDropoffLocation(location);
      setDropoffQuery(location?.formattedAddress || '');
      setDropoffFocused(false);
    }
    onLocationsChange(nextLocations);
    setRouteEmpty();
  }, [onLocationsChange, setRouteEmpty]);

  const selectCoordinate = useCallback(async (field, coordinate) => {
    reverseControllersRef.current[field]?.abort();
    detailsControllersRef.current[field]?.abort();
    const controller = new AbortController();
    reverseControllersRef.current[field] = controller;
    const sequence = ++requestSequenceRef.current[field];
    setLocationBias(coordinate);
    updateLocation(field, { coordinate, formattedAddress: '', resolvingAddress: true });
    try {
      const data = await maps.reverse(coordinate.latitude, coordinate.longitude, controller.signal);
      if (!controller.signal.aborted && isLatestLocationRequest(requestSequenceRef.current, field, sequence)) {
        const address = { ...data };
        delete address.coordinate;
        updateLocation(field, {
          ...address,
          coordinate,
          resolvingAddress: false,
        });
      }
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'ERR_CANCELED') return;
      if (isLatestLocationRequest(requestSequenceRef.current, field, sequence)) updateLocation(field, { coordinate, formattedAddress: '', resolvingAddress: false, geocodeError: true });
      Alert.alert('Adres alınamadı', mapErrorMessage(error, 'Seçilen konumun açık adresi alınamadı.'));
    }
  }, [updateLocation]);

  const selectSuggestion = useCallback(async (field, item) => {
    reverseControllersRef.current[field]?.abort();
    detailsControllersRef.current[field]?.abort();
    const controller = new AbortController();
    detailsControllersRef.current[field] = controller;
    const sequence = ++requestSequenceRef.current[field];
    try {
      const location = await maps.placeDetails(item.placeId, placesSessionsRef.current[field], controller.signal);
      if (controller.signal.aborted || !isLatestLocationRequest(requestSequenceRef.current, field, sequence)) return;
      const normalized = { ...location, coordinate: location.coordinate, formattedAddress: location.formattedAddress, placeId: location.placeId };
      updateLocation(field, normalized);
      setLocationBias(normalized.coordinate);
      placesSessionsRef.current[field] = newPlacesSessionToken();
      mapRef.current?.animateToRegion({ ...normalized.coordinate, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 350);
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'ERR_CANCELED') return;
      Alert.alert('Adres seçilemedi', mapErrorMessage(error, 'Adres önerileri alınamadı.'));
    }
  }, [updateLocation]);

  const editQuery = useCallback((field, query) => {
    reverseControllersRef.current[field]?.abort();
    detailsControllersRef.current[field]?.abort();
    ++requestSequenceRef.current[field];
    const nextLocations = updateLocationDraft(locationsRef.current, field, null);
    locationsRef.current = nextLocations;
    if (field === 'pickup') {
      setPickupLocation(null);
      setPickupQuery(query);
      setPickupFocused(true);
      setDropoffFocused(false);
    } else {
      setDropoffLocation(null);
      setDropoffQuery(query);
      setDropoffFocused(true);
      setPickupFocused(false);
    }
    setActiveLocationField(field);
    onLocationsChange(nextLocations);
    setRouteEmpty();
  }, [onLocationsChange, setRouteEmpty]);

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
      setRouteState('Seçilen konumun açık adresi alınamadı. Tekrar deneyin.');
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
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted' && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Konum izni verilmedi', permission.canAskAgain ? 'Başlangıç adresini yazarak veya haritadan seçebilirsiniz.' : 'Konum iznini Ayarlar uygulamasından açabilir veya adresi yazarak seçebilirsiniz.');
        return;
      }
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert('Konum servisleri kapalı', 'GPS/konum servislerini açın veya başlangıç adresini haritadan seçin.');
        return;
      }
      const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Konum isteği zaman aşımına uğradı.'), { code: 'LOCATION_TIMEOUT' })), 12000));
      let position;
      try {
        position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
      } catch (error) {
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 500 });
        if (!lastKnown) throw error;
        position = lastKnown;
      }
      const coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setActiveLocationField('pickup');
      setLocationBias(coordinate);
      await selectCoordinate('pickup', coordinate);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
    } catch (error) {
      if (__DEV__) console.warn('[LOCATION] Current location could not be obtained.', { code: error?.code, message: error?.message });
      Alert.alert('Konum alınamadı', error?.code === 'LOCATION_TIMEOUT' ? 'Konum isteği zaman aşımına uğradı. GPS ayarlarını kontrol edin veya adresi seçin.' : 'Mevcut konumunuza ulaşılamadı. Adresi yazarak veya haritadan seçebilirsiniz.');
    } finally {
      setLocating(false);
    }
  }, [selectCoordinate]);

  const swapLocations = useCallback(() => {
    reverseControllersRef.current.pickup?.abort();
    reverseControllersRef.current.dropoff?.abort();
    detailsControllersRef.current.pickup?.abort();
    detailsControllersRef.current.dropoff?.abort();
    ++requestSequenceRef.current.pickup;
    ++requestSequenceRef.current.dropoff;
    setPickupLocation(dropoffLocation);
    setDropoffLocation(pickupLocation);
    setPickupQuery(dropoffLocation?.formattedAddress || '');
    setDropoffQuery(pickupLocation?.formattedAddress || '');
    setPickupFocused(false);
    setDropoffFocused(false);
    const nextLocations = { pickup: dropoffLocation, dropoff: pickupLocation };
    locationsRef.current = nextLocations;
    onLocationsChange(nextLocations);
    setRouteEmpty();
  }, [dropoffLocation, onLocationsChange, pickupLocation, setRouteEmpty]);

  const clearActiveLocation = useCallback(() => {
    reverseControllersRef.current[activeLocationField]?.abort();
    detailsControllersRef.current[activeLocationField]?.abort();
    ++requestSequenceRef.current[activeLocationField];
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
      onChange={value => editQuery('pickup', value)}
      onSelect={item => selectSuggestion('pickup', item)}
      query={pickupQuery}
      search={pickupSearch}
    />
    <AddressField
      accent="#ed7a32"
      active={dropoffFocused}
      label="Yük nereye teslim edilecek?"
      onActivate={() => { setActiveLocationField('dropoff'); setDropoffFocused(true); setPickupFocused(false); }}
      onChange={value => editQuery('dropoff', value)}
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
      {nativeGoogleMapsConfigured ? <MapAdapter
        mapRef={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        onRegionChangeComplete={region => { if (region.latitudeDelta < 2 && region.longitudeDelta < 2) setLocationBias({ latitude: region.latitude, longitude: region.longitude }); }}
        onPress={event => void selectCoordinate(activeLocationField, event.nativeEvent.coordinate)}
        onMapReady={() => route?.routeCoordinates?.length > 1 && mapRef.current?.fitToCoordinates(route.routeCoordinates, { edgePadding: { top: 90, right: 36, bottom: 260, left: 36 }, animated: false })}
        markers={[
          pickupLocation ? { id: 'pickup', coordinate: pickupLocation.coordinate, pinColor: '#3658cb', title: 'Alınacak konum', description: pickupLocation.formattedAddress, draggable: true, onDragEnd: event => void selectCoordinate('pickup', event.nativeEvent.coordinate) } : null,
          dropoffLocation ? { id: 'dropoff', coordinate: dropoffLocation.coordinate, pinColor: '#ed7a32', title: 'Teslimat konumu', description: dropoffLocation.formattedAddress, draggable: true, onDragEnd: event => void selectCoordinate('dropoff', event.nativeEvent.coordinate) } : null,
        ]}
        polylineCoordinates={route?.routeCoordinates}
        fallback={<MapUnavailable pickup={fallbackLocation(pickupLocation)} dropoff={fallbackLocation(dropoffLocation)} distanceLabel={route ? `${number(route.distanceKm)} km` : ''} durationLabel={route ? `${Math.round(route.durationMinutes)} dk` : ''} priceLabel={route ? money(route.estimatedPrice) : ''} />}
      /> : <MapUnavailable message={nativeGoogleMapsMessage} pickup={fallbackLocation(pickupLocation)} dropoff={fallbackLocation(dropoffLocation)} distanceLabel={route ? `${number(route.distanceKm)} km` : ''} durationLabel={route ? `${Math.round(route.durationMinutes)} dk` : ''} priceLabel={route ? money(route.estimatedPrice) : ''} />}
      {nativeGoogleMapsConfigured ? <View style={styles.mapHint}><Text style={styles.mapHintText}>Haritaya dokun: {activeLocationField === 'pickup' ? 'başlangıç' : 'varış'} seçiliyor</Text></View> : null}
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
