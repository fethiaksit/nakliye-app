import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, control, spacing, typography } from '../shared/ui/theme';
import { ConfirmationModal, ToastProvider, useToast } from '../shared/ui/feedback';
import { AppHeader, BottomNav } from '../shared/ui/navigation';
import { InlineNotice, ListSkeleton } from '../shared/ui/primitives';
import { apiError, auth, checkApiHealth, conversations, loads, logApiError, maps, offers, profile, restoreSession, saveSession, subscribeSessionExpired, updateStoredUser } from './src/services/api';
import { apiOrigin, healthUrl } from './src/config/api';
import AuthFlow from './src/components/AuthFlow';
import ConversationCenter from './src/components/ConversationCenter';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from './src/config/maps';
import { CustomerAccount, CustomerHome, CustomerLoads } from './src/screens/CustomerScreens';
import { formatMoney, loadStatusLabel, resolveMediaUrl } from './src/utils/presentation';

const { number, scheduledAtISO, validateLoadFormFields } = require('./src/utils/loadForm.cjs');

const initialLoadForm = () => ({
  title: '', description: '', urgencyType: 'immediate', scheduledDate: '', scheduledTime: '',
  cargoType: '', cargoTypeNote: '', vehicleType: 'farketmez', weight: '', length: '', width: '', height: '',
  pickupFloor: '0', deliveryFloor: '0', pickupElevatorAvailable: false, deliveryElevatorAvailable: false,
  helperNeeded: false, helperCount: '1',
});

const locationPayload = location => ({
  address: location.formattedAddress,
  latitude: location.coordinate.latitude,
  longitude: location.coordinate.longitude,
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
});

const navItems = [
  { value: 'home', label: 'Ana Sayfa', icon: 'home-outline', activeIcon: 'home' },
  { value: 'loads', label: 'İlanlarım', icon: 'file-tray-full-outline', activeIcon: 'file-tray-full' },
  { value: 'messages', label: 'Mesajlar', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  { value: 'account', label: 'Hesabım', icon: 'person-outline', activeIcon: 'person' },
];

export default function App() {
  return <SafeAreaProvider><ToastProvider><CustomerApp /></ToastProvider></SafeAreaProvider>;
}

function CustomerApp() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState('home');
  const [form, setForm] = useState(initialLoadForm);
  const [formErrors, setFormErrors] = useState({});
  const [routeDraft, setRouteDraft] = useState({ pickup: null, dropoff: null, route: null });
  const [photos, setPhotos] = useState([]);
  const [pendingDraftId, setPendingDraftId] = useState(null);
  const [saving, setSaving] = useState(false);
  const publishBusy = useRef(false);
  const [myLoads, setMyLoads] = useState([]);
  const [loadsLoading, setLoadsLoading] = useState(false);
  const [loadsError, setLoadsError] = useState('');
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [loadOffers, setLoadOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', email: '', phone: '', currentPassword: '', newPassword: '' });
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);

  useEffect(() => {
    let active = true;
    restoreSession().then(session => { if (active) setUser(session?.user || null); }).catch(error => logApiError('CUSTOMER AUTH HYDRATION', error)).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => subscribeSessionExpired(() => {
    setUser(null);
    setTab('home');
    setSelectedLoad(null);
    showToast('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.', { type: 'warning' });
  }), [showToast]);

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
      const { data } = await profile.get();
      setAccount(data);
      setAccountForm(current => ({ ...current, name: data.name || '', email: data.email || '', phone: data.phone || '' }));
    } catch (error) {
      setAccountError(apiError(error));
    } finally {
      setAccountLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    if (tab === 'home' || tab === 'loads') void fetchLoads();
    if (tab === 'account') void fetchAccount();
  }, [fetchAccount, fetchLoads, tab, user]);

  const handleLocationsChange = useCallback(({ pickup, dropoff }) => {
    setRouteDraft({ pickup, dropoff, route: null });
    setFormErrors(current => ({ ...current, route: '' }));
  }, []);
  const handleRouteChange = useCallback(route => {
    setRouteDraft(current => ({ ...current, route }));
    if (route) setFormErrors(current => ({ ...current, route: '' }));
  }, []);
  const publish = useCallback(async () => {
    if (publishBusy.current) return;
    const nextErrors = validateLoadFormFields(form);
    const { pickup, dropoff, route } = routeDraft;
    if (!pickup || !dropoff || !route) nextErrors.route = 'Başlangıç ve varış adreslerini seçin; rota hesabının tamamlanmasını bekleyin.';
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      showToast('Eksik veya hatalı alanları kontrol edin.', { type: 'error', title: 'İlan yayınlanamadı' });
      return;
    }
    publishBusy.current = true;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        photoUrls: [],
        pickup: locationPayload(pickup),
        delivery: locationPayload(dropoff),
        urgencyType: form.urgencyType,
        ...(form.urgencyType === 'scheduled' ? { scheduledAt: scheduledAtISO(form.scheduledDate, form.scheduledTime) } : {}),
        cargoType: form.cargoType,
        cargoTypeNote: form.cargoType === 'diger' ? form.cargoTypeNote.trim() : '',
        vehicleType: form.vehicleType,
        dimensions: { lengthCm: number(form.length), widthCm: number(form.width), heightCm: number(form.height), weightKg: number(form.weight) },
        pickupFloor: number(form.pickupFloor),
        deliveryFloor: number(form.deliveryFloor),
        pickupElevatorAvailable: form.pickupElevatorAvailable,
        deliveryElevatorAvailable: form.deliveryElevatorAvailable,
        helperNeeded: form.helperNeeded,
        helperCount: form.helperNeeded ? number(form.helperCount) : 0,
      };
      let draftId = pendingDraftId;
      if (!draftId) {
        const { data } = await loads.create(payload);
        draftId = data.id;
        setPendingDraftId(draftId);
      }
      if (photos.length) await loads.photos(draftId, photos);
      await loads.publish(draftId);
      setPendingDraftId(null);
      setPhotos([]);
      setForm(initialLoadForm());
      setFormErrors({});
      setRouteDraft({ pickup: null, dropoff: null, route: null });
      setTab('loads');
      await fetchLoads();
      showToast('İlanınız ve fotoğraflarınız şoförlere açıldı.', { type: 'success', title: 'İlan yayınlandı' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'İşlem yapılamadı' });
    } finally {
      publishBusy.current = false;
      setSaving(false);
    }
  }, [fetchLoads, form, pendingDraftId, photos, routeDraft, showToast]);

  const openLoad = useCallback(async load => {
    setSelectedLoad(load);
    setOffersLoading(true);
    try {
      const { data } = await offers.list(load.id);
      setLoadOffers(data || []);
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teklifler alınamadı' });
      setLoadOffers([]);
    } finally {
      setOffersLoading(false);
    }
  }, [showToast]);
  const openMessageLoad = useCallback(async id => {
    try {
      const { data } = await loads.get(id);
      setTab('loads');
      await openLoad(data);
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'İlan açılamadı' });
    }
  }, [openLoad, showToast]);
  const performAcceptOffer = useCallback(async offer => {
    setConfirmationLoading(true);
    try {
      await offers.accept(offer.id);
      setSelectedLoad(null);
      setConfirmation(null);
      await fetchLoads();
      showToast('Teklif kabul edildi; mesajlaşma açıldı.', { type: 'success', title: 'Şoför seçildi' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teklif kabul edilemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [fetchLoads, showToast]);
  const performCancelLoad = useCallback(async load => {
    setConfirmationLoading(true);
    try {
      await loads.status(load.id, 'cancelled');
      setSelectedLoad(null);
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
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Hesap güncellenemedi' });
    } finally {
      setAccountSaving(false);
    }
  }, [accountForm, showToast]);
  const changePassword = useCallback(async () => {
    if (!accountForm.currentPassword || accountForm.newPassword.length < 8) {
      showToast('Mevcut şifrenizi ve en az 8 karakterlik yeni şifrenizi girin.', { type: 'error', title: 'Şifre bilgisi eksik' });
      return;
    }
    setPasswordSaving(true);
    try {
      await profile.changePassword({ currentPassword: accountForm.currentPassword, newPassword: accountForm.newPassword });
      setAccountForm(current => ({ ...current, currentPassword: '', newPassword: '' }));
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
      await auth.logout();
    } catch (error) {
      logApiError('CUSTOMER LOGOUT', error);
    } finally {
      setConfirmation(null);
      setConfirmationLoading(false);
      setUser(null);
      setTab('home');
      setSelectedLoad(null);
    }
  }, []);

  if (restoring) return <View style={styles.center}><ListSkeleton count={2} /><Text style={styles.centerText}>Oturum güvenli biçimde yükleniyor…</Text></View>;
  if (!user) return <AuthFlow auth={auth} saveSession={saveSession} apiError={apiError} onSession={setUser} allowedRole="customer" connectionCheck={<ConnectionCheck />} />;

  const body = tab === 'home'
    ? <CustomerHome form={form} setForm={setForm} errors={formErrors} setErrors={setFormErrors} photos={photos} setPhotos={setPhotos} routeDraft={routeDraft} onLocationsChange={handleLocationsChange} onRouteChange={handleRouteChange} saving={saving} publish={publish} loads={myLoads} onShowLoads={() => setTab('loads')} />
    : tab === 'loads'
      ? <CustomerLoads loading={loadsLoading} error={loadsError} items={myLoads} selected={selectedLoad} offers={loadOffers} offersLoading={offersLoading} onOpen={openLoad} onClose={() => setSelectedLoad(null)} onAccept={offer => setConfirmation({ type: 'accept', target: offer })} onCancel={load => setConfirmation({ type: 'cancel', target: load })} retry={fetchLoads} />
      : tab === 'messages'
        ? <ConversationCenter currentUser={user} api={conversations} apiError={apiError} resolveMediaUrl={resolveMediaUrl} formatMoney={formatMoney} loadStatusLabel={loadStatusLabel} onOpenLoad={openMessageLoad} reverseGeocode={maps.reverse} nativeMapsConfigured={nativeGoogleMapsConfigured} nativeMapsMessage={nativeGoogleMapsMessage} bottomInset={control.bottomNavHeight + insets.bottom} />
        : <CustomerAccount loading={accountLoading} error={accountError} account={account} form={accountForm} setForm={setAccountForm} save={saveAccount} saveLoading={accountSaving} changePassword={changePassword} passwordLoading={passwordSaving} logout={() => setConfirmation({ type: 'logout' })} retry={fetchAccount} />;

  const refresh = tab === 'home' || tab === 'loads' ? fetchLoads : tab === 'account' ? fetchAccount : undefined;
  return <View style={styles.screen}>
    <StatusBar style="light" />
    <AppHeader title="NakliyeGo" subtitle={tab === 'home' ? 'Müşteri paneli' : tab === 'loads' ? 'İlan yönetimi' : tab === 'messages' ? 'Mesajlar' : 'Hesabım'} initials={user.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()} topInset={insets.top} />
    {tab === 'messages' ? body : <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}><ScrollView contentContainerStyle={[styles.content, { paddingBottom: control.bottomNavHeight + insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false} refreshControl={refresh ? <RefreshControl refreshing={tab === 'account' ? accountLoading : loadsLoading} onRefresh={refresh} tintColor={colors.primary} /> : undefined}>{body}</ScrollView></KeyboardAvoidingView>}
    <BottomNav items={navItems} value={tab} onChange={value => { setTab(value); if (value !== 'loads') setSelectedLoad(null); }} bottomInset={insets.bottom} />
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
  </View>;
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
  screen: { backgroundColor: colors.background, flex: 1 }, flex: { flex: 1 }, content: { paddingHorizontal: spacing.md, paddingTop: spacing.lg }, center: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, centerText: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
});
