import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmationModal, ToastProvider, useToast } from '../shared/ui/feedback';
import {
  AppHeader,
  BottomNav,
  EdgeSwipeBack,
  resolveDriverAccountBackPage,
  useAndroidBackHandler,
  useListScrollPreservation,
} from '../shared/ui/navigation';
import LegalModal from '../shared/ui/LegalModal';
import { ListSkeleton } from '../shared/ui/primitives';
import { colors, control, spacing, typography } from '../shared/ui/theme';
import { subscribeDevicePushRegistration, subscribeNotificationResponses, unregisterDevicePushToken } from '../shared/notifications';
import { apiError, auth, conversations, loads, logApiError, maps, offers, profile, push, restoreSession, saveSession, subscribeSessionExpired, updateStoredUser } from './src/services/api';
import AuthFlow from './src/components/AuthFlow';
import ConversationCenter from './src/components/ConversationCenter';
import { nativeGoogleMapsConfigured, nativeGoogleMapsMessage } from './src/config/maps';
import { DriverJobDetail, DriverJobs, DriverOffers } from './src/screens/DriverScreens';
import DriverAccountScreens from './src/screens/DriverAccountScreens';
import PaymentApprovalModal from './src/components/driver/PaymentApprovalModal';
import { parseWalletUnits } from '../shared/walletMoney.mjs';
import { driverStatusAction, formatMoney, loadStatusLabel, requiresDriverPaymentApproval, resolveMediaUrl, toFiniteNumber } from './src/utils/presentation';
import { mobileSentry } from '../shared/sentry';
import { posthog } from '../shared/posthog';

mobileSentry.init({ appName: 'nakliyego-driver', release: '1.0.0' });
posthog.init({ appName: 'nakliyego-driver', release: '1.0.0', platform: 'mobile' });

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
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [myOffers, setMyOffers] = useState([]);
  const [myOffersLoading, setMyOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState('');
  const [account, setAccount] = useState(null);
  const [accountPage, setAccountPage] = useState('home');
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', email: '', phone: '', vehicleType: '', vehicleModel: '', licensePlate: '', capacityKg: '', serviceArea: '', licenseStatus: '', nearbyLoadNotifications: false, currentPassword: '', newPassword: '', newPasswordConfirm: '' });
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [activePaymentModalLoad, setActivePaymentModalLoad] = useState(null);
  const dismissedApprovalIds = useRef(new Set());
  const jobsAbort = useRef(null);
  const [notificationData, setNotificationData] = useState(null);
  const [pendingConversationId, setPendingConversationId] = useState('');
  const pushToken = useRef(null);
  const pushRegistration = useRef(null);
  const [isChatActive, setIsChatActive] = useState(false);
  const [isActiveApp, setIsActiveApp] = useState(AppState.currentState === 'active');
  const jobsRequestId = useRef(0);
  const jobsBusy = useRef(false);
  const offersRequestId = useRef(0);
  const offersBusy = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setIsActiveApp(state === 'active'));
    return () => subscription.remove();
  }, []);

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
    setAccountPage('home');
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
    const stop = subscribeDevicePushRegistration(push, token => { pushToken.current = token; }, error => logApiError('DRIVER PUSH REGISTER', error));
    pushRegistration.current = stop;
    return () => { void stop(); };
  }, [user?.id]);

  const fetchJobs = useCallback(async (silent = false) => {
    if (restoring || !user || user.role !== 'driver' || jobsBusy.current) return;
    jobsBusy.current = true;
    const reqId = ++jobsRequestId.current;
    jobsAbort.current?.abort();
    const controller = new AbortController();
    jobsAbort.current = controller;
    if (!silent) {
      setJobsLoading(true);
      setJobsError('');
    }
    try {
      const { data } = await loads.list({ limit: 100 }, { signal: controller.signal });
      if (!Array.isArray(data?.items)) throw new Error('Jobs response is not an items array.');
      if (reqId === jobsRequestId.current) {
        setJobs(data.items);
        setSelected(current => {
          if (!current?.id) return current;
          const updated = data.items.find(item => item.id === current.id);
          return updated || current;
        });
        setJobsError('');
      }
    } catch (error) {
      if (error.name !== 'CanceledError' && error.code !== 'ERR_CANCELED') {
        logApiError('DRIVER JOBS', error);
        if (!silent && reqId === jobsRequestId.current) {
          setJobsError(apiError(error));
        }
      }
    } finally {
      jobsBusy.current = false;
      if (jobsAbort.current === controller) {
        jobsAbort.current = null;
        if (!silent && reqId === jobsRequestId.current) {
          setJobsLoading(false);
        }
      }
    }
  }, [restoring, user?.id, user?.role]);

  const fetchOffers = useCallback(async (silent = false) => {
    if (offersBusy.current) return;
    offersBusy.current = true;
    const reqId = ++offersRequestId.current;
    if (!silent) {
      setMyOffersLoading(true);
      setOffersError('');
    }
    try {
      const { data } = await offers.list();
      if (reqId === offersRequestId.current) {
        const incoming = data.items || [];
        setMyOffers(incoming);
        setSelectedOffer(current => {
          if (!current?.id) return current;
          const match = incoming.find(item => item.offer?.id === current.id);
          return match?.offer ? { ...current, ...match.offer } : current;
        });
        setOffersError('');
      }
    } catch (error) {
      if (!silent && reqId === offersRequestId.current) {
        setOffersError(apiError(error));
      }
    } finally {
      offersBusy.current = false;
      if (!silent && reqId === offersRequestId.current) {
        setMyOffersLoading(false);
      }
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
    void fetchOffers(true);
    if (tab === 'jobs') {
      void fetchJobs();
      void fetchOffers();
    }
    if (tab === 'offers') void fetchOffers();
    if (tab === 'account') void fetchAccount();
  }, [fetchAccount, fetchJobs, fetchOffers, restoring, tab, user?.id, user?.role]);

  // 12-second background silent poll for offers across all tabs to catch payment requests promptly
  useEffect(() => {
    if (restoring || !user || user.role !== 'driver' || !isActiveApp) return undefined;
    const interval = setInterval(() => {
      void fetchOffers(true);
      if (tab === 'jobs') {
        void fetchJobs(true);
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchOffers, isActiveApp, restoring, tab, user]);

  // Immediate refresh on foreground resume
  const prevActiveAppRef = useRef(isActiveApp);
  useEffect(() => {
    const wasActive = prevActiveAppRef.current;
    prevActiveAppRef.current = isActiveApp;
    if (!wasActive && isActiveApp && user?.role === 'driver') {
      void fetchOffers(true);
      if (tab === 'jobs') {
        void fetchJobs(true);
      } else if (tab === 'account') {
        void fetchAccount();
      }
    }
  }, [fetchAccount, fetchJobs, fetchOffers, isActiveApp, tab, user?.role]);

  const isDetailOpen = Boolean(selected) && (tab === 'jobs' || tab === 'offers');
  const hasModal = Boolean(confirmation || (user && user.termsUpdateRequired));
  // Detail approval state must not depend on whether the job is in the first
  // list page. Fetch immediately on open/resume and poll the authoritative load.
  useEffect(() => {
    if (!isDetailOpen || !isActiveApp || !selected?.id) return undefined;
    const id = selected.id;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const { data } = await loads.get(id);
        if (active) setSelected(current => current?.id === id ? data : current);
      } catch (error) { if (active) logApiError('DRIVER LOAD DETAIL', error); }
      finally { busy = false; }
    };
    void refresh();
    const interval = setInterval(refresh, 12000);
    return () => { active = false; clearInterval(interval); };
  }, [isDetailOpen, isActiveApp, selected?.id, selected?.status, selected?.paymentApproval?.status]);

  const offerLoadItems = useMemo(
    () => myOffers.filter(item => item?.offer && item?.load).map(item => ({ id: item.load.id })),
    [myOffers],
  );
  const listScroll = useListScrollPreservation({
    activeTab: tab,
    isDetailOpen,
    accountPage,
    itemsByTab: {
      jobs,
      offers: offerLoadItems,
    },
  });

  const closeJobDetail = useCallback(() => {
    setSelected(null);
    setSelectedOffer(null);
    setOfferErrors({});
  }, []);

  const handleAccountBack = useCallback(() => {
    setAccountPage(current => resolveDriverAccountBackPage(current));
  }, []);

  const handleFilterChange = useCallback(() => {
    listScroll.clearAnchor('jobs');
  }, [listScroll]);

  useAndroidBackHandler(isDetailOpen && !hasModal, closeJobDetail);

  const openJob = useCallback((load, offer = null, targetTab) => {
    const anchorTab = targetTab || tab;
    if (load?.id && (anchorTab === 'jobs' || anchorTab === 'offers')) {
      listScroll.rememberItem(anchorTab, load.id);
    }
    setSelected(load);
    setSelectedOffer(offer);
    setOfferErrors({});
    setOfferForm({ amount: !offer && load.pricing?.manualQuoteRequired ? '' : String(toFiniteNumber(offer?.amountTl, toFiniteNumber(load.pricing?.recommendedPrice, toFiniteNumber(load.basePriceTl, toFiniteNumber(load.agreedPriceTl))))), note: offer?.note || '', eta: String(offer?.estimatedArrivalMinutes || 45) });
  }, [listScroll, tab]);
  const openMessageLoad = useCallback(async id => {
    try {
      const { data } = await loads.get(id);
      setTab('jobs');
      openJob(data, null, 'jobs');
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
      const loadId = String(notificationData.loadId);
      loads.get(loadId).then(({ data }) => {
        openJob(data, null, 'jobs');
        if (requiresDriverPaymentApproval(data) && data.paymentApproval?.driverId === user.id && data.paymentApproval?.status === 'pending') {
          setActivePaymentModalLoad(data);
        }
      }).catch(err => {
        openMessageLoad(loadId);
      });
    }
    setNotificationData(null);
  }, [notificationData, openMessageLoad, user]);
  const handleInitialConversation = useCallback(() => setPendingConversationId(''), []);
  const decidePayment = useCallback(async (load, accept) => {
    if (!load?.paymentApproval?.id || confirmationLoading) return;
    setConfirmationLoading(true);
    try {
      const { data } = await loads.paymentApproval(load.id, load.paymentApproval.id, accept);
      setSelected(data);
      setActivePaymentModalLoad(null);
      await Promise.all([fetchJobs(), fetchOffers()]);
      showToast(accept ? 'Ödeme şekli onaylandı; iş size atandı.' : 'Ödeme şekli reddedildi; kredi müşteriye iade edildi.', { type: 'success' });
    } catch (error) { showToast(apiError(error), { type: 'error', title: 'Ödeme kararı kaydedilemedi' }); }
    finally { setConfirmationLoading(false); }
  }, [confirmationLoading, fetchJobs, fetchOffers, showToast]);

  const handleOpenPaymentModal = useCallback(load => {
    if (load?.paymentApproval) {
      setActivePaymentModalLoad(load);
    }
  }, []);

  const handleDismissPaymentModal = useCallback(() => {
    if (activePaymentModalLoad?.paymentApproval?.id) {
      dismissedApprovalIds.current.add(activePaymentModalLoad.paymentApproval.id);
    }
    setActivePaymentModalLoad(null);
  }, [activePaymentModalLoad]);

  // Check for pending payment approvals on load/offer update or app active
  useEffect(() => {
    if (!user || user.role !== 'driver' || activePaymentModalLoad) return;
    const isPendingApproval = load => requiresDriverPaymentApproval(load) && load.paymentApproval?.driverId === user.id && load.paymentApproval?.status === 'pending';
    const pendingLoad = jobs.find(isPendingApproval) || myOffers.map(item => item?.load).find(load => load && isPendingApproval(load));
    if (pendingLoad && pendingLoad.paymentApproval?.id) {
      if (!dismissedApprovalIds.current.has(pendingLoad.paymentApproval.id)) {
        setActivePaymentModalLoad(pendingLoad);
      }
    }
  }, [activePaymentModalLoad, isActiveApp, jobs, myOffers, user]);
  const adjustOffer = useCallback(delta => {
    setOfferForm(current => ({ ...current, amount: String(Math.max(0, toFiniteNumber(current.amount) + delta)) }));
    setOfferErrors(current => ({ ...current, amount: '' }));
  }, []);
  const saveOffer = useCallback(async () => {
    if (!selected) return;
    if (!posthog.isFeatureEnabled('offers_enabled', true)) {
      showToast('Teklif verme özelliği geçici olarak durdurulmuştur.', { type: 'error', title: 'Özellik Devre Dışı' });
      return;
    }
    const amountCents = parseWalletUnits(offerForm.amount);
    const amountTl = amountCents === null ? 0 : amountCents / 100;
    const estimatedArrivalMinutes = Math.round(toFiniteNumber(offerForm.eta));
    const errors = {};
    if (amountTl <= 0) errors.amount = 'En fazla iki ondalık haneli geçerli bir teklif fiyatı girin.';
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
      posthog.capture('offer_submitted', {
        loadId: selected.id,
        amountTl,
        estimatedArrivalMinutes,
        isUpdate: updated,
      });
      closeJobDetail();
      await fetchJobs();
      await fetchOffers();
      showToast(updated ? 'Teklifiniz güncellendi.' : 'Teklifiniz müşterinin onayına gönderildi.', { type: 'success', title: 'Teklif kaydedildi' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teklif kaydedilemedi' });
    } finally {
      setOfferSaving(false);
    }
  }, [closeJobDetail, fetchJobs, fetchOffers, offerForm, selected, selectedOffer, showToast]);
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
      closeJobDetail();
      setConfirmation(null);
      showToast(driverStatusAction(load.status)?.successMessage || 'Operasyon durumu güncellendi.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Durum güncellenemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [closeJobDetail, fetchJobs, fetchOffers, showToast]);
  const performCompleteDelivery = useCallback(async (load, proof) => {
    setDeliverySaving(true);
    try {
      await loads.completeDelivery(load.id, proof);
      posthog.capture('delivery_completed', {
        loadId: load.id,
        hasPhotoProof: Boolean(proof?.photo),
      });
      await fetchJobs();
      await fetchOffers();
      closeJobDetail();
      showToast('Teslimat kodu ve fotoğraf doğrulandı. İş tamamlandı.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Teslimat tamamlanamadı' });
    } finally {
      setDeliverySaving(false);
    }
  }, [closeJobDetail, fetchJobs, fetchOffers, showToast]);
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
  const updateNearbyNotifications = useCallback(async value => {
    if (!account) return;
    setNotificationSaving(true);
    try {
      const { data } = await profile.update({ driverProfile: { ...(account.driverProfile || {}), nearbyLoadNotifications: value } });
      setAccount(data);
      setUser(data);
      setAccountForm(current => ({ ...current, nearbyLoadNotifications: value }));
      await updateStoredUser(data);
      showToast('Bildirim tercihiniz kaydedildi.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Bildirim ayarı kaydedilemedi' });
    } finally {
      setNotificationSaving(false);
    }
  }, [account, showToast]);
  const performLogout = useCallback(async () => {
    setConfirmationLoading(true);
    try {
      const pendingToken = await pushRegistration.current?.();
      pushRegistration.current = null;
      await unregisterDevicePushToken(push, pendingToken || pushToken.current).catch(error => logApiError('DRIVER PUSH UNREGISTER', error));
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

  const openAccountLoad = useCallback(load => {
    setAccountPage('home');
    setTab('jobs');
    openJob(load, null, 'jobs');
  }, [openJob]);
  const registerPushAfterPermission = useCallback(async () => {
    const token = await pushRegistration.current?.refresh();
    if (token) pushToken.current = token;
  }, []);
  const handleMainPaneSwipeBack = useCallback(() => {
    if (tab === 'account' && accountPage !== 'home') {
      handleAccountBack();
    } else if (tab === 'offers') {
      setTab('jobs');
    }
  }, [accountPage, handleAccountBack, tab]);

  if (restoring) return <View style={styles.center}><ListSkeleton count={2} /><Text style={styles.centerText}>Oturum güvenli biçimde yükleniyor…</Text></View>;
  if (!user) return <AuthFlow auth={auth} saveSession={saveSession} apiError={apiError} onSession={setUser} allowedRole="driver" />;

  const body = tab === 'jobs'
    ? <DriverJobs renderDetailInline={false} onItemLayout={listScroll.onItemLayout} onFilterChange={handleFilterChange} loading={jobsLoading} error={jobsError} jobs={jobs} selected={selected} selectedOffer={selectedOffer} form={offerForm} setForm={setOfferForm} formErrors={offerErrors} setFormErrors={setOfferErrors} saving={offerSaving} deliverySaving={deliverySaving} onOpen={load => { openJob(load, null, 'jobs'); if (requiresDriverPaymentApproval(load) && load.paymentApproval?.driverId === user.id && load.paymentApproval?.status === 'pending') handleOpenPaymentModal(load); }} onClose={closeJobDetail} onAdjust={adjustOffer} onSaveOffer={saveOffer} onStatus={(load, status) => setConfirmation({ type: 'status', target: load, status })} onPaymentApproval={decidePayment} paymentSaving={confirmationLoading} onCompleteDelivery={performCompleteDelivery} retry={fetchJobs} onShowOffers={() => setTab('offers')} myOffers={myOffers} user={user} />
    : tab === 'offers'
      ? <DriverOffers onItemLayout={listScroll.onItemLayout} loading={myOffersLoading} error={offersError} items={myOffers} onOpen={(load, offer) => { openJob(load, offer, 'offers'); if (requiresDriverPaymentApproval(load) && load.paymentApproval?.driverId === user.id && load.paymentApproval?.status === 'pending') handleOpenPaymentModal(load); }} onWithdraw={offer => setConfirmation({ type: 'withdraw', target: offer })} retry={fetchOffers} />
      : tab === 'messages'
        ? <ConversationCenter
            currentUser={user}
            api={conversations}
            apiError={apiError}
            resolveMediaUrl={resolveMediaUrl}
            formatMoney={formatMoney}
            loadStatusLabel={loadStatusLabel}
            onOpenLoad={openMessageLoad}
            initialConversationId={pendingConversationId}
            onInitialConversationHandled={handleInitialConversation}
            reverseGeocode={maps.reverse}
            nativeMapsConfigured={nativeGoogleMapsConfigured}
            nativeMapsMessage={nativeGoogleMapsMessage}
            onActiveChange={setIsChatActive}
            topInset={insets.top}
            bottomInset={isChatActive ? insets.bottom : (control.bottomNavHeight + insets.bottom)}
          />
        : <DriverAccountScreens page={accountPage} onPageChange={setAccountPage} loading={accountLoading} error={accountError} account={account} form={accountForm} setForm={setAccountForm} save={saveAccount} saveLoading={accountSaving} changePassword={changePassword} passwordLoading={passwordSaving} logout={() => setConfirmation({ type: 'logout' })} retry={fetchAccount} onOpenLoad={openAccountLoad} onPermissionGranted={registerPushAfterPermission} notificationSaving={notificationSaving} onNotificationChange={updateNearbyNotifications} />;

  const refresh = tab === 'jobs' ? () => { void fetchJobs(); void fetchOffers(); } : tab === 'offers' ? fetchOffers : tab === 'account' && accountPage === 'home' ? fetchAccount : undefined;
  const showBottomNav = (tab !== 'account' || accountPage === 'home') && !(tab === 'messages' && isChatActive);
  const bottomContentPadding = (showBottomNav ? control.bottomNavHeight + insets.bottom : insets.bottom) + spacing.xl;
  const confirmationAction = confirmation?.type === 'status' ? driverStatusAction(confirmation.target?.status) : null;
  const canSwipeMainPane = !isDetailOpen && !hasModal && ((tab === 'account' && accountPage !== 'home') || tab === 'offers');

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <AppHeader title="NakliyeGo" subtitle={tab === 'jobs' ? 'Şoför' : tab === 'offers' ? 'Tekliflerim' : tab === 'messages' ? 'Mesajlar' : 'Hesabım'} initials={user.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()} topInset={insets.top} />
      {tab === 'messages' ? body : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <EdgeSwipeBack
            enabled={canSwipeMainPane}
            modalOpen={hasModal}
            onBack={handleMainPaneSwipeBack}
            style={styles.flex}
          >
            <ScrollView
              ref={listScroll.scrollRef}
              onScroll={listScroll.onScroll}
              onScrollBeginDrag={listScroll.onScrollBeginDrag}
              onLayout={listScroll.onViewportLayout}
              onContentSizeChange={listScroll.onContentSizeChange}
              scrollEventThrottle={16}
              pointerEvents={isDetailOpen ? 'none' : 'auto'}
              contentContainerStyle={[styles.content, { paddingBottom: bottomContentPadding }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
              refreshControl={refresh ? <RefreshControl refreshing={tab === 'jobs' ? jobsLoading : tab === 'offers' ? myOffersLoading : accountLoading} onRefresh={refresh} tintColor={colors.primary} /> : undefined}
            >
              {body}
            </ScrollView>
          </EdgeSwipeBack>
          {isDetailOpen ? (
            <EdgeSwipeBack
              enabled={!hasModal}
              modalOpen={hasModal}
              onBack={closeJobDetail}
              style={styles.detailOverlay}
            >
              <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: bottomContentPadding }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                showsVerticalScrollIndicator={false}
              >
                <DriverJobDetail
                  selected={selected}
                  selectedOffer={selectedOffer}
                  form={offerForm}
                  setForm={setOfferForm}
                  formErrors={offerErrors}
                  setFormErrors={setOfferErrors}
                  saving={offerSaving}
                  deliverySaving={deliverySaving}
                  onClose={closeJobDetail}
                  onAdjust={adjustOffer}
                  onSaveOffer={saveOffer}
                  onStatus={(load, status) => setConfirmation({ type: 'status', target: load, status })}
                  onPaymentApproval={decidePayment} paymentSaving={confirmationLoading} onCompleteDelivery={performCompleteDelivery}
                  user={user}
                  backLabel={tab === 'offers' ? 'Tekliflerime dön' : 'İşlere dön'}
                />
              </ScrollView>
            </EdgeSwipeBack>
          ) : null}
        </KeyboardAvoidingView>
      )}
      {showBottomNav ? <BottomNav items={navItems} value={tab} onChange={value => { setTab(value); setAccountPage('home'); closeJobDetail(); }} bottomInset={insets.bottom} /> : null}
      <PaymentApprovalModal
        visible={Boolean(activePaymentModalLoad)}
        load={activePaymentModalLoad}
        loading={confirmationLoading}
        onApprove={load => decidePayment(load, true)}
        onReject={load => decidePayment(load, false)}
        onClose={handleDismissPaymentModal}
      />
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
      <LegalModal
        visible={Boolean(user && user.termsUpdateRequired)}
        docType="driverTerms"
        onClose={() => setUser(current => current ? { ...current, termsUpdateRequired: false } : current)}
        onAccept={async () => {
          try {
            await profile.updateAgreements({ termsAccepted: true, termsVersion: '1.0.0' });
            setUser(current => current ? { ...current, termsUpdateRequired: false, termsVersion: '1.0.0' } : current);
            showToast('Şoför hizmet koşulları onayınız güncellendi.', { type: 'success' });
          } catch (e) {
            showToast(apiError(e), { type: 'error' });
          }
        }}
        acceptLabel="Güncel Şartları Kabul Ediyorum"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 }, flex: { flex: 1 }, detailOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.md, paddingTop: spacing.lg }, center: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, centerText: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
});
