import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';

import { maps } from '../../services/api';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from '../../config/maps';
import MapAdapter from '../../../../shared/maps/MapAdapter';
import MapUnavailable from '../../../../shared/maps/MapUnavailable';
import Icon from '../../../../shared/ui/Icon';
import { useToast } from '../../../../shared/ui/feedback';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { STOP_TYPE_OPTIONS } from '../../../../shared/loadMetadata';

const DEFAULT_REGION = {
  latitude: 39.05,
  longitude: 35.2,
  latitudeDelta: 7.5,
  longitudeDelta: 7.5,
};

const number = value => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value || 0);
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Math.round(value || 0));
const samePoint = (first, second) => first && second && Math.abs(first.latitude - second.latitude) < 0.000001 && Math.abs(first.longitude - second.longitude) < 0.000001;
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
    const normalized = (query || '').trim();
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

const AddressField = memo(function AddressField({ accent, active, label, onActivate, onChange, onClear, onSelect, query, search, placeholder }) {
  return (
    <View style={styles.addressField}>
      <Pressable onPress={onActivate} style={[styles.addressInput, active && { borderColor: accent }]}>
        <View style={[styles.locationDot, { backgroundColor: accent }]} />
        <View style={styles.inputContent}>
          <Text style={styles.addressLabel}>{label}</Text>
          <TextInput
            value={query}
            onFocus={onActivate}
            onChangeText={onChange}
            placeholder={placeholder || 'Adres yazın veya haritadan seçin'}
            placeholderTextColor="#9aa3b2"
            style={styles.addressTextInput}
            returnKeyType="search"
          />
        </View>
        {search?.loading ? (
          <ActivityIndicator color={accent} size="small" />
        ) : query ? (
          <Pressable accessibilityLabel={`${label} seçimini temizle`} hitSlop={9} onPress={onClear}>
            <Icon name="close-circle" size={21} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Icon name="search-outline" size={20} color={colors.textMuted} />
        )}
      </Pressable>
      {active && (query || '').trim().length >= 3 && (
        <View style={styles.suggestions}>
          {search?.items?.map(item => (
            <Pressable
              key={item.placeId || item.formattedAddress}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              onPress={() => void onSelect(item)}
            >
              <View style={styles.suggestionIcon}>
                <Icon name="location-outline" size={19} color={colors.primary} />
              </View>
              <View style={styles.suggestionCopy}>
                <Text style={styles.suggestionTitle} numberOfLines={1}>
                  {item.primaryText || item.formattedAddress}
                </Text>
                {item.secondaryText || item.primaryText ? (
                  <Text style={styles.suggestionSubtitle} numberOfLines={2}>
                    {item.secondaryText || item.formattedAddress}
                  </Text>
                ) : null}
              </View>
              <Icon name="chevron-forward" size={17} color={colors.textMuted} />
            </Pressable>
          ))}
          {!search?.loading && search?.items?.length === 0 ? (
            <View style={styles.searchMessageRow}>
              <Icon
                name={search.error ? 'cloud-offline-outline' : 'search-outline'}
                size={18}
                color={search.error ? colors.danger : colors.textMuted}
              />
              <Text style={[styles.searchMessage, search.error && styles.searchError]}>
                {search.error || 'Bu adres için sonuç bulunamadı.'}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
});

export default function RouteStep({
  value,
  routeDraft,
  onRouteDraftChange,
  onLocationsChange,
  onRouteChange,
  errors = {},
}) {
  const { showToast } = useToast();
  const mapRef = useRef(null);

  const currentDraft = routeDraft || value || {};
  const pickupLocation = currentDraft.pickup || null;
  const dropoffLocation = currentDraft.dropoff || null;
  const stops = Array.isArray(currentDraft.stops) ? currentDraft.stops : [];
  const route = currentDraft.route || null;

  const [activeField, setActiveField] = useState('pickup'); // 'pickup' | 'dropoff' | 'stop_0' | 'stop_1'...
  const [pickupQuery, setPickupQuery] = useState(pickupLocation?.formattedAddress || pickupLocation?.address || '');
  const [dropoffQuery, setDropoffQuery] = useState(dropoffLocation?.formattedAddress || dropoffLocation?.address || '');
  const [stopQueries, setStopQueries] = useState(() => stops.map(s => s.address || ''));
  const [locationBias, setLocationBias] = useState(pickupLocation?.coordinate || dropoffLocation?.coordinate || null);
  const [locating, setLocating] = useState(false);
  const [routeState, setRouteState] = useState(route ? 'Güzergah rotası hazır.' : 'Başlangıç ve varış konumlarını seçin.');

  const lastCalculatedCoordsRef = useRef('');
  const draftRef = useRef(currentDraft);
  draftRef.current = currentDraft;

  const notifyDraft = useCallback(nextDraft => {
    if (onRouteDraftChange) {
      onRouteDraftChange(nextDraft);
    }
    if (onLocationsChange) {
      onLocationsChange({
        pickup: nextDraft.pickup,
        dropoff: nextDraft.dropoff,
        stops: nextDraft.stops,
      });
    }
    if (onRouteChange && nextDraft.route !== undefined) {
      onRouteChange(nextDraft.route);
    }
  }, [onLocationsChange, onRouteChange, onRouteDraftChange]);

  const sessionTokens = useRef({
    pickup: newPlacesSessionToken(),
    dropoff: newPlacesSessionToken(),
    stops: [newPlacesSessionToken(), newPlacesSessionToken(), newPlacesSessionToken(), newPlacesSessionToken(), newPlacesSessionToken()],
  });

  const isFocused = field => activeField === field;

  const pickupSearch = useAddressSearch(pickupQuery, isFocused('pickup'), sessionTokens.current.pickup, locationBias);
  const dropoffSearch = useAddressSearch(dropoffQuery, isFocused('dropoff'), sessionTokens.current.dropoff, locationBias);

  // Active stop search
  const activeStopIndex = activeField.startsWith('stop_') ? Number(activeField.split('_')[1]) : -1;
  const activeStopQuery = activeStopIndex >= 0 ? stopQueries[activeStopIndex] || '' : '';
  const activeStopSearch = useAddressSearch(
    activeStopQuery,
    activeStopIndex >= 0,
    sessionTokens.current.stops[activeStopIndex] || sessionTokens.current.pickup,
    locationBias
  );

  const pickupAddress = pickupLocation?.formattedAddress || pickupLocation?.address || '';
  useEffect(() => {
    if (activeField !== 'pickup') {
      setPickupQuery(pickupAddress);
    }
  }, [activeField, pickupAddress]);

  const dropoffAddress = dropoffLocation?.formattedAddress || dropoffLocation?.address || '';
  useEffect(() => {
    if (activeField !== 'dropoff') {
      setDropoffQuery(dropoffAddress);
    }
  }, [activeField, dropoffAddress]);

  const stopsKey = stops.map(s => `${s.placeId || ''}_${s.coordinate?.latitude || ''}_${s.coordinate?.longitude || ''}_${s.address || ''}_${s.stopType || ''}_${s.note || ''}`).join('|');
  useEffect(() => {
    const nextQueries = stops.map(s => s.address || '');
    setStopQueries(prev => {
      if (prev.length === nextQueries.length && prev.every((q, i) => q === nextQueries[i])) {
        return prev;
      }
      return nextQueries;
    });
  }, [stopsKey]);

  // Recalculate route whenever location coordinates change
  const pickupLat = pickupLocation?.coordinate?.latitude;
  const pickupLng = pickupLocation?.coordinate?.longitude;
  const dropoffLat = dropoffLocation?.coordinate?.latitude;
  const dropoffLng = dropoffLocation?.coordinate?.longitude;
  const stopsCoordKey = stops.map(s => s.coordinate ? `${s.coordinate.latitude},${s.coordinate.longitude}` : 'missing').join(';');
  const routeCoordsKey = (pickupLat && pickupLng && dropoffLat && dropoffLng)
    ? `${pickupLat},${pickupLng}->${stopsCoordKey || 'none'}->${dropoffLat},${dropoffLng}`
    : '';

  useEffect(() => {
    if (!pickupLocation || !dropoffLocation) {
      setRouteState('Önce başlangıç ve varış konumlarını seçin.');
      lastCalculatedCoordsRef.current = '';
      return undefined;
    }
    for (let i = 0; i < stops.length; i++) {
      if (!stops[i].coordinate || !stops[i].address) {
        setRouteState(`${i + 1}. ara durak adresini belirleyin.`);
        lastCalculatedCoordsRef.current = '';
        return undefined;
      }
    }

    if (lastCalculatedCoordsRef.current === routeCoordsKey && route !== null) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRouteState('Rota hesaplanıyor…');
      try {
        const intermediateCoords = stops.map(s => s.coordinate).filter(Boolean);
        const data = await maps.calculate({
          pickup: pickupLocation.coordinate,
          dropoff: dropoffLocation.coordinate,
          intermediates: intermediateCoords,
          stops: intermediateCoords,
        }, controller.signal);

        if (!controller.signal.aborted) {
          lastCalculatedCoordsRef.current = routeCoordsKey;
          notifyDraft({
            ...draftRef.current,
            route: data,
          });
          setRouteState('Güzergah rotası hazır.');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          lastCalculatedCoordsRef.current = '';
          notifyDraft({
            ...draftRef.current,
            route: null,
          });
          setRouteState(mapErrorMessage(error, 'Bu duraklar arasındaki rota hesaplanamadı.'));
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dropoffLocation, notifyDraft, pickupLocation, route, routeCoordsKey, stops]);

  // Fit map to coordinates
  useEffect(() => {
    if (route?.routeCoordinates?.length > 1) {
      mapRef.current?.fitToCoordinates(route.routeCoordinates, {
        edgePadding: { top: 80, right: 36, bottom: 200, left: 36 },
        animated: true,
      });
    }
  }, [route]);

  const handleSelectSuggestion = useCallback(async (field, item) => {
    try {
      const isStop = field.startsWith('stop_');
      const stopIndex = isStop ? Number(field.split('_')[1]) : -1;
      const sessionToken = isStop
        ? (sessionTokens.current.stops[stopIndex] || sessionTokens.current.pickup)
        : sessionTokens.current[field];

      const location = await maps.placeDetails(item.placeId, sessionToken);
      const normalized = {
        ...location,
        coordinate: location.coordinate,
        formattedAddress: location.formattedAddress,
        placeId: location.placeId,
      };

      setLocationBias(normalized.coordinate);
      mapRef.current?.animateToRegion({ ...normalized.coordinate, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 350);

      const latestDraft = draftRef.current;
      if (field === 'pickup') {
        setPickupQuery(normalized.formattedAddress);
        notifyDraft({ ...latestDraft, pickup: normalized, route: null });
        sessionTokens.current.pickup = newPlacesSessionToken();
      } else if (field === 'dropoff') {
        setDropoffQuery(normalized.formattedAddress);
        notifyDraft({ ...latestDraft, dropoff: normalized, route: null });
        sessionTokens.current.dropoff = newPlacesSessionToken();
      } else if (isStop) {
        const nextStops = [...(latestDraft.stops || [])];
        nextStops[stopIndex] = {
          ...nextStops[stopIndex],
          address: normalized.formattedAddress,
          coordinate: normalized.coordinate,
          placeId: normalized.placeId,
        };
        const nextQueries = [...stopQueries];
        nextQueries[stopIndex] = normalized.formattedAddress;
        setStopQueries(nextQueries);
        notifyDraft({ ...latestDraft, stops: nextStops, route: null });
        sessionTokens.current.stops[stopIndex] = newPlacesSessionToken();
      }
      setActiveField('');
    } catch (error) {
      showToast(mapErrorMessage(error, 'Adres seçilemedi.'), { type: 'error', title: 'Adres seçimi başarısız' });
    }
  }, [notifyDraft, showToast, stopQueries]);

  const handleMapPress = useCallback(async coordinate => {
    setLocationBias(coordinate);
    try {
      const isStop = activeField.startsWith('stop_');
      const stopIndex = isStop ? Number(activeField.split('_')[1]) : -1;
      const data = await maps.reverse(coordinate.latitude, coordinate.longitude);
      const normalized = { ...data, coordinate, formattedAddress: data.formattedAddress || data.address || '' };

      const latestDraft = draftRef.current;
      if (activeField === 'pickup') {
        setPickupQuery(normalized.formattedAddress);
        notifyDraft({ ...latestDraft, pickup: normalized, route: null });
      } else if (activeField === 'dropoff') {
        setDropoffQuery(normalized.formattedAddress);
        notifyDraft({ ...latestDraft, dropoff: normalized, route: null });
      } else if (isStop && stopIndex >= 0) {
        const nextStops = [...(latestDraft.stops || [])];
        nextStops[stopIndex] = {
          ...nextStops[stopIndex],
          address: normalized.formattedAddress,
          coordinate: normalized.coordinate,
          placeId: normalized.placeId || '',
        };
        const nextQueries = [...stopQueries];
        nextQueries[stopIndex] = normalized.formattedAddress;
        setStopQueries(nextQueries);
        notifyDraft({ ...latestDraft, stops: nextStops, route: null });
      }
    } catch (error) {
      showToast(mapErrorMessage(error, 'Seçilen noktanın adresi alınamadı.'), { type: 'error' });
    }
  }, [activeField, notifyDraft, showToast, stopQueries]);

  const addStop = useCallback(() => {
    const latestDraft = draftRef.current;
    const currentStops = Array.isArray(latestDraft.stops) ? latestDraft.stops : [];
    if (currentStops.length >= 5) {
      showToast('En fazla 5 ara durak ekleyebilirsiniz.', { type: 'warning' });
      return;
    }
    const newStop = {
      id: `stop-${Date.now()}-${currentStops.length}`,
      order: currentStops.length + 1,
      address: '',
      coordinate: null,
      placeId: '',
      stopType: 'pickup', // 'pickup' | 'delivery' | 'both'
      note: '',
    };
    const nextStops = [...currentStops, newStop];
    notifyDraft({ ...latestDraft, stops: nextStops, route: null });
    setActiveField(`stop_${currentStops.length}`);
  }, [notifyDraft, showToast]);

  const removeStop = useCallback(index => {
    const latestDraft = draftRef.current;
    const currentStops = Array.isArray(latestDraft.stops) ? latestDraft.stops : [];
    const nextStops = currentStops.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }));
    const nextQueries = stopQueries.filter((_, i) => i !== index);
    setStopQueries(nextQueries);
    notifyDraft({ ...latestDraft, stops: nextStops, route: null });
    setActiveField(prev => prev === `stop_${index}` ? '' : prev);
  }, [notifyDraft, stopQueries]);

  const moveStop = useCallback((index, delta) => {
    const latestDraft = draftRef.current;
    const currentStops = Array.isArray(latestDraft.stops) ? latestDraft.stops : [];
    const target = index + delta;
    if (target < 0 || target >= currentStops.length) return;
    const nextStops = [...currentStops];
    const temp = nextStops[index];
    nextStops[index] = nextStops[target];
    nextStops[target] = temp;
    nextStops.forEach((s, i) => { s.order = i + 1; });
    const nextQueries = [...stopQueries];
    const tempQ = nextQueries[index];
    nextQueries[index] = nextQueries[target];
    nextQueries[target] = tempQ;
    setStopQueries(nextQueries);
    notifyDraft({ ...latestDraft, stops: nextStops, route: null });
  }, [notifyDraft, stopQueries]);

  const updateStopField = useCallback((index, field, value) => {
    const latestDraft = draftRef.current;
    const currentStops = Array.isArray(latestDraft.stops) ? latestDraft.stops : [];
    const nextStops = [...currentStops];
    nextStops[index] = { ...nextStops[index], [field]: value };
    notifyDraft({ ...latestDraft, stops: nextStops });
  }, [notifyDraft]);

  const swapLocations = useCallback(() => {
    const latestDraft = draftRef.current;
    notifyDraft({
      ...latestDraft,
      pickup: latestDraft.dropoff,
      dropoff: latestDraft.pickup,
      route: null,
    });
    setPickupQuery(latestDraft.dropoff?.formattedAddress || latestDraft.dropoff?.address || '');
    setDropoffQuery(latestDraft.pickup?.formattedAddress || latestDraft.pickup?.address || '');
  }, [notifyDraft]);

  const useCurrentLocation = useCallback(async () => {
    setLocating(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted' && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (permission.status !== 'granted') {
        showToast('Konum izni verilmedi. Adresi manuel arayabilirsiniz.', { type: 'warning' });
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coord = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setLocationBias(coord);
      await handleMapPress(coord);
      mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
    } catch (error) {
      showToast('Mevcut konuma ulaşılamadı. Adresi arayarak seçin.', { type: 'error' });
    } finally {
      setLocating(false);
    }
  }, [handleMapPress, showToast]);

  // Build markers for map
  const markers = [];
  if (pickupLocation?.coordinate) {
    markers.push({
      id: 'pickup',
      coordinate: pickupLocation.coordinate,
      pinColor: '#3658cb',
      title: 'Başlangıç (Çıkış)',
      description: pickupLocation.formattedAddress,
    });
  }
  stops.forEach((stop, index) => {
    if (stop.coordinate) {
      markers.push({
        id: `stop-${index}`,
        coordinate: stop.coordinate,
        pinColor: '#f59e0b',
        title: `Ara Durak ${index + 1}`,
        description: stop.address + (stop.note ? ` (${stop.note})` : ''),
      });
    }
  });
  if (dropoffLocation?.coordinate) {
    markers.push({
      id: 'dropoff',
      coordinate: dropoffLocation.coordinate,
      pinColor: '#ed7a32',
      title: 'Varış (Teslimat)',
      description: dropoffLocation.formattedAddress,
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rota ve Duraklar</Text>
      <Text style={styles.subtitle}>Yükün alınacağı, teslim edileceği ve varsa ara durak noktalarını ekleyin.</Text>

      {errors.pickup || errors.dropoff || errors.route ? (
        <View style={styles.errorBanner}>
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>
            {errors.pickup || errors.dropoff || errors.route}
          </Text>
        </View>
      ) : null}

      <View style={styles.routeHeaderRow}>
        <Text style={styles.sectionLabel}>Güzergah Noktaları</Text>
        <Pressable style={styles.swapBtn} onPress={swapLocations} accessibilityLabel="Başlangıç ve varışı yer değiştir">
          <Icon name="swap-vertical" size={18} color={colors.primary} />
          <Text style={styles.swapBtnText}>Yönü Değiştir</Text>
        </Pressable>
      </View>

      {/* Pickup Field */}
      <AddressField
        accent="#3658cb"
        active={isFocused('pickup')}
        label="1. Başlangıç (Yük Alınacak Adres)"
        query={pickupQuery}
        search={pickupSearch}
        onActivate={() => setActiveField('pickup')}
        onChange={v => { setPickupQuery(v); setActiveField('pickup'); }}
        onClear={() => { setPickupQuery(''); onRouteDraftChange({ ...routeDraft, pickup: null, route: null }); }}
        onSelect={item => handleSelectSuggestion('pickup', item)}
        placeholder="Çıkış adresini arayın veya haritadan seçin"
      />

      {/* Intermediate Stops */}
      {stops.map((stop, index) => {
        const isStopActive = isFocused(`stop_${index}`);
        return (
          <View key={stop.id || `stop-${index}`} style={styles.stopCard}>
            <View style={styles.stopCardHeader}>
              <View style={styles.stopBadge}>
                <Icon name="git-commit-outline" size={16} color="#B45309" />
                <Text style={styles.stopBadgeText}>{`Ara Durak #${index + 1}`}</Text>
              </View>
              <View style={styles.stopCardActions}>
                {index > 0 ? (
                  <Pressable style={styles.reorderBtn} onPress={() => moveStop(index, -1)} hitSlop={6} accessibilityLabel="Yukarı taşı">
                    <Icon name="arrow-up" size={16} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
                {index < stops.length - 1 ? (
                  <Pressable style={styles.reorderBtn} onPress={() => moveStop(index, 1)} hitSlop={6} accessibilityLabel="Aşağı taşı">
                    <Icon name="arrow-down" size={16} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
                <Pressable style={styles.removeStopBtn} onPress={() => removeStop(index)} hitSlop={6} accessibilityLabel="Durağı sil">
                  <Icon name="trash-outline" size={16} color={colors.danger} />
                </Pressable>
              </View>
            </View>

            <AddressField
              accent="#f59e0b"
              active={isStopActive}
              label="Durak Adresi"
              query={stopQueries[index] || ''}
              search={isStopActive ? activeStopSearch : { loading: false, items: [] }}
              onActivate={() => setActiveField(`stop_${index}`)}
              onChange={v => {
                const nextQ = [...stopQueries];
                nextQ[index] = v;
                setStopQueries(nextQ);
                setActiveField(`stop_${index}`);
              }}
              onClear={() => {
                const nextQ = [...stopQueries];
                nextQ[index] = '';
                setStopQueries(nextQ);
                updateStopField(index, 'address', '');
                updateStopField(index, 'coordinate', null);
              }}
              onSelect={item => handleSelectSuggestion(`stop_${index}`, item)}
              placeholder="Ara durak adresini seçin"
            />

            <View style={styles.stopTypeRow}>
              <Text style={styles.stopTypeLabel}>Bu durakta:</Text>
              <View style={styles.stopTypeChips}>
                {STOP_TYPE_OPTIONS.map(opt => {
                  const isSelected = (stop.stopType || 'pickup') === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[styles.stopTypeChip, isSelected && styles.stopTypeChipSelected]}
                      onPress={() => updateStopField(index, 'stopType', opt.value)}
                    >
                      <Text style={[styles.stopTypeChipText, isSelected && styles.stopTypeChipTextSelected]}>
                        {opt.shortLabel || opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextInput
              style={styles.stopNoteInput}
              value={stop.note || ''}
              onChangeText={v => updateStopField(index, 'note', v)}
              placeholder="Durak notu (örn: 2 koltuk alınacak)"
              placeholderTextColor="#9aa3b2"
            />
          </View>
        );
      })}

      {/* Add Stop Button */}
      {stops.length < 5 ? (
        <Pressable style={styles.addStopBtn} onPress={addStop}>
          <Icon name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.addStopBtnText}>+ Ara Durak Ekle ({stops.length}/5)</Text>
        </Pressable>
      ) : null}

      {/* Dropoff Field */}
      <AddressField
        accent="#ed7a32"
        active={isFocused('dropoff')}
        label="Varış (Yük Teslim Edilecek Adres)"
        query={dropoffQuery}
        search={dropoffSearch}
        onActivate={() => setActiveField('dropoff')}
        onChange={v => { setDropoffQuery(v); setActiveField('dropoff'); }}
        onClear={() => { setDropoffQuery(''); onRouteDraftChange({ ...routeDraft, dropoff: null, route: null }); }}
        onSelect={item => handleSelectSuggestion('dropoff', item)}
        placeholder="Teslimat adresini arayın veya haritadan seçin"
      />

      <View style={styles.actionsRow}>
        <Pressable style={styles.actionBtn} onPress={useCurrentLocation} disabled={locating}>
          {locating ? <ActivityIndicator size="small" color={colors.primary} /> : (
            <>
              <Icon name="locate-outline" size={17} color={colors.primary} />
              <Text style={styles.actionBtnText}>Konumumu Kullan</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.activeFieldHint}>
          {activeField === 'pickup'
            ? 'Haritaya dokun: Başlangıç seçiliyor'
            : activeField === 'dropoff'
              ? 'Haritaya dokun: Varış seçiliyor'
              : activeField.startsWith('stop_')
                ? `Haritaya dokun: ${Number(activeField.split('_')[1]) + 1}. durak seçiliyor`
                : 'Haritadan konum seçmek için adrese dokunun'}
        </Text>
      </View>

      {/* Map View */}
      <View style={styles.mapFrame}>
        {nativeGoogleMapsConfigured ? (
          <MapAdapter
            mapRef={mapRef}
            style={styles.map}
            initialRegion={DEFAULT_REGION}
            onPress={event => void handleMapPress(event.nativeEvent.coordinate)}
            markers={markers}
            polylineCoordinates={route?.routeCoordinates}
            fallback={
              <MapUnavailable
                pickup={fallbackLocation(pickupLocation)}
                dropoff={fallbackLocation(dropoffLocation)}
                distanceLabel={route ? `${number(route.distanceKm)} km` : ''}
                durationLabel={route ? `${Math.round(route.durationMinutes)} dk` : ''}
                priceLabel={route ? money(route.estimatedPrice) : ''}
              />
            }
          />
        ) : (
          <MapUnavailable
            message={nativeGoogleMapsMessage}
            pickup={fallbackLocation(pickupLocation)}
            dropoff={fallbackLocation(dropoffLocation)}
            distanceLabel={route ? `${number(route.distanceKm)} km` : ''}
            durationLabel={route ? `${Math.round(route.durationMinutes)} dk` : ''}
            priceLabel={route ? money(route.estimatedPrice) : ''}
          />
        )}
      </View>

      <View style={styles.routeStatus}>
        <Icon
          name={route ? 'checkmark-circle' : routeState.includes('hesaplanıyor') ? 'sync-outline' : 'information-circle-outline'}
          size={18}
          color={route ? colors.success : colors.primary}
        />
        <Text style={styles.routeStatusText}>{routeState}</Text>
        {routeState.includes('hesaplanıyor') ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>

      {/* Price & Route Metric Card */}
      {route ? (
        <View style={styles.priceCard}>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>TOPLAM MESAFE</Text>
              <Text style={styles.metricValue}>{number(route.distanceKm)} km</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>TAHMİNİ SÜRE</Text>
              <Text style={styles.metricValue}>{Math.round(route.durationMinutes)} dk</Text>
            </View>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceBottomRow}>
            <View>
              <Text style={styles.estimateLabel}>KÜÇÜK YÜK İÇİN BAŞLANGIÇ TAHMİNİ</Text>
              <Text style={styles.estimateValue}>{money(route.estimatedPrice)}</Text>
            </View>
            <Text style={styles.priceRate}>{number(route.pricePerKm)} TL/km</Text>
          </View>
          <Text style={styles.priceNote}>Minivan için ilk 5 km tabana dahildir; sonrası km bedeli eklenir. Yük, araç ve hizmetlere göre fiyatı özet adımında görebilirsiniz.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
  },
  title: {
    ...typography.h2,
    color: colors.ink,
    marginBottom: spacing.xxs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  errorBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  errorText: {
    ...typography.small,
    color: colors.danger,
    flex: 1,
  },
  routeHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  swapBtn: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  swapBtnText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  addressField: {
    marginBottom: spacing.sm,
  },
  addressInput: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  locationDot: {
    borderRadius: 7,
    height: 14,
    marginRight: spacing.sm,
    width: 14,
  },
  inputContent: {
    flex: 1,
  },
  addressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  addressTextInput: {
    ...typography.body,
    color: colors.ink,
    padding: 0,
  },
  suggestions: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
    ...shadows.card,
  },
  suggestion: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  suggestionIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.xs,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 32,
  },
  suggestionCopy: {
    flex: 1,
  },
  suggestionTitle: {
    ...typography.smallMedium,
    color: colors.ink,
  },
  suggestionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.65,
  },
  searchMessageRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.md,
  },
  searchMessage: {
    ...typography.small,
    color: colors.textSecondary,
    flex: 1,
  },
  searchError: {
    color: colors.danger,
  },
  stopCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  stopCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  stopBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  stopBadgeText: {
    ...typography.caption,
    color: '#92400E',
    fontWeight: '700',
  },
  stopCardActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  reorderBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  removeStopBtn: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.xs,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stopTypeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  stopTypeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stopTypeChips: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  stopTypeChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  stopTypeChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  stopTypeChipText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stopTypeChipTextSelected: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  stopNoteInput: {
    ...typography.small,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  addStopBtn: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
  },
  addStopBtnText: {
    ...typography.smallMedium,
    color: colors.primaryDark,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionBtnText: {
    ...typography.smallMedium,
    color: colors.primaryDark,
  },
  activeFieldHint: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  mapFrame: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 250,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  routeStatus: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  routeStatusText: {
    ...typography.small,
    color: colors.textSecondary,
    flex: 1,
  },
  priceCard: {
    backgroundColor: colors.primarySoft,
    borderColor: '#C9E1DB',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    flex: 1,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  metricValue: {
    ...typography.h3,
    color: colors.primaryDark,
    marginTop: spacing.xxs,
  },
  priceDivider: {
    borderTopColor: '#C9E1DB',
    borderTopWidth: 1,
    marginVertical: spacing.sm,
  },
  priceBottomRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  estimateLabel: {
    ...typography.caption,
    color: colors.primary,
    letterSpacing: 0.8,
  },
  estimateValue: {
    ...typography.h1,
    color: colors.primaryDark,
    marginTop: spacing.xxs,
  },
  priceRate: {
    ...typography.smallMedium,
    color: colors.textSecondary,
  },
  priceNote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
