import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, control, spacing, typography } from '../shared/ui/theme';
import { ConfirmationModal, ToastProvider, useToast } from '../shared/ui/feedback';
import { AppHeader, BottomNav } from '../shared/ui/navigation';
import { InlineNotice, ListSkeleton } from '../shared/ui/primitives';
import { registerDevicePushToken, subscribeNotificationResponses, unregisterDevicePushToken } from '../shared/notifications';
import { generateLoadDescription, generateLoadTitle } from '../shared/loadMetadata';
import { apiError, auth, checkApiHealth, clearSession, conversations, corporate, loads, logApiError, maps, offers, profile, push, restoreSession, saveSession, subscribeSessionExpired, updateStoredUser } from './src/services/api';
import { apiOrigin, healthUrl } from './src/config/api';
import AuthFlow from './src/components/AuthFlow';
import ConversationCenter from './src/components/ConversationCenter';
import LoadWizard from './src/components/load-wizard/LoadWizard';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from './src/config/maps';
import { CustomerHome, CustomerLoads } from './src/screens/CustomerScreens';
import CustomerAccountScreens from './src/screens/CustomerAccountScreens';
import { formatMoney, loadStatusLabel, resolveMediaUrl } from './src/utils/presentation';

const { number, scheduledAtISO, validateLoadFormFields } = require('./src/utils/loadForm.cjs');
const { buildRepeatDraft } = require('./src/utils/repeatLoad.cjs');

const initialLoadForm = () => ({
  title: '',
  description: '',
  urgencyType: 'immediate',
  scheduledDate: '',
  scheduledTime: '',
  cargoType: '',
  cargoTypeNote: '',
  vehicleType: 'farketmez',
  weight: '',
  length: '',
  width: '',
  height: '',
  pickupFloor: '0',
  deliveryFloor: '0',
  pickupElevatorAvailable: false,
  deliveryElevatorAvailable: false,
  helperNeeded: false,
  helperCount: '1',
  cargoDetails: {},
});

const initialRouteDraft = () => ({
  pickup: null,
  dropoff: null,
  stops: [],
  route: null,
});

const locationPayload = location => {
  if (!location) return null;
  const lat = typeof location.latitude === 'number'
    ? location.latitude
    : typeof location.coordinate?.latitude === 'number'
    ? location.coordinate.latitude
    : Number(location.latitude || location.coordinate?.latitude || 0);
  const lng = typeof location.longitude === 'number'
    ? location.longitude
    : typeof location.coordinate?.longitude === 'number'
    ? location.coordinate.longitude
    : Number(location.longitude || location.coordinate?.longitude || 0);

  return {
    address: String(location.address || location.formattedAddress || '').trim(),
    latitude: lat,
    longitude: lng,
    placeId: String(location.placeId || '').trim(),
    street: String(location.street || '').trim(),
    streetNumber: String(location.streetNumber || '').trim(),
    neighborhood: String(location.neighborhood || '').trim(),
    district: String(location.district || '').trim(),
    city: String(location.city || '').trim(),
    province: String(location.province || '').trim(),
    postalCode: String(location.postalCode || '').trim(),
    country: String(location.country || '').trim(),
    countryCode: String(location.countryCode || '').trim().toUpperCase(),
  };
};

const navItems = [
  { value: 'home', label: 'Ana Sayfa', icon: 'home-outline', activeIcon: 'home' },
  { value: 'loads', label: 'İlanlarım', icon: 'file-tray-full-outline', activeIcon: 'file-tray-full' },
  { value: 'messages', label: 'Mesajlar', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  { value: 'account', label: 'Hesabım', icon: 'person-outline', activeIcon: 'person' },
];

const deliveryCodeStatuses = new Set(['driver_selected', 'driver_en_route', 'at_pickup', 'picked_up', 'en_route_to_delivery', 'delivered']);
const emptyDeliveryCode = { value: '', loading: false, error: '' };

export default function App() {
  return <SafeAreaProvider><ToastProvider><CustomerApp /></ToastProvider></SafeAreaProvider>;
}

function CustomerApp() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState('home');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [form, setForm] = useState(initialLoadForm);
  const [formErrors, setFormErrors] = useState({});
  const [routeDraft, setRouteDraft] = useState(initialRouteDraft);
  const [photos, setPhotos] = useState([]);
  const [pendingDraftId, setPendingDraftId] = useState(null);
  const [saving, setSaving] = useState(false);
  const publishBusy = useRef(false);
  const [myLoads, setMyLoads] = useState([]);
  const [loadsLoading, setLoadsLoading] = useState(false);
  const [loadsError, setLoadsError] = useState('');
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [deliveryCode, setDeliveryCode] = useState(emptyDeliveryCode);
  const loadDetailRequest = useRef(0);
  const [loadOffers, setLoadOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [selectedLoadWallet, setSelectedLoadWallet] = useState(null);
  const [walletError, setWalletError] = useState('');
  const [walletSaving, setWalletSaving] = useState(false);
  const [favoriteDriverIds, setFavoriteDriverIds] = useState(new Set());
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [account, setAccount] = useState(null);
  const [accountPage, setAccountPage] = useState('home');
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', email: '', phone: '', currentPassword: '', newPassword: '', newPasswordConfirm: '' });
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [notificationData, setNotificationData] = useState(null);
  const [pendingConversationId, setPendingConversationId] = useState('');
  const pushToken = useRef(null);

  useEffect(() => {
    let active = true;
    restoreSession().then(session => {
      if (active) {
        setUser(session?.user || null);
        if (session?.user) {
          profile.get().then(response => {
            const data = response?.data;
            if (active && data) {
              console.log("RAW /api/me RESPONSE", JSON.stringify(data, null, 2));
              console.log("CORPORATE PARSED", {
                userId: data?.id,
                corporateId: data?.corporate?.id,
                status: data?.corporate?.status,
                approvedAt: data?.corporate?.approved_at,
              });
              setUser(current => (current ? { ...current, ...data } : data));
              setAccount(data);
              updateStoredUser(data);
            }
          }).catch(() => {});
        }
      }
    }).catch(error => logApiError('CUSTOMER AUTH HYDRATION', error)).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => subscribeSessionExpired(() => {
    setUser(null);
    setTab('home');
    setAccountPage('home');
    setWizardOpen(false);
    loadDetailRequest.current += 1;
    setSelectedLoad(null);
    setSelectedLoadWallet(null);
    setDeliveryCode(emptyDeliveryCode);
    showToast('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.', { type: 'warning' });
  }), [showToast]);
  useEffect(() => subscribeNotificationResponses(setNotificationData), []);
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    registerDevicePushToken(push).then(token => { if (active) pushToken.current = token; }).catch(error => logApiError('CUSTOMER PUSH REGISTER', error));
    return () => { active = false; };
  }, [user?.id]);

  const fetchLoads = useCallback(async () => {
    setLoadsLoading(true);
    setLoadsError('');
    try {
      const { data } = await loads.mine({ limit: 100 });
      setMyLoads(data.items || []);
    } catch (error) {
      setLoadsError(apiError(error));
    } finally {
      setLoadsLoading(false);
    }
  }, []);
  const fetchAccount = useCallback(async () => {
    setAccountLoading(true);
    setAccountError('');
    try {
      const response = await profile.get();
      const data = response?.data;
      console.log("RAW /api/me RESPONSE", JSON.stringify(data, null, 2));
      console.log("CORPORATE PARSED", {
        userId: data?.id,
        corporateId: data?.corporate?.id,
        status: data?.corporate?.status,
        approvedAt: data?.corporate?.approved_at,
      });
      setAccount(data);
      setUser(current => (current ? { ...current, ...data } : data));
      updateStoredUser(data);
      setAccountForm(current => ({ ...current, name: data?.name || '', email: data?.email || '', phone: data?.phone || '' }));
    } catch (error) {
      setAccountError(apiError(error));
    } finally {
      setAccountLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user?.id) return;
    if (tab === 'home' || tab === 'loads') void fetchLoads();
    if (tab === 'account') void fetchAccount();
  }, [fetchAccount, fetchLoads, tab, user?.id]);

  const handleLocationsChange = useCallback(({ pickup, dropoff, stops }) => {
    setRouteDraft(current => {
      const nextPickup = pickup !== undefined ? pickup : current.pickup;
      const nextDropoff = dropoff !== undefined ? dropoff : current.dropoff;
      const nextStops = stops !== undefined ? stops : current.stops;
      if (current.pickup === nextPickup && current.dropoff === nextDropoff && current.stops === nextStops && current.route === null) {
        return current;
      }
      return {
        ...current,
        pickup: nextPickup,
        dropoff: nextDropoff,
        stops: nextStops,
        route: null,
      };
    });
    setFormErrors(current => current.route ? { ...current, route: '' } : current);
  }, []);

  const handleRouteChange = useCallback(route => {
    setRouteDraft(current => {
      if (current.route === route) return current;
      return { ...current, route };
    });
    if (route) setFormErrors(current => current.route ? { ...current, route: '' } : current);
  }, []);

  const resetLoadWizard = useCallback(() => {
    setForm(initialLoadForm());
    setRouteDraft(initialRouteDraft());
    setPhotos([]);
    setPendingDraftId(null);
    setFormErrors({});
  }, []);

  const publish = useCallback(async () => {
    if (publishBusy.current) return;
    const { pickup, dropoff, stops = [], route } = routeDraft;
    const draft = {
      form,
      routeDraft,
      ...form,
      pickup,
      dropoff,
      stops,
      route,
    };
    const nextErrors = validateLoadFormFields(draft);
    if (!pickup || !dropoff || !route) {
      nextErrors.route = 'Başlangıç ve varış adreslerini seçin; rota hesabının tamamlanmasını bekleyin.';
    }
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      showToast('Eksik veya hatalı alanları kontrol edin.', { type: 'error', title: 'İlan yayınlanamadı' });
      return;
    }
    publishBusy.current = true;
    setSaving(true);
    try {
      const autoTitle = (form.title || '').trim() || generateLoadTitle(
        form.cargoType,
        form.cargoDetails || {},
        form.cargoTypeNote,
        pickup,
        dropoff,
      );

      const autoDescription = (form.description || '').trim() || generateLoadDescription(
        form.cargoType,
        form.cargoDetails || {},
        form.cargoTypeNote,
        form,
      );

      const safeWeight = number(form.weight);
      const safeLength = number(form.length);
      const safeWidth = number(form.width);
      const safeHeight = number(form.height);
      const safePickupFloor = number(form.pickupFloor);
      const safeDeliveryFloor = number(form.deliveryFloor);
      const safeHelperCount = number(form.helperCount);

      const payload = {
        title: autoTitle,
        description: autoDescription,
        photoUrls: [],
        pickup: locationPayload(pickup),
        delivery: locationPayload(dropoff),
        stops: (stops || []).map((s, index) => {
          const lat = typeof s.latitude === 'number'
            ? s.latitude
            : typeof s.coordinate?.latitude === 'number'
            ? s.coordinate.latitude
            : Number(s.latitude || s.coordinate?.latitude || 0);
          const lng = typeof s.longitude === 'number'
            ? s.longitude
            : typeof s.coordinate?.longitude === 'number'
            ? s.coordinate.longitude
            : Number(s.longitude || s.coordinate?.longitude || 0);

          return {
            address: String(s.address || s.formattedAddress || '').trim(),
            latitude: lat,
            longitude: lng,
            placeId: String(s.placeId || '').trim(),
            stopType: ['pickup', 'delivery', 'both'].includes(s.stopType) ? s.stopType : 'delivery',
            order: index + 1,
            note: String(s.note || '').trim(),
            street: String(s.street || '').trim(),
            streetNumber: String(s.streetNumber || '').trim(),
            neighborhood: String(s.neighborhood || '').trim(),
            district: String(s.district || '').trim(),
            city: String(s.city || '').trim(),
            province: String(s.province || '').trim(),
            postalCode: String(s.postalCode || '').trim(),
            country: String(s.country || '').trim(),
            countryCode: String(s.countryCode || '').trim().toUpperCase(),
          };
        }),
        urgencyType: form.urgencyType || 'immediate',
        ...(form.urgencyType === 'scheduled' ? { scheduledAt: scheduledAtISO(form.scheduledDate, form.scheduledTime) } : {}),
        cargoType: form.cargoType,
        cargoTypeNote: form.cargoType === 'diger' ? (form.cargoTypeNote || '').trim() : '',
        cargoDetails: form.cargoDetails || {},
        vehicleType: form.vehicleType || 'farketmez',
        dimensions: {
          lengthCm: Number.isFinite(safeLength) && safeLength > 0 ? safeLength : 100,
          widthCm: Number.isFinite(safeWidth) && safeWidth > 0 ? safeWidth : 100,
          heightCm: Number.isFinite(safeHeight) && safeHeight > 0 ? safeHeight : 100,
          weightKg: Number.isFinite(safeWeight) && safeWeight > 0 ? safeWeight : 50,
        },
        pickupFloor: Number.isInteger(safePickupFloor) ? safePickupFloor : 0,
        deliveryFloor: Number.isInteger(safeDeliveryFloor) ? safeDeliveryFloor : 0,
        pickupElevatorAvailable: Boolean(form.pickupElevatorAvailable),
        deliveryElevatorAvailable: Boolean(form.deliveryElevatorAvailable),
        helperNeeded: Boolean(form.helperNeeded),
        helperCount: form.helperNeeded ? (Number.isInteger(safeHelperCount) && safeHelperCount >= 1 ? safeHelperCount : 1) : 0,
      };

      let draftId = pendingDraftId;
      if (!draftId) {
        const { data } = await loads.create(payload);
        draftId = data.id;
        setPendingDraftId(draftId);
      }
      const safePhotos = Array.isArray(photos) ? photos.filter(p => p && (p.uri || typeof p === 'string')) : [];
      if (safePhotos.length > 0) {
        const normalizedPhotos = safePhotos.map((p, idx) => typeof p === 'string' ? { uri: p, fileName: `photo-${Date.now()}-${idx}.jpg`, mimeType: 'image/jpeg' } : p);
        await loads.photos(draftId, normalizedPhotos);
      }
      await loads.publish(draftId);
      resetLoadWizard();
      setWizardOpen(false);
      setTab('loads');
      await fetchLoads();
      showToast('İlanınız ve fotoğraflarınız şoförlere açıldı.', { type: 'success', title: 'İlan yayınlandı' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'İşlem yapılamadı' });
    } finally {
      publishBusy.current = false;
      setSaving(false);
    }
  }, [fetchLoads, form, pendingDraftId, photos, resetLoadWizard, routeDraft, showToast]);

  const openLoad = useCallback(async load => {
    const requestID = ++loadDetailRequest.current;
    setSelectedLoad(load);
    setSelectedLoadWallet(null);
    setWalletError('');
    setOffersLoading(true);
    const shouldFetchDeliveryCode = deliveryCodeStatuses.has(load.status) && !load.deliveryVerified;
    setDeliveryCode(shouldFetchDeliveryCode ? { value: '', loading: true, error: '' } : emptyDeliveryCode);
    const corporateAccount = user?.accountType === 'corporate';
    const [offerResult, codeResult, walletResult, favoriteResult] = await Promise.allSettled([
      offers.list(load.id),
      shouldFetchDeliveryCode ? loads.deliveryCode(load.id) : Promise.resolve(null),
      corporateAccount ? corporate.loadWallet(load.id) : Promise.resolve(null),
      corporateAccount && load.assignedDriverId ? corporate.favorites() : Promise.resolve(null),
    ]);
    if (requestID !== loadDetailRequest.current) return;
    if (offerResult.status === 'fulfilled') {
      setLoadOffers(offerResult.value.data || []);
    } else {
      showToast(apiError(offerResult.reason), { type: 'error', title: 'Teklifler alınamadı' });
      setLoadOffers([]);
    }
    if (shouldFetchDeliveryCode) {
      setDeliveryCode(codeResult.status === 'fulfilled'
        ? { value: String(codeResult.value.data?.deliveryCode || ''), loading: false, error: '' }
        : { value: '', loading: false, error: apiError(codeResult.reason) });
    }
    setSelectedLoadWallet(walletResult.status === 'fulfilled' ? walletResult.value?.data || null : null);
    if (corporateAccount && walletResult.status === 'rejected') setWalletError(apiError(walletResult.reason));
    if (favoriteResult.status === 'fulfilled' && favoriteResult.value) setFavoriteDriverIds(new Set((favoriteResult.value.data?.items || []).map(item => item.driver?.id).filter(Boolean)));
    setOffersLoading(false);
  }, [showToast, user?.accountType]);

  const openMessageLoad = useCallback(async id => {
    try {
      const { data } = await loads.get(id);
      setTab('loads');
      await openLoad(data);
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'İlan açılamadı' });
    }
  }, [openLoad, showToast]);

  useEffect(() => {
    if (!user || !notificationData) return;
    if (notificationData.screen === 'conversation') {
      const conversationId = String(notificationData.conversationId || notificationData.loadId || '');
      if (conversationId) {
        setPendingConversationId(conversationId);
        setTab('messages');
      }
    } else if (notificationData.screen === 'load' && notificationData.loadId) {
      void openMessageLoad(String(notificationData.loadId));
    }
    setNotificationData(null);
  }, [notificationData, openMessageLoad, user]);

  const handleInitialConversation = useCallback(() => setPendingConversationId(''), []);
  const performAcceptOffer = useCallback(async offer => {
    setConfirmationLoading(true);
    try {
      const { data: acceptedLoad } = await offers.accept(offer.id);
      setConfirmation(null);
      if (user?.accountType === 'corporate') {
        await openLoad(acceptedLoad);
      } else {
        loadDetailRequest.current += 1;
        setSelectedLoad(null);
        setSelectedLoadWallet(null);
        setDeliveryCode(emptyDeliveryCode);
      }
      await fetchLoads();
      showToast(user?.accountType === 'corporate' ? 'Teklif kabul edildi. İsterseniz aşağıdaki Kurumsal cüzdan alanından bakiyenizi kullanabilirsiniz.' : 'Teklif kabul edildi; mesajlaşma açıldı.', { type: 'success', title: 'Şoför seçildi' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teklif kabul edilemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [fetchLoads, openLoad, showToast, user?.accountType]);

  const performCancelLoad = useCallback(async load => {
    setConfirmationLoading(true);
    try {
      await loads.status(load.id, 'cancelled');
      loadDetailRequest.current += 1;
      setSelectedLoad(null);
      setSelectedLoadWallet(null);
      setDeliveryCode(emptyDeliveryCode);
      setConfirmation(null);
      await fetchLoads();
      showToast('İlan iptal edildi.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'İlan iptal edilemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [fetchLoads, showToast]);

  const saveAccount = useCallback(async () => {
    setAccountSaving(true);
    try {
      const { data } = await profile.update({ name: accountForm.name, email: accountForm.email, phone: accountForm.phone });
      setAccount(data);
      setUser(data);
      await updateStoredUser(data);
      showToast('Profil bilgileriniz kaydedildi.', { type: 'success', title: 'Hesap güncellendi' });
      return true;
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Hesap güncellenemedi' });
      return false;
    } finally {
      setAccountSaving(false);
    }
  }, [accountForm, showToast]);

  const changePassword = useCallback(async () => {
    if (!accountForm.currentPassword || accountForm.newPassword.length < 8 || accountForm.newPassword !== accountForm.newPasswordConfirm) {
      showToast('Mevcut şifrenizi, eşleşen ve en az 8 karakterlik yeni şifrenizi girin.', { type: 'error', title: 'Şifre bilgisi eksik' });
      return;
    }
    setPasswordSaving(true);
    try {
      await profile.changePassword({ currentPassword: accountForm.currentPassword, newPassword: accountForm.newPassword });
      setAccountForm(current => ({ ...current, currentPassword: '', newPassword: '', newPasswordConfirm: '' }));
      setAccountPage('home');
      showToast('Yeni şifreniz kaydedildi.', { type: 'success', title: 'Şifre değiştirildi' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Şifre değiştirilemedi' });
    } finally {
      setPasswordSaving(false);
    }
  }, [accountForm, showToast]);

  const performLogout = useCallback(async () => {
    setConfirmationLoading(true);
    try {
      await unregisterDevicePushToken(push, pushToken.current).catch(error => logApiError('CUSTOMER PUSH UNREGISTER', error));
      pushToken.current = null;
      await auth.logout().catch(error => logApiError('CUSTOMER LOGOUT', error));
    } catch (error) {
      logApiError('CUSTOMER LOGOUT', error);
    } finally {
      await clearSession().catch(() => {});
      setConfirmation(null);
      setConfirmationLoading(false);
      setUser(null);
      setAccount(null);
      setAccountForm({ name: '', email: '', phone: '', currentPassword: '', newPassword: '', newPasswordConfirm: '' });
      setTab('home');
      setAccountPage('home');
      setWizardOpen(false);
      loadDetailRequest.current += 1;
      setSelectedLoad(null);
      setSelectedLoadWallet(null);
      setDeliveryCode(emptyDeliveryCode);
    }
  }, []);

  const openAccountLoad = useCallback(async load => {
    setAccountPage('home');
    setTab('loads');
    await openLoad(load);
  }, [openLoad]);

  const registerPushAfterPermission = useCallback(async () => {
    const token = await registerDevicePushToken(push);
    if (token) pushToken.current = token;
  }, []);

  const applyWalletCredit = useCallback(async amountCents => {
    if (!selectedLoad?.id || !Number.isSafeInteger(amountCents) || amountCents <= 0 || walletSaving) return;
    const requestID = loadDetailRequest.current;
    setWalletSaving(true);
    try {
      const { data } = await corporate.applyWallet(selectedLoad.id, amountCents);
      if (requestID !== loadDetailRequest.current) return;
      setSelectedLoadWallet(data);
      showToast(`${formatMoney(amountCents / 100)} kurumsal kredi uygulandı.`, { type: 'success', title: 'Cüzdan kullanıldı' });
    } catch (error) { showToast(apiError(error), { type: 'error', title: 'Cüzdan kullanılamadı' }); }
    finally { setWalletSaving(false); }
  }, [selectedLoad?.id, showToast, walletSaving]);

  const toggleFavoriteDriver = useCallback(async driverId => {
    if (!driverId) return;
    setFavoriteSaving(true);
    try {
      if (favoriteDriverIds.has(driverId)) await corporate.removeFavorite(driverId); else await corporate.addFavorite(driverId);
      setFavoriteDriverIds(current => { const next = new Set(current); if (next.has(driverId)) next.delete(driverId); else next.add(driverId); return next; });
      showToast(favoriteDriverIds.has(driverId) ? 'Şoför favorilerden çıkarıldı.' : 'Şoför favorilere eklendi.', { type: 'success' });
    } catch (error) { showToast(apiError(error), { type: 'error', title: 'Favori güncellenemedi' }); }
    finally { setFavoriteSaving(false); }
  }, [favoriteDriverIds, showToast]);

  const repeatLoad = useCallback(load => {
    const draft = buildRepeatDraft(load);
    resetLoadWizard();
    setForm(draft.form);
    setRouteDraft(draft.routeDraft);
    setSelectedLoad(null);
    setSelectedLoadWallet(null);
    setWizardOpen(true);
    showToast('Eski nakliye bilgileri yeni ilan sihirbazına aktarıldı.', { type: 'success', title: 'İlan hazır' });
  }, [resetLoadWizard, showToast]);

  const startNewLoad = useCallback(() => {
    resetLoadWizard();
    setWizardOpen(true);
  }, [resetLoadWizard]);

  const handleCloseWizard = useCallback(() => {
    setWizardOpen(false);
    resetLoadWizard();
  }, [resetLoadWizard]);

  if (restoring) return <View style={styles.center}><ListSkeleton count={2} /><Text style={styles.centerText}>Oturum güvenli biçimde yükleniyor…</Text></View>;
  if (!user) return <AuthFlow auth={auth} saveSession={saveSession} apiError={apiError} onSession={setUser} allowedRole="customer" connectionCheck={<ConnectionCheck />} />;

  const body = tab === 'home'
    ? <CustomerHome loads={myLoads} onShowLoads={() => setTab('loads')} onOpenLoad={openLoad} onNewLoad={startNewLoad} />
    : tab === 'loads'
      ? <CustomerLoads loading={loadsLoading} error={loadsError} items={myLoads} selected={selectedLoad} offers={loadOffers} offersLoading={offersLoading} deliveryCode={deliveryCode.value} deliveryCodeLoading={deliveryCode.loading} deliveryCodeError={deliveryCode.error} walletInfo={selectedLoadWallet} walletError={walletError} walletLoading={offersLoading} onRetryWallet={() => openLoad(selectedLoad)} walletSaving={walletSaving} onApplyWallet={applyWalletCredit} isCorporate={user?.accountType === 'corporate'} isFavorite={favoriteDriverIds.has(selectedLoad?.assignedDriverId)} favoriteSaving={favoriteSaving} onToggleFavorite={toggleFavoriteDriver} onRepeat={repeatLoad} onOpen={openLoad} onClose={() => { loadDetailRequest.current += 1; setSelectedLoad(null); setSelectedLoadWallet(null); setDeliveryCode(emptyDeliveryCode); }} onAccept={offer => setConfirmation({ type: 'accept', target: offer })} onCancel={load => setConfirmation({ type: 'cancel', target: load })} retry={fetchLoads} />
      : tab === 'messages'
        ? <ConversationCenter currentUser={user} api={conversations} apiError={apiError} resolveMediaUrl={resolveMediaUrl} formatMoney={formatMoney} loadStatusLabel={loadStatusLabel} onOpenLoad={openMessageLoad} initialConversationId={pendingConversationId} onInitialConversationHandled={handleInitialConversation} reverseGeocode={maps.reverse} nativeMapsConfigured={nativeGoogleMapsConfigured} nativeMapsMessage={nativeGoogleMapsMessage} bottomInset={control.bottomNavHeight + insets.bottom} />
        : <CustomerAccountScreens page={accountPage} onPageChange={setAccountPage} loading={accountLoading} error={accountError} account={account} form={accountForm} setForm={setAccountForm} save={saveAccount} saveLoading={accountSaving} changePassword={changePassword} passwordLoading={passwordSaving} logout={() => setConfirmation({ type: 'logout' })} retry={fetchAccount} onOpenLoad={openAccountLoad} onPermissionGranted={registerPushAfterPermission} />;

  const refresh = tab === 'home' || tab === 'loads' ? fetchLoads : tab === 'account' && accountPage === 'home' ? fetchAccount : undefined;
  const showBottomNav = tab !== 'account' || accountPage === 'home';

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <AppHeader
        title="NakliyeGo"
        subtitle={tab === 'home' ? 'Müşteri paneli' : tab === 'loads' ? 'İlan yönetimi' : tab === 'messages' ? 'Mesajlar' : 'Hesabım'}
        initials={user.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}
        topInset={insets.top}
      />
      {tab === 'messages' ? body : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: (showBottomNav ? control.bottomNavHeight + insets.bottom : insets.bottom) + spacing.xl },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            refreshControl={refresh ? <RefreshControl refreshing={tab === 'account' ? accountLoading : loadsLoading} onRefresh={refresh} tintColor={colors.primary} /> : undefined}
          >
            {body}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {showBottomNav ? (
        <BottomNav
          items={navItems}
          value={tab}
          onChange={value => {
            setTab(value);
            setAccountPage('home');
            if (value !== 'loads') {
              loadDetailRequest.current += 1;
              setSelectedLoad(null);
              setSelectedLoadWallet(null);
              setDeliveryCode(emptyDeliveryCode);
            }
          }}
          bottomInset={insets.bottom}
        />
      ) : null}

      {/* 6-Step Load Wizard */}
      <LoadWizard
        visible={wizardOpen}
        form={form}
        setForm={setForm}
        routeDraft={routeDraft}
        onLocationsChange={handleLocationsChange}
        onRouteChange={handleRouteChange}
        photos={photos}
        setPhotos={setPhotos}
        onPublish={publish}
        onClose={handleCloseWizard}
        saving={saving}
      />

      <ConfirmationModal
        visible={Boolean(confirmation)}
        title={confirmation?.type === 'accept' ? 'Teklifi kabul et' : confirmation?.type === 'cancel' ? 'İlanı iptal et' : 'Hesaptan çıkış'}
        message={confirmation?.type === 'accept' ? 'Bu şoför seçilecek ve ilan diğer tekliflere kapanacak.' : confirmation?.type === 'cancel' ? 'İlan iptal edilecek. Bu işlem geri alınamaz.' : 'Hesabınızdan çıkış yapmak istediğinizden emin misiniz?'}
        confirmLabel={confirmation?.type === 'accept' ? 'Kabul et' : confirmation?.type === 'cancel' ? 'İlanı iptal et' : 'Çıkış yap'}
        destructive={confirmation?.type !== 'accept'}
        loading={confirmationLoading}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => confirmation?.type === 'accept' ? performAcceptOffer(confirmation.target) : confirmation?.type === 'cancel' ? performCancelLoad(confirmation.target) : performLogout()}
      />
    </View>
  );
}

function ConnectionCheck() {
  const [state, setState] = useState({ tone: 'info', message: 'Bağlantı kontrol ediliyor…' });
  const check = useCallback(async signal => {
    setState({ tone: 'info', message: 'Bağlantı kontrol ediliyor…' });
    try {
      if (__DEV__) console.info(`[API] Health URL: ${healthUrl}`);
      await checkApiHealth({ signal });
      setState({ tone: 'success', message: 'API bağlantısı hazır.' });
    } catch (error) {
      if (error?.code !== 'ERR_CANCELED') setState({ tone: 'danger', message: error?.code === 'ECONNABORTED' ? 'Sunucu zamanında yanıt vermedi.' : 'Sunucuya bağlanılamadı.' });
    }
  }, []);
  useEffect(() => {
    if (!__DEV__) return undefined;
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);
  if (!__DEV__) return null;
  return <InlineNotice title={`Geliştirme API: ${apiOrigin || 'tanımlı değil'}`} message={state.message} tone={state.tone} actionLabel="Kontrol et" onAction={() => void check()} />;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  center: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  centerText: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
});
