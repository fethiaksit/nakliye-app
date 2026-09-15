import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatWalletCents } from '../../../shared/walletMoney.mjs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import DatePickerField from '../../../shared/ui/DatePickerField';
import Icon from '../../../shared/ui/Icon';
import {
  AccountBackHeader,
  AccountJobsPage,
  AccountMenuItem,
  AccountMenuSection,
  AccountProfileCard,
  DeviceNotificationsPage,
  LegalPage,
  PasswordPage,
  SupportDetailPage,
  SupportListPage,
  SupportNewPage,
  useAccountBack,
} from '../../../shared/ui/account';
import { DetailRow, ListingCard } from '../../../shared/ui/listing';
import { useToast } from '../../../shared/ui/feedback';
import { AppButton, ListSkeleton, ScreenState, SectionCard, SegmentedControl, TextField } from '../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';
import { apiError, corporate, loads, support } from '../services/api';
import { formatMoney, loadStatusLabel, resolveMediaUrl } from '../utils/presentation';

const backPage = page => ({ 'company-edit': 'company', 'support-new': 'support', 'support-detail': 'support' }[page] || 'home');
const initialSupportForm = () => ({ type: 'complaint', subject: '', reason: '', description: '', loadId: '' });
const companyFormFor = company => ({
  name: company?.name || '', authorizedPerson: company?.authorizedPerson || '', taxNumber: company?.taxNumber || '',
  taxOffice: company?.taxOffice || '', address: company?.address || '', phone: company?.phone || '', email: company?.email || '',
});
const centsMoney = formatWalletCents;
const isSameMonth = (date, reference) => date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();

function DashboardCard({ icon, label, value, hint, onPress }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.dashboardCard, pressed && styles.pressed]}>
    <View style={styles.dashboardIcon}><Icon name={icon} size={20} color={colors.primary} /></View>
    <Text style={styles.dashboardValue}>{value}</Text><Text style={styles.dashboardLabel}>{label}</Text>{hint ? <Text style={styles.dashboardHint}>{hint}</Text> : null}
  </Pressable>;
}

function WalletTransactions({ items = [], compact = false }) {
  if (!items.length) return <ScreenState compact title="Henüz hareket yok" message="Tamamlanan uygun nakliyelerden kazanılan ve kullanılan krediler burada görünür." />;
  return <View>{items.map(transaction => <View key={transaction.id} style={styles.transactionRow}>
    <View style={[styles.transactionIcon, transaction.amountCents < 0 && styles.transactionIconUsage]}><Icon name={transaction.amountCents < 0 ? 'arrow-up-outline' : 'arrow-down-outline'} size={18} color={transaction.amountCents < 0 ? colors.warning : colors.success} /></View>
    <View style={styles.transactionCopy}><Text style={styles.transactionTitle}>{transaction.description}</Text><Text style={styles.transactionMeta} numberOfLines={compact ? 1 : undefined}>{transaction.pickupAddress && transaction.deliveryAddress ? `${transaction.pickupAddress} → ${transaction.deliveryAddress} · ` : ''}{new Date(transaction.createdAt).toLocaleDateString('tr-TR')}{!compact ? ` · Bakiye: ${centsMoney(transaction.balanceBeforeCents)} → ${centsMoney(transaction.balanceAfterCents)}${transaction.type === 'earn' ? ` · %${transaction.rewardRateBps / 100}` : ''}` : ''}</Text></View>
    <Text style={[styles.transactionAmount, transaction.amountCents < 0 && styles.transactionAmountUsage]}>{transaction.amountCents >= 0 ? '+' : '−'} {centsMoney(Math.abs(transaction.amountCents))}</Text>
  </View>)}</View>;
}

function CompanyPage({ company, onBack, onEdit }) {
  return <>
    <AccountBackHeader title="Firma Bilgileri" subtitle="Kurumsal hesabınıza kayıtlı bilgiler" onBack={onBack} />
    <SectionCard title={company?.name || 'Firma profili'} icon="business-outline">
      <DetailRow icon="person-outline" label="Yetkili" value={company?.authorizedPerson || 'Tamamlanmadı'} />
      <DetailRow icon="document-text-outline" label="Vergi numarası" value={company?.taxNumber || 'Tamamlanmadı'} />
      <DetailRow icon="business-outline" label="Vergi dairesi" value={company?.taxOffice || 'Tamamlanmadı'} />
      <DetailRow icon="location-outline" label="Firma adresi" value={company?.address || 'Tamamlanmadı'} />
      <DetailRow icon="call-outline" label="Telefon" value={company?.phone || '—'} />
      <DetailRow icon="mail-outline" label="E-posta" value={company?.email || '—'} />
    </SectionCard>
    <AppButton label="Düzenle" icon="create-outline" onPress={onEdit} />
  </>;
}

function CompanyEditPage({ form, setForm, loading, onSave, onBack }) {
  const field = (name, value) => setForm(current => ({ ...current, [name]: value }));
  return <>
    <AccountBackHeader title="Firma Bilgilerini Düzenle" subtitle="Vergi ve iletişim bilgilerini eksiksiz kaydedin" onBack={onBack} />
    <SectionCard title="Firma profili" icon="business-outline">
      <TextField required label="Firma adı" value={form.name} onChangeText={value => field('name', value)} leftIcon="business-outline" />
      <TextField required label="Yetkili kişi" value={form.authorizedPerson} onChangeText={value => field('authorizedPerson', value)} leftIcon="person-outline" />
      <TextField required label="Vergi numarası" value={form.taxNumber} onChangeText={value => field('taxNumber', value)} keyboardType="number-pad" leftIcon="document-text-outline" maxLength={11} />
      <TextField required label="Vergi dairesi" value={form.taxOffice} onChangeText={value => field('taxOffice', value)} leftIcon="business-outline" />
      <TextField required label="Firma adresi" value={form.address} onChangeText={value => field('address', value)} leftIcon="location-outline" multiline />
      <TextField required label="Telefon" value={form.phone} onChangeText={value => field('phone', value)} keyboardType="phone-pad" leftIcon="call-outline" />
      <TextField required label="E-posta" value={form.email} onChangeText={value => field('email', value)} keyboardType="email-address" autoCapitalize="none" leftIcon="mail-outline" />
    </SectionCard>
    <AppButton label="Firma Bilgilerini Kaydet" icon="save-outline" loading={loading} onPress={onSave} />
  </>;
}

function MonthlyCompletedPage({ items, loading, error, onRetry, onBack, onOpen }) {
  const [filter, setFilter] = useState('current');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const filtered = useMemo(() => {
    const now = new Date();
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return items.filter(load => {
      if (load.status !== 'completed') return false;
      const completedAt = new Date(load.updatedAt);
      if (filter === 'current') return isSameMonth(completedAt, now);
      if (filter === 'previous') return isSameMonth(completedAt, previous);
      if (!from || !to) return true;
      const start = new Date(from); start.setHours(0, 0, 0, 0);
      const end = new Date(to); end.setHours(23, 59, 59, 999);
      return completedAt >= start && completedAt <= end;
    });
  }, [filter, from, items, to]);
  return <>
    <AccountBackHeader title="Aylık Tamamlananlar" subtitle="Tamamlanan kurumsal nakliyeler" onBack={onBack} />
    <SectionCard title="Tarih filtresi" icon="calendar-outline">
      <SegmentedControl value={filter} onChange={setFilter} options={[{ value: 'current', label: 'Bu ay' }, { value: 'previous', label: 'Geçen ay' }, { value: 'range', label: 'Aralık' }]} />
      {filter === 'range' ? <View style={styles.dateRow}><DatePickerField label="Başlangıç" mode="date" value={from} onChange={setFrom} /><DatePickerField label="Bitiş" mode="date" value={to} onChange={setTo} /></View> : null}
    </SectionCard>
    {loading && !items.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Nakliyeler yüklenemedi" message={error} onRetry={onRetry} /> : !filtered.length ? <ScreenState title="Kayıt bulunamadı" message="Seçilen dönemde tamamlanan nakliye yok." /> : filtered.map(load => <ListingCard key={load.id} load={load} onPress={() => onOpen(load)} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} />)}
  </>;
}

function FavoriteDriversPage({ items, loading, error, onRetry, onBack, onRemove }) {
  return <>
    <AccountBackHeader title="Favori Şoförler" subtitle="Tamamlanan işlerde birlikte çalıştığınız şoförler" onBack={onBack} />
    {loading && !items.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Favoriler yüklenemedi" message={error} onRetry={onRetry} /> : !items.length ? <ScreenState title="Favori şoförünüz yok" message="Tamamlanan nakliye detayından çalıştığınız şoförü favorilere ekleyebilirsiniz." /> : items.map(item => {
      const driver = item.driver || {};
      const vehicle = item.vehicle;
      return <SectionCard key={driver.id} title={driver.name || 'Şoför'} description={vehicle ? `${vehicle.brand || ''} ${vehicle.model || ''} · ${vehicle.licensePlate || ''}`.trim() : 'Aktif araç bilgisi bulunmuyor'} icon="person-outline">
        <DetailRow icon="star-outline" label="Puan" value={Number(driver.driverProfile?.rating || 0).toFixed(1)} />
        <DetailRow icon="checkmark-done-outline" label="Tamamlanan iş" value={String(driver.driverProfile?.completedJobs || 0)} />
        <AppButton label="Favoriden Çıkar" icon="heart-dislike-outline" variant="outlineDanger" onPress={() => onRemove(driver.id)} style={styles.cardAction} />
      </SectionCard>;
    })}
  </>;
}

export default function CorporateAccountScreens({ page, onPageChange, account, form, setForm, changePassword, passwordLoading, logout, onOpenLoad, onPermissionGranted }) {
	const { showToast } = useToast();
  const [dashboard, setDashboard] = useState(null);
  const [company, setCompany] = useState(null);
  const [companyForm, setCompanyForm] = useState(companyFormFor());
  const [wallet, setWallet] = useState(null);
  const [accountLoads, setAccountLoads] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [supportForm, setSupportForm] = useState(initialSupportForm);
  const [state, setState] = useState({ loading: true, error: '' });
  const [saving, setSaving] = useState(false);

  useAccountBack(page, onPageChange, backPage);

  const fetchDashboard = useCallback(async () => {
    setState({ loading: true, error: '' });
    try {
      const { data } = await corporate.dashboard();
      setDashboard(data); setCompany(data.company); setWallet({ wallet: data.wallet, transactions: data.recentWalletTransactions || [] });
      setState({ loading: false, error: '' });
    } catch (error) { setState({ loading: false, error: apiError(error) }); }
  }, []);
  const fetchLoads = useCallback(async () => {
    setState({ loading: true, error: '' });
    try { const { data } = await loads.mine({ limit: 100 }); setAccountLoads(data.items || []); setState({ loading: false, error: '' }); }
    catch (error) { setState({ loading: false, error: apiError(error) }); }
  }, []);
  const fetchCompany = useCallback(async () => {
    setState({ loading: true, error: '' });
    try { const { data } = await corporate.company(); setCompany(data.company); setCompanyForm(companyFormFor(data.company)); setState({ loading: false, error: '' }); }
    catch (error) { setState({ loading: false, error: apiError(error) }); }
  }, []);
  const fetchWallet = useCallback(async () => {
    setState({ loading: true, error: '' });
    try { const { data } = await corporate.wallet(); setWallet(data); setState({ loading: false, error: '' }); }
    catch (error) { setState({ loading: false, error: apiError(error) }); }
  }, []);
  const fetchFavorites = useCallback(async () => {
    setState({ loading: true, error: '' });
    try { const { data } = await corporate.favorites(); setFavorites(data.items || []); setState({ loading: false, error: '' }); }
    catch (error) { setState({ loading: false, error: apiError(error) }); }
  }, []);
  const fetchTickets = useCallback(async () => {
    setState({ loading: true, error: '' });
    try { const { data } = await support.list(); setTickets(data.items || []); setState({ loading: false, error: '' }); }
    catch (error) { setState({ loading: false, error: apiError(error) }); }
  }, []);

  useEffect(() => {
    if (page === 'home') void fetchDashboard();
    if (['active-jobs', 'history-jobs', 'monthly-jobs', 'support-new'].includes(page)) void fetchLoads();
    if (page === 'company') void fetchCompany();
    if (page === 'wallet') void fetchWallet();
    if (page === 'favorites') void fetchFavorites();
    if (page === 'support') void fetchTickets();
  }, [fetchCompany, fetchDashboard, fetchFavorites, fetchLoads, fetchTickets, fetchWallet, page]);
  useEffect(() => { if (page !== 'password') setForm(current => current.currentPassword || current.newPassword || current.newPasswordConfirm ? { ...current, currentPassword: '', newPassword: '', newPasswordConfirm: '' } : current); }, [page, setForm]);

  const saveCompany = async () => {
    setSaving(true);
	try { const { data } = await corporate.updateCompany(companyForm); setCompany(data.company); onPageChange('company'); showToast('Firma bilgileriniz kaydedildi.', { type: 'success' }); }
	catch (error) { showToast(apiError(error), { type: 'error', title: 'Firma bilgileri kaydedilemedi' }); }
    finally { setSaving(false); }
  };
  const submitSupport = async () => {
	if (!supportForm.subject.trim() || !supportForm.description.trim() || (supportForm.type === 'complaint' && !supportForm.reason)) { showToast('Konu, açıklama ve şikâyet sebebini kontrol edin.', { type: 'error', title: 'Eksik bilgi' }); return; }
    setSaving(true);
	try { await support.create({ ...supportForm, subject: supportForm.subject.trim(), description: supportForm.description.trim() }); setSupportForm(initialSupportForm()); await fetchTickets(); onPageChange('support'); showToast('Bildiriminiz destek ekibine iletildi.', { type: 'success' }); }
	catch (error) { showToast(apiError(error), { type: 'error', title: 'Bildirim gönderilemedi' }); }
    finally { setSaving(false); }
  };
  const openTicket = async item => {
    setSelectedTicket(item); onPageChange('support-detail');
    try { const { data } = await support.get((item.complaint || item).id); setSelectedTicket(data); } catch { /* The list projection remains available. */ }
  };
	const removeFavorite = async driverId => { try { await corporate.removeFavorite(driverId); await fetchFavorites(); showToast('Şoför favorilerden çıkarıldı.', { type: 'success' }); } catch (error) { showToast(apiError(error), { type: 'error', title: 'Favori güncellenemedi' }); } };

  if (state.error && !['company-edit', 'support-new', 'password'].includes(page)) return <ScreenState type="error" title="Kurumsal hesap yüklenemedi" message={state.error} onRetry={page === 'home' ? fetchDashboard : page === 'company' ? fetchCompany : page === 'wallet' ? fetchWallet : page === 'favorites' ? fetchFavorites : fetchLoads} />;
  if (state.loading && page !== 'password' && !dashboard && !company && !accountLoads.length) return <ListSkeleton count={3} />;

  if (page === 'company') return <CompanyPage company={company} onBack={() => onPageChange('home')} onEdit={() => { setCompanyForm(companyFormFor(company)); onPageChange('company-edit'); }} />;
  if (page === 'company-edit') return <CompanyEditPage form={companyForm} setForm={setCompanyForm} loading={saving} onSave={saveCompany} onBack={() => onPageChange('company')} />;
  if (page === 'password') return <PasswordPage form={form} setForm={setForm} loading={passwordLoading} onSubmit={changePassword} onBack={() => onPageChange('home')} />;
  if (page === 'active-jobs') return <AccountJobsPage title="Aktif Nakliyeler" subtitle="Devam eden kurumsal nakliyeler" items={accountLoads.filter(load => !['draft', 'completed', 'cancelled'].includes(load.status))} loading={state.loading} error={state.error} onRetry={fetchLoads} onBack={() => onPageChange('home')} onOpen={onOpenLoad} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} emptyMessage="Aktif nakliye bulunmuyor." />;
  if (page === 'history-jobs') return <AccountJobsPage title="Geçmiş Nakliyeler" subtitle="Tamamlanan ve iptal edilen kurumsal işler" items={accountLoads.filter(load => ['completed', 'cancelled'].includes(load.status))} loading={state.loading} error={state.error} onRetry={fetchLoads} onBack={() => onPageChange('home')} onOpen={onOpenLoad} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} emptyMessage="Geçmiş nakliye bulunmuyor." />;
  if (page === 'monthly-jobs') return <MonthlyCompletedPage items={accountLoads} loading={state.loading} error={state.error} onRetry={fetchLoads} onBack={() => onPageChange('home')} onOpen={onOpenLoad} />;
  if (page === 'favorites') return <FavoriteDriversPage items={favorites} loading={state.loading} error={state.error} onRetry={fetchFavorites} onBack={() => onPageChange('home')} onRemove={removeFavorite} />;
  if (page === 'wallet') return <><AccountBackHeader title="Cüzdanım" subtitle="Yalnız sonraki uygun nakliyelerde kullanılabilen kredi" onBack={() => onPageChange('home')} /><View style={styles.walletHero}><Text style={styles.walletEyebrow}>KULLANILABİLİR BAKİYE</Text><Text style={styles.walletBalance}>{centsMoney(wallet?.wallet?.balanceCents)}</Text><Text style={styles.walletHint}>Bankaya çekilemez, transfer edilemez ve nakit olarak talep edilemez.</Text></View>{wallet?.summary ? <SectionCard title="Sadakat bilgilerim" icon="star-outline"><DetailRow icon="wallet-outline" label="Seviye" value={wallet.summary.tier} /><DetailRow icon="wallet-outline" label="Kazanım oranı" value={`%${wallet.summary.rewardRateBps / 100}`} /><DetailRow icon="wallet-outline" label="Toplam kazanılan" value={centsMoney(wallet.summary.totalEarnedCents)} /><DetailRow icon="wallet-outline" label="Toplam kullanılan (iadeler düşülmüş)" value={centsMoney(wallet.summary.totalUsedCents)} /><DetailRow icon="wallet-outline" label="Nakliye başına kullanım sınırı" value={`%${wallet.summary.maxUsageBps / 100}`} /><Text style={typography.small}>{wallet.summary.enabled ? "Kazanım, tamamlanan nakliyede cüzdan indirimi sonrası ödenecek tutar üzerinden hesaplanır." : "Cüzdan kazanımı ve kullanımı şu anda kapalıdır. Mevcut bakiyeniz korunur."}</Text></SectionCard> : null}<SectionCard title="Cüzdan hareketleri" icon="receipt-outline"><WalletTransactions items={wallet?.transactions} /></SectionCard></>;
  if (page === 'support') return <SupportListPage items={tickets} loading={state.loading} error={state.error} onRetry={fetchTickets} onBack={() => onPageChange('home')} onNew={() => { setSupportForm(initialSupportForm()); onPageChange('support-new'); }} onOpen={openTicket} />;
  if (page === 'support-new') return <SupportNewPage form={supportForm} setForm={setSupportForm} loads={accountLoads.filter(load => load.assignedDriverId)} loading={saving} onSubmit={submitSupport} onBack={() => onPageChange('support')} />;
  if (page === 'support-detail') return <SupportDetailPage item={selectedTicket} onBack={() => onPageChange('support')} />;
  if (page === 'notifications') return <DeviceNotificationsPage onBack={() => onPageChange('home')} onPermissionGranted={onPermissionGranted} />;
  if (page === 'privacy') return <LegalPage type="privacy" onBack={() => onPageChange('home')} />;
  if (page === 'terms') return <LegalPage type="terms" onBack={() => onPageChange('home')} />;

  const counts = dashboard?.counts || {};
  const profileAccount = { ...account, name: dashboard?.company?.name || company?.name || account?.name, phone: dashboard?.company?.phone || account?.phone, email: dashboard?.company?.email || account?.email };
  return <>
    <AccountProfileCard account={profileAccount} roleLabel="Kurumsal müşteri" meta={`Ana yetkili: ${dashboard?.company?.authorizedPerson || account?.name || 'Tamamlanmadı'}`} />
    <View style={styles.dashboardGrid}>
      <DashboardCard icon="navigate-outline" label="Aktif Nakliyeler" value={counts.activeLoads || 0} onPress={() => onPageChange('active-jobs')} />
      <DashboardCard icon="checkmark-done-outline" label="Bu Ay Tamamlanan" value={counts.completedThisMonth || 0} onPress={() => onPageChange('monthly-jobs')} />
      <DashboardCard icon="time-outline" label="Bekleyen İlanlar" value={counts.pendingListings || 0} onPress={() => onPageChange('active-jobs')} />
      <DashboardCard icon="wallet-outline" label="Cüzdan Bakiyesi" value={centsMoney(dashboard?.wallet?.balanceCents)} hint="Sonraki nakliyelerde kullanın" onPress={() => onPageChange('wallet')} />
    </View>
    {dashboard?.recentActiveLoads?.length ? <SectionCard title="Son aktif işler" icon="navigate-outline">{dashboard.recentActiveLoads.map(load => <ListingCard key={load.id} load={load} onPress={() => onOpenLoad(load)} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} />)}</SectionCard> : null}
    {dashboard?.recentCompletedLoads?.length ? <SectionCard title="Son tamamlanan işler" icon="checkmark-done-outline">{dashboard.recentCompletedLoads.map(load => <ListingCard key={load.id} load={load} onPress={() => onOpenLoad(load)} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} />)}</SectionCard> : null}
    {dashboard?.recentWalletTransactions?.length ? <SectionCard title="Son cüzdan hareketleri" icon="wallet-outline"><WalletTransactions compact items={dashboard.recentWalletTransactions} /></SectionCard> : null}
    <AccountMenuSection title="Firma"><AccountMenuItem icon="business-outline" label="Firma Bilgileri" description="Vergi ve iletişim bilgileri" last onPress={() => onPageChange('company')} /></AccountMenuSection>
    <AccountMenuSection title="Nakliye">
      <AccountMenuItem icon="navigate-outline" label="Aktif Nakliyeler" onPress={() => onPageChange('active-jobs')} />
      <AccountMenuItem icon="time-outline" label="Geçmiş Nakliyeler" onPress={() => onPageChange('history-jobs')} />
      <AccountMenuItem icon="calendar-outline" label="Aylık Tamamlananlar" onPress={() => onPageChange('monthly-jobs')} />
      <AccountMenuItem icon="heart-outline" label="Favori Şoförler" onPress={() => onPageChange('favorites')} />
      <AccountMenuItem icon="wallet-outline" label="Cüzdanım" description={centsMoney(dashboard?.wallet?.balanceCents)} last onPress={() => onPageChange('wallet')} />
    </AccountMenuSection>
    <AccountMenuSection title="Destek"><AccountMenuItem icon="chatbox-ellipses-outline" label="Şikâyet ve Öneri" last onPress={() => onPageChange('support')} /></AccountMenuSection>
    <AccountMenuSection title="Uygulama">
      <AccountMenuItem icon="lock-closed-outline" label="Şifre Değiştir" onPress={() => onPageChange('password')} />
      <AccountMenuItem icon="notifications-outline" label="Bildirim Ayarları" onPress={() => onPageChange('notifications')} />
      <AccountMenuItem icon="shield-checkmark-outline" label="Gizlilik Politikası" onPress={() => onPageChange('privacy')} />
      <AccountMenuItem icon="document-text-outline" label="Kullanım Koşulları" last onPress={() => onPageChange('terms')} />
    </AccountMenuSection>
    <AccountMenuSection title="Oturum"><AccountMenuItem icon="log-out-outline" label="Çıkış Yap" danger last onPress={logout} /></AccountMenuSection>
  </>;
}

const styles = StyleSheet.create({
  dashboardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }, dashboardCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexBasis: '47%', flexGrow: 1, minHeight: 142, padding: spacing.md }, dashboardIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', width: 38 }, dashboardValue: { ...typography.h2, color: colors.primaryDark, marginTop: spacing.sm }, dashboardLabel: { ...typography.smallMedium, color: colors.ink, marginTop: 2 }, dashboardHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs },
  walletHero: { backgroundColor: colors.ink, borderRadius: radius.xl, marginBottom: spacing.md, padding: spacing.xl }, walletEyebrow: { ...typography.caption, color: '#9FCBC1', letterSpacing: .8 }, walletBalance: { ...typography.display, color: colors.white, marginTop: spacing.xs }, walletHint: { ...typography.small, color: '#C5D0DB', lineHeight: 20, marginTop: spacing.sm },
  transactionRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: spacing.sm }, transactionIcon: { alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginRight: spacing.sm, width: 38 }, transactionIconUsage: { backgroundColor: colors.warningSoft }, transactionCopy: { flex: 1, paddingRight: spacing.sm }, transactionTitle: { ...typography.smallMedium, color: colors.ink }, transactionMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, transactionAmount: { ...typography.smallMedium, color: colors.success }, transactionAmountUsage: { color: colors.warning },
  dateRow: { flexDirection: 'row', gap: spacing.sm }, cardAction: { marginTop: spacing.md }, pressed: { opacity: .72 },
});
