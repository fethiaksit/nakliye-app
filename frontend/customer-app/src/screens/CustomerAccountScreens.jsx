import React, { useCallback, useEffect, useState } from 'react';

import {
  AccountJobsPage,
  AccountMenuItem,
  AccountMenuSection,
  AccountProfileCard,
  DeviceNotificationsPage,
  LegalPage,
  PasswordPage,
  PersonalInfoPage,
  ProfileEditPage,
  SupportDetailPage,
  SupportListPage,
  SupportNewPage,
  useAccountBack,
} from '../../../shared/ui/account';
import { ListSkeleton, ScreenState } from '../../../shared/ui/primitives';
import { useToast } from '../../../shared/ui/feedback';
import { loads, support, apiError } from '../services/api';
import { formatMoney, loadStatusLabel, resolveMediaUrl } from '../utils/presentation';
import CorporateAccountScreens from './CorporateAccountScreens';

const backPage = page => ({ 'profile-edit': 'personal', 'support-new': 'support', 'support-detail': 'support' }[page] || 'home');
const initialSupportForm = () => ({ type: 'complaint', subject: '', reason: '', description: '', loadId: '' });

export default function CustomerAccountScreens({ page, onPageChange, loading, error, account, form, setForm, save, saveLoading, changePassword, passwordLoading, logout, retry, onOpenLoad, onPermissionGranted }) {
  const { showToast } = useToast();
  const [accountLoads, setAccountLoads] = useState([]);
  const [loadsState, setLoadsState] = useState({ loading: false, error: '' });
  const [tickets, setTickets] = useState([]);
  const [ticketsState, setTicketsState] = useState({ loading: false, error: '' });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [supportForm, setSupportForm] = useState(initialSupportForm);
  const [supportSaving, setSupportSaving] = useState(false);

  const isCorporate = account?.accountType === 'corporate';
  useAccountBack(isCorporate ? 'home' : page, onPageChange, backPage);

  const fetchAccountLoads = useCallback(async () => {
    setLoadsState({ loading: true, error: '' });
    try {
      const { data } = await loads.mine({ limit: 100 });
      setAccountLoads(data.items || []);
      setLoadsState({ loading: false, error: '' });
    } catch (loadError) {
      setLoadsState({ loading: false, error: apiError(loadError) });
    }
  }, []);
  const fetchTickets = useCallback(async () => {
    setTicketsState({ loading: true, error: '' });
    try {
      const { data } = await support.list();
      setTickets(data.items || []);
      setTicketsState({ loading: false, error: '' });
    } catch (ticketError) {
      setTicketsState({ loading: false, error: apiError(ticketError) });
    }
  }, []);

  useEffect(() => {
	if (isCorporate) return;
    if (['active-jobs', 'history-jobs', 'support-new'].includes(page)) void fetchAccountLoads();
    if (page === 'support') void fetchTickets();
  }, [fetchAccountLoads, fetchTickets, isCorporate, page]);
  useEffect(() => {
    if (page !== 'password') setForm(current => current.currentPassword || current.newPassword || current.newPasswordConfirm ? { ...current, currentPassword: '', newPassword: '', newPasswordConfirm: '' } : current);
  }, [page, setForm]);

  if (loading && !account) return <ListSkeleton count={3} />;
  if (error || !account) return <ScreenState type="error" title="Hesap yüklenemedi" message={error || 'Profil bulunamadı.'} onRetry={retry} />;
	if (isCorporate) return <CorporateAccountScreens page={page} onPageChange={onPageChange} account={account} form={form} setForm={setForm} changePassword={changePassword} passwordLoading={passwordLoading} logout={logout} onOpenLoad={onOpenLoad} onPermissionGranted={onPermissionGranted} />;

  const submitSupport = async () => {
    if (!supportForm.subject.trim() || !supportForm.description.trim() || (supportForm.type === 'complaint' && !supportForm.reason)) {
      showToast('Konu, açıklama ve şikâyet sebebini kontrol edin.', { type: 'error', title: 'Eksik bilgi' });
      return;
    }
    setSupportSaving(true);
    try {
      await support.create({ ...supportForm, subject: supportForm.subject.trim(), description: supportForm.description.trim() });
      setSupportForm(initialSupportForm());
      await fetchTickets();
      onPageChange('support');
      showToast('Bildiriminiz destek ekibine iletildi.', { type: 'success', title: 'Bildirim oluşturuldu' });
    } catch (submitError) {
      showToast(apiError(submitError), { type: 'error', title: 'Bildirim gönderilemedi' });
    } finally {
      setSupportSaving(false);
    }
  };
  const openTicket = async item => {
    setSelectedTicket(item);
    onPageChange('support-detail');
    try {
      const { data } = await support.get((item.complaint || item).id);
      setSelectedTicket(data);
    } catch (ticketError) {
      showToast(apiError(ticketError), { type: 'error', title: 'Bildirim açılamadı' });
    }
  };

  if (page === 'personal') return <PersonalInfoPage account={account} onBack={() => onPageChange('home')} onEdit={() => { setForm(current => ({ ...current, name: account.name || '', email: account.email || '', phone: account.phone || '' })); onPageChange('profile-edit'); }} />;
  if (page === 'profile-edit') return <ProfileEditPage form={form} setForm={setForm} loading={saveLoading} onSave={async () => { if (await save()) onPageChange('personal'); }} onCancel={() => onPageChange('personal')} />;
  if (page === 'password') return <PasswordPage form={form} setForm={setForm} loading={passwordLoading} onSubmit={changePassword} onBack={() => onPageChange('home')} />;
  if (page === 'active-jobs') return <AccountJobsPage title="Aktif Nakliyelerim" subtitle="Devam eden ve henüz sonuçlanmamış nakliyeler" items={accountLoads.filter(load => !['completed', 'cancelled'].includes(load.status))} loading={loadsState.loading} error={loadsState.error} onRetry={fetchAccountLoads} onBack={() => onPageChange('home')} onOpen={onOpenLoad} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} emptyMessage="Aktif nakliyeniz bulunmuyor." />;
  if (page === 'history-jobs') return <AccountJobsPage title="Geçmiş Nakliyelerim" subtitle="Tamamlanan ve iptal edilen nakliyeler" items={accountLoads.filter(load => ['completed', 'cancelled'].includes(load.status))} loading={loadsState.loading} error={loadsState.error} onRetry={fetchAccountLoads} onBack={() => onPageChange('home')} onOpen={onOpenLoad} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} emptyMessage="Geçmiş nakliye kaydınız bulunmuyor." />;
  if (page === 'support') return <SupportListPage items={tickets} loading={ticketsState.loading} error={ticketsState.error} onRetry={fetchTickets} onBack={() => onPageChange('home')} onNew={() => { setSupportForm(initialSupportForm()); onPageChange('support-new'); }} onOpen={openTicket} />;
  if (page === 'support-new') return <SupportNewPage form={supportForm} setForm={setSupportForm} loads={accountLoads.filter(load => load.assignedDriverId)} loading={supportSaving} onSubmit={submitSupport} onBack={() => onPageChange('support')} />;
  if (page === 'support-detail') return <SupportDetailPage item={selectedTicket} onBack={() => onPageChange('support')} />;
  if (page === 'notifications') return <DeviceNotificationsPage onBack={() => onPageChange('home')} onPermissionGranted={onPermissionGranted} />;
  if (page === 'privacy') return <LegalPage type="privacy" onBack={() => onPageChange('home')} />;
  if (page === 'terms') return <LegalPage type="terms" onBack={() => onPageChange('home')} />;

  return <>
    <AccountProfileCard account={account} roleLabel="Müşteri hesabı" meta={`NakliyeGo üyesi · ${new Date(account.createdAt).toLocaleDateString('tr-TR')}`} />
    <AccountMenuSection title="Hesap">
      <AccountMenuItem icon="person-outline" label="Kişisel Bilgiler" description="Profil ve iletişim bilgileri" onPress={() => onPageChange('personal')} />
      <AccountMenuItem icon="lock-closed-outline" label="Şifre Değiştir" description="Hesap güvenliğini güncelle" last onPress={() => onPageChange('password')} />
    </AccountMenuSection>
    <AccountMenuSection title="Nakliye">
      <AccountMenuItem icon="navigate-outline" label="Aktif Nakliyelerim" description="Devam eden nakliyeler" onPress={() => onPageChange('active-jobs')} />
      <AccountMenuItem icon="time-outline" label="Geçmiş Nakliyelerim" description="Tamamlanan ve iptal edilenler" last onPress={() => onPageChange('history-jobs')} />
    </AccountMenuSection>
    <AccountMenuSection title="Destek"><AccountMenuItem icon="chatbox-ellipses-outline" label="Şikâyet ve Öneri" description="Bildirim oluştur ve takip et" last onPress={() => onPageChange('support')} /></AccountMenuSection>
    <AccountMenuSection title="Uygulama">
      <AccountMenuItem icon="notifications-outline" label="Bildirim Ayarları" onPress={() => onPageChange('notifications')} />
      <AccountMenuItem icon="shield-checkmark-outline" label="Gizlilik Politikası" onPress={() => onPageChange('privacy')} />
      <AccountMenuItem icon="document-text-outline" label="Kullanım Koşulları" last onPress={() => onPageChange('terms')} />
    </AccountMenuSection>
    <AccountMenuSection title="Oturum"><AccountMenuItem icon="log-out-outline" label="Çıkış Yap" danger last onPress={logout} /></AccountMenuSection>
  </>;
}
