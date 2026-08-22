import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';

import { maps } from '../services/api';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from '../config/maps';
import MapAdapter from '../../../shared/maps/MapAdapter';
import MapUnavailable from '../../../shared/maps/MapUnavailable';
import Icon from '../../../shared/ui/Icon';
import { useToast } from '../../../shared/ui/feedback';
import { colors, radius, shadows, spacing, typography } from '../../../shared/ui/theme';

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

const AddressField = memo(function AddressField({ accent, active, label, onActivate, onChange, onClear, onSelect, query, search }) {
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
      {search.loading ? <ActivityIndicator color={accent} size="small" /> : query ? <Pressable accessibilityLabel={`${label} seçimini temizle`} hitSlop={9} onPress={onClear}><Icon name="close-circle" size={21} color={colors.textMuted} /></Pressable> : <Icon name="search-outline" size={20} color={colors.textMuted} />}
    </Pressable>
    {active && query.trim().length >= 3 && <View style={styles.suggestions}>
      {search.items.map(item => <Pressable key={item.placeId || item.formattedAddress} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]} onPress={() => void onSelect(item)}>
        <View style={styles.suggestionIcon}><Icon name="location-outline" size={19} color={colors.primary} /></View><View style={styles.suggestionCopy}><Text style={styles.suggestionTitle} numberOfLines={1}>{item.primaryText || item.formattedAddress}</Text>{item.secondaryText || item.primaryText ? <Text style={styles.suggestionSubtitle} numberOfLines={2}>{item.secondaryText || item.formattedAddress}</Text> : null}</View><Icon name="chevron-forward" size={17} color={colors.textMuted} />
      </Pressable>)}
      {!search.loading && search.items.length === 0 ? <View style={styles.searchMessageRow}><Icon name={search.error ? 'cloud-offline-outline' : 'search-outline'} size={18} color={search.error ? colors.danger : colors.textMuted} /><Text style={[styles.searchMessage, search.error && styles.searchError]}>{search.error || 'Bu adres için sonuç bulunamadı.'}</Text></View> : null}
    </View>}
  </View>;
});

export default function RoutePicker({ value, onLocationsChange, onRouteChange }) {
  const { showToast } = useToast();
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
      showToast(mapErrorMessage(error, 'Seçilen konumun açık adresi alınamadı.'), { type: 'error', title: 'Adres alınamadı' });
    }
  }, [showToast, updateLocation]);

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
      showToast(mapErrorMessage(error, 'Adres önerileri alınamadı.'), { type: 'error', title: 'Adres seçilemedi' });
    }
  }, [showToast, updateLocation]);

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
        showToast(permission.canAskAgain ? 'Başlangıç adresini yazarak veya haritadan seçebilirsiniz.' : 'Konum iznini Ayarlar uygulamasından açabilir veya adresi yazarak seçebilirsiniz.', { type: 'warning', title: 'Konum izni verilmedi' });
        return;
      }
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        showToast('GPS/konum servislerini açın veya başlangıç adresini haritadan seçin.', { type: 'warning', title: 'Konum servisleri kapalı' });
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
      showToast(error?.code === 'LOCATION_TIMEOUT' ? 'Konum isteği zaman aşımına uğradı. GPS ayarlarını kontrol edin veya adresi seçin.' : 'Mevcut konumunuza ulaşılamadı. Adresi yazarak veya haritadan seçebilirsiniz.', { type: 'error', title: 'Konum alınamadı' });
    } finally {
      setLocating(false);
    }
  }, [selectCoordinate, showToast]);

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
      <Text style={styles.instruction}>Aktif adresi haritaya dokunarak da seçebilirsiniz.</Text>
      <Pressable style={styles.swapButton} onPress={swapLocations} accessibilityLabel="Başlangıç ve varışı değiştir">
        <Icon name="swap-vertical" size={21} color={colors.primary} />
      </Pressable>
    </View>

    <AddressField
      accent="#3658cb"
      active={pickupFocused}
      label="Yük nereden alınacak?"
      onActivate={() => { setActiveLocationField('pickup'); setPickupFocused(true); setDropoffFocused(false); }}
      onChange={value => editQuery('pickup', value)}
      onClear={() => updateLocation('pickup', null)}
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
      onClear={() => updateLocation('dropoff', null)}
      onSelect={item => selectSuggestion('dropoff', item)}
      query={dropoffQuery}
      search={dropoffSearch}
    />

    <View style={styles.actions}>
      <Pressable style={styles.currentLocationButton} onPress={useCurrentLocation} disabled={locating}>
        {locating ? <ActivityIndicator color={colors.primary} size="small" /> : <><Icon name="locate-outline" size={18} color={colors.primary} /><Text style={styles.currentLocationText}>Konumumu kullan</Text></>}
      </Pressable>
      <Pressable style={styles.clearButton} onPress={clearActiveLocation}>
        <Icon name="trash-outline" size={17} color={colors.textSecondary} /><Text style={styles.clearText}>Temizle</Text>
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

    <View style={styles.routeStatus}><Icon name={route ? 'checkmark-circle' : routeState.includes('hesaplanıyor') ? 'sync-outline' : 'information-circle-outline'} size={18} color={route ? colors.success : colors.primary} /><Text style={styles.routeStatusText}>{routeState}</Text>{routeState === 'Rota hesaplanıyor…' && <ActivityIndicator size="small" color={colors.primary} />}</View>

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
  container: { marginTop: spacing.xxs }, titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, instruction: { ...typography.caption, color: colors.textSecondary, flex: 1, paddingRight: spacing.sm }, swapButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 40, justifyContent: 'center', width: 44 },
  addressField: { marginTop: spacing.sm }, addressInput: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 66, paddingHorizontal: spacing.sm }, locationDot: { borderColor: colors.surface, borderRadius: 8, borderWidth: 3, height: 16, marginRight: spacing.sm, width: 16 }, inputContent: { flex: 1 }, addressLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: 2 }, addressTextInput: { ...typography.body, color: colors.ink, padding: 0 },
  suggestions: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, marginTop: spacing.xs, overflow: 'hidden', ...shadows.card }, suggestion: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 62, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, suggestionIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.xs, height: 36, justifyContent: 'center', marginRight: spacing.sm, width: 36 }, suggestionCopy: { flex: 1 }, suggestionTitle: { ...typography.smallMedium, color: colors.ink }, suggestionSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, pressed: { opacity: .65 }, searchMessageRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, padding: spacing.sm }, searchMessage: { ...typography.small, color: colors.textSecondary, flex: 1 }, searchError: { color: colors.danger },
  actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }, currentLocationButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.xs, minHeight: 42, paddingHorizontal: spacing.sm }, currentLocationText: { ...typography.smallMedium, color: colors.primaryDark }, clearButton: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, minHeight: 42, paddingHorizontal: spacing.xs }, clearText: { ...typography.smallMedium, color: colors.textSecondary },
  mapFrame: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, height: 270, marginTop: spacing.sm, overflow: 'hidden' }, map: { flex: 1 }, nativeMapError: { alignItems: 'center', backgroundColor: colors.dangerSoft, flex: 1, justifyContent: 'center', padding: spacing.xl }, nativeMapErrorText: { ...typography.smallMedium, color: colors.danger, textAlign: 'center' }, nativeMapErrorHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, mapHint: { backgroundColor: 'rgba(19,34,56,.9)', borderRadius: radius.xs, bottom: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, position: 'absolute' }, mapHintText: { ...typography.caption, color: colors.white },
  routeStatus: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, minHeight: 42, paddingHorizontal: spacing.sm }, routeStatusText: { ...typography.small, color: colors.textSecondary, flex: 1 }, priceCard: { backgroundColor: colors.primarySoft, borderColor: '#C9E1DB', borderRadius: radius.lg, borderWidth: 1, marginTop: spacing.sm, padding: spacing.md }, metric: { flex: 1 }, metricLabel: { ...typography.caption, color: colors.textMuted, letterSpacing: .6 }, metricValue: { ...typography.h3, color: colors.primaryDark, marginTop: spacing.xxs }, priceDivider: { borderTopColor: '#C9E1DB', borderTopWidth: 1, marginVertical: spacing.md }, rateValue: { ...typography.bodyMedium, color: colors.text, marginTop: spacing.xxs }, estimateLabel: { ...typography.caption, color: colors.primary, letterSpacing: .8, marginTop: spacing.md }, estimateValue: { ...typography.display, color: colors.primaryDark, marginTop: spacing.xxs }, priceNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
});
