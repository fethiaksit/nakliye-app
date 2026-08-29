import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmationModal, ToastProvider, useToast } from '../shared/ui/feedback';
import { AppHeader, BottomNav } from '../shared/ui/navigation';
import { ListSkeleton } from '../shared/ui/primitives';
import { colors, control, spacing, typography } from '../shared/ui/theme';
import { registerDevicePushToken, subscribeNotificationResponses, unregisterDevicePushToken } from '../shared/notifications';
import { apiError, auth, conversations, loads, logApiError, maps, offers, profile, push, restoreSession, saveSession, subscribeSessionExpired, updateStoredUser } from './src/services/api';
import AuthFlow from './src/components/AuthFlow';
import ConversationCenter from './src/components/ConversationCenter';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from './src/config/maps';
import { DriverAccount, DriverJobs, DriverOffers } from './src/screens/DriverScreens';
import { driverStatusAction, formatMoney, loadStatusLabel, resolveMediaUrl, toFiniteNumber } from './src/utils/presentation';

const navItems = [
  { value: 'jobs', label: 'İşler', icon: 'briefcase-outline', activeIcon: 'briefcase' },
  { value: 'offers', label: 'Tekliflerim', icon: 'pricetags-outline', activeIcon: 'pricetags' },
  { value: 'messages', label: 'Mesajlar', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  { value: 'account', label: 'Hesabım', icon: 'person-outline', activeIcon: 'person' },
];

export default function App() {
  return <SafeAreaProvider><ToastProvider><DriverApp /></ToastProvider></SafeAreaProvider>;
}

function DriverApp() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [offerForm, setOfferForm] = useState({ amount: '', note: '', eta: '45' });
  const [offerErrors, setOfferErrors] = useState({});
  const [offerSaving, setOfferSaving] = useState(false);
  const [myOffers, setMyOffers] = useState([]);
  const [myOffersLoading, setMyOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState('');
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', email: '', phone: '', vehicleType: '', vehicleModel: '', licensePlate: '', capacityKg: '', serviceArea: '', licenseStatus: '', nearbyLoadNotifications: false, currentPassword: '', newPassword: '' });
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const jobsAbort = useRef(null);
  const [notificationData, setNotificationData] = useState(null);
  const [pendingConversationId, setPendingConversationId] = useState('');
  const pushToken = useRef(null);

  useEffect(() => {
    let active = true;
    restoreSession().then(session => { if (active) setUser(session?.user || null); }).catch(error => logApiError('DRIVER AUTH HYDRATION', error)).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);
  const resetDriverState = useCallback(() => {
    jobsAbort.current?.abort();
    jobsAbort.current = null;
    setJobs([]);
    setJobsError('');
    setSelected(null);
    setSelectedOffer(null);
    setMyOffers([]);
    setOffersError('');
    setAccount(null);
    setAccountError('');
    setTab('jobs');
    setUser(null);
  }, []);
  useEffect(() => subscribeSessionExpired(() => {
    resetDriverState();
    showToast('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.', { type: 'warning' });
  }), [resetDriverState, showToast]);
  useEffect(() => subscribeNotificationResponses(setNotificationData), []);
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    registerDevicePushToken(push).then(token => { if (active) pushToken.current = token; }).catch(error => logApiError('DRIVER PUSH REGISTER', error));
    return () => { active = false; };
  }, [user?.id]);

  const fetchJobs = useCallback(async () => {
    if (restoring || !user || user.role !== 'driver') return;
    jobsAbort.current?.abort();
    const controller = new AbortController();
    jobsAbort.current = controller;
    setJobsLoading(true);
    setJobsError('');
    try {
      const { data } = await loads.list({ limit: 100 }, { signal: controller.signal });
      if (!Array.isArray(data?.items)) throw new Error('Jobs response is not an items array.');
      setJobs(data.items);
    } catch (error) {
      if (error.code !== 'ERR_CANCELED') {
        logApiError('DRIVER JOBS', error);
        setJobsError(apiError(error));
      }
    } finally {
      if (jobsAbort.current === controller) {
        jobsAbort.current = null;
        setJobsLoading(false);
      }
    }
  }, [restoring, user?.id, user?.role]);
  const fetchOffers = useCallback(async () => {
    setMyOffersLoading(true);
    setOffersError('');
    try {
      const { data } = await offers.list();
      setMyOffers(data.items || []);
    } catch (error) {
      setOffersError(apiError(error));
    } finally {
      setMyOffersLoading(false);
    }
  }, []);
  const fetchAccount = useCallback(async () => {
    setAccountLoading(true);
    setAccountError('');
    try {
      const { data } = await profile.get();
      const driver = data.driverProfile || {};
      setAccount(data);
      setAccountForm(current => ({ ...current, name: data.name || '', email: data.email || '', phone: data.phone || '', vehicleType: driver.vehicleType || '', vehicleModel: driver.vehicleModel || '', licensePlate: driver.licensePlate || '', capacityKg: driver.capacityKg ? String(driver.capacityKg) : '', serviceArea: driver.serviceArea || '', licenseStatus: driver.licenseStatus || '', nearbyLoadNotifications: Boolean(driver.nearbyLoadNotifications) }));
    } catch (error) {
      setAccountError(apiError(error));
    } finally {
      setAccountLoading(false);
    }
  }, []);
  useEffect(() => {
    if (restoring || !user || user.role !== 'driver') return;
    if (tab === 'jobs') void fetchJobs();
    if (tab === 'offers') void fetchOffers();
    if (tab === 'account') void fetchAccount();
  }, [fetchAccount, fetchJobs, fetchOffers, restoring, tab, user?.id, user?.role]);

  const openJob = useCallback((load, offer = null) => {
    setSelected(load);
    setSelectedOffer(offer);
    setOfferErrors({});
    setOfferForm({ amount: String(toFiniteNumber(offer?.amountTl, toFiniteNumber(load.basePriceTl, toFiniteNumber(load.agreedPriceTl)))), note: offer?.note || '', eta: String(offer?.estimatedArrivalMinutes || 45) });
  }, []);
  const openMessageLoad = useCallback(async id => {
    try {
      const { data } = await loads.get(id);
      setTab('jobs');
      openJob(data);
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'İlan açılamadı' });
    }
  }, [openJob, showToast]);
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
  const adjustOffer = useCallback(delta => {
    setOfferForm(current => ({ ...current, amount: String(Math.max(0, toFiniteNumber(current.amount) + delta)) }));
    setOfferErrors(current => ({ ...current, amount: '' }));
  }, []);
  const saveOffer = useCallback(async () => {
    if (!selected) return;
    const amountTl = toFiniteNumber(offerForm.amount);
    const estimatedArrivalMinutes = Math.round(toFiniteNumber(offerForm.eta));
    const errors = {};
    if (amountTl <= 0) errors.amount = 'Geçerli bir teklif fiyatı girin.';
    if (estimatedArrivalMinutes < 0 || !String(offerForm.eta).trim()) errors.eta = 'Geçerli bir varış süresi girin.';
    setOfferErrors(errors);
    if (Object.keys(errors).length) {
      showToast('Teklif alanlarını kontrol edin.', { type: 'error', title: 'Geçersiz teklif' });
      return;
    }
    setOfferSaving(true);
    try {
      const payload = { amountTl, note: offerForm.note.trim(), estimatedArrivalMinutes };
      if (selectedOffer) await offers.update(selectedOffer.id, payload);
      else await offers.create(selected.id, payload);
      const updated = Boolean(selectedOffer);
      setSelected(null);
      setSelectedOffer(null);
      await fetchJobs();
      await fetchOffers();
      showToast(updated ? 'Teklifiniz güncellendi.' : 'Teklifiniz müşterinin onayına gönderildi.', { type: 'success', title: 'Teklif kaydedildi' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teklif kaydedilemedi' });
    } finally {
      setOfferSaving(false);
    }
  }, [fetchJobs, fetchOffers, offerForm, selected, selectedOffer, showToast]);
  const performWithdrawOffer = useCallback(async offer => {
    setConfirmationLoading(true);
    try {
      await offers.withdraw(offer.id);
      setConfirmation(null);
      await fetchOffers();
      await fetchJobs();
      showToast('Müşteri artık bu teklifi görmeyecek.', { type: 'success', title: 'Teklif geri çekildi' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teklif geri çekilemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [fetchJobs, fetchOffers, showToast]);
  const performUpdateJobStatus = useCallback(async (load, status) => {
    setConfirmationLoading(true);
    try {
      await loads.status(load.id, status);
      await fetchJobs();
      await fetchOffers();
      setSelected(null);
      setConfirmation(null);
      showToast(driverStatusAction(load.status)?.successMessage || 'Operasyon durumu güncellendi.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Durum güncellenemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [fetchJobs, fetchOffers, showToast]);
  const saveAccount = useCallback(async () => {
    const driverProfile = { vehicleType: accountForm.vehicleType, vehicleModel: accountForm.vehicleModel, licensePlate: accountForm.licensePlate, capacityKg: toFiniteNumber(accountForm.capacityKg), serviceArea: accountForm.serviceArea, licenseStatus: accountForm.licenseStatus, nearbyLoadNotifications: accountForm.nearbyLoadNotifications };
    setAccountSaving(true);
    try {
      const { data } = await profile.update({ name: accountForm.name, email: accountForm.email, phone: accountForm.phone, driverProfile });
      setAccount(data);
      setUser(data);
      await updateStoredUser(data);
      showToast('Profil ve araç bilgileriniz kaydedildi.', { type: 'success', title: 'Hesap güncellendi' });
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
      await unregisterDevicePushToken(push, pushToken.current).catch(error => logApiError('DRIVER PUSH UNREGISTER', error));
      pushToken.current = null;
      await auth.logout();
    } catch (error) {
      logApiError('DRIVER LOGOUT', error);
    } finally {
      setConfirmation(null);
      setConfirmationLoading(false);
      resetDriverState();
    }
  }, [resetDriverState]);

  if (restoring) return <View style={styles.center}><ListSkeleton count={2} /><Text style={styles.centerText}>Oturum güvenli biçimde yükleniyor…</Text></View>;
  if (!user) return <AuthFlow auth={auth} saveSession={saveSession} apiError={apiError} onSession={setUser} allowedRole="driver" />;

  const body = tab === 'jobs'
    ? <DriverJobs loading={jobsLoading} error={jobsError} jobs={jobs} selected={selected} form={offerForm} setForm={setOfferForm} formErrors={offerErrors} setFormErrors={setOfferErrors} saving={offerSaving} onOpen={openJob} onClose={() => setSelected(null)} onAdjust={adjustOffer} onSaveOffer={saveOffer} onStatus={(load, status) => setConfirmation({ type: 'status', target: load, status })} retry={fetchJobs} onShowOffers={() => setTab('offers')} />
    : tab === 'offers'
      ? <DriverOffers loading={myOffersLoading} error={offersError} items={myOffers} onOpen={(load, offer) => { setTab('jobs'); openJob(load, offer); }} onWithdraw={offer => setConfirmation({ type: 'withdraw', target: offer })} retry={fetchOffers} />
      : tab === 'messages'
        ? <ConversationCenter currentUser={user} api={conversations} apiError={apiError} resolveMediaUrl={resolveMediaUrl} formatMoney={formatMoney} loadStatusLabel={loadStatusLabel} onOpenLoad={openMessageLoad} initialConversationId={pendingConversationId} onInitialConversationHandled={handleInitialConversation} reverseGeocode={maps.reverse} nativeMapsConfigured={nativeGoogleMapsConfigured} nativeMapsMessage={nativeGoogleMapsMessage} bottomInset={control.bottomNavHeight + insets.bottom} />
        : <DriverAccount loading={accountLoading} error={accountError} account={account} form={accountForm} setForm={setAccountForm} save={saveAccount} saveLoading={accountSaving} changePassword={changePassword} passwordLoading={passwordSaving} logout={() => setConfirmation({ type: 'logout' })} retry={fetchAccount} />;

  const refresh = tab === 'jobs' ? fetchJobs : tab === 'offers' ? fetchOffers : tab === 'account' ? fetchAccount : undefined;
  const confirmationAction = confirmation?.type === 'status' ? driverStatusAction(confirmation.target?.status) : null;
  return <View style={styles.screen}>
    <StatusBar style="light" />
    <AppHeader title="NakliyeGo" subtitle={tab === 'jobs' ? 'Şoför paneli' : tab === 'offers' ? 'Teklif yönetimi' : tab === 'messages' ? 'Mesajlar' : 'Hesabım'} initials={user.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()} topInset={insets.top} />
    {tab === 'messages' ? body : <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={[styles.content, { paddingBottom: control.bottomNavHeight + insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false} refreshControl={refresh ? <RefreshControl refreshing={tab === 'jobs' ? jobsLoading : tab === 'offers' ? myOffersLoading : accountLoading} onRefresh={refresh} tintColor={colors.primary} /> : undefined}>{body}</ScrollView></KeyboardAvoidingView>}
    <BottomNav items={navItems} value={tab} onChange={value => { setTab(value); if (value !== 'jobs') setSelected(null); }} bottomInset={insets.bottom} />
    <ConfirmationModal
      visible={Boolean(confirmation)}
      title={confirmation?.type === 'withdraw' ? 'Teklifi geri çek' : confirmationAction?.title || 'Hesaptan çıkış'}
      message={confirmation?.type === 'withdraw' ? 'Teklif müşterinin ekranından kaldırılacak.' : confirmationAction?.message || 'Hesabınızdan çıkış yapmak istediğinizden emin misiniz?'}
      confirmLabel={confirmation?.type === 'withdraw' ? 'Geri çek' : confirmationAction?.confirmLabel || 'Çıkış yap'}
      destructive={confirmation?.type !== 'status'}
      loading={confirmationLoading}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => confirmation?.type === 'withdraw' ? performWithdrawOffer(confirmation.target) : confirmation?.type === 'status' ? performUpdateJobStatus(confirmation.target, confirmation.status) : performLogout()}
    />
  </View>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 }, flex: { flex: 1 }, content: { paddingHorizontal: spacing.md, paddingTop: spacing.lg }, center: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, centerText: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
});
