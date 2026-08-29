import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { VEHICLE_TYPE_OPTIONS, cargoTypeLabel, formatListingTime, vehicleTypeLabel } from '../../../shared/loadMetadata';
import { driverStatusAction, isOfferableLoadStatus } from '../../../shared/loadStatus';
import Icon from '../../../shared/ui/Icon';
import SearchableSelect from '../../../shared/ui/SearchableSelect';
import { DetailRow, ListingCard, RouteTimeline, StatusBadge, SummaryCard } from '../../../shared/ui/listing';
import { PageHeading } from '../../../shared/ui/navigation';
import { AppButton, Divider, ListSkeleton, ScreenState, SectionCard, TextField } from '../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';
import DriverRouteMap from '../components/DriverRouteMap';
import LoadPhotoGallery from '../components/LoadPhotoGallery';
import { formatMoney, loadStatusLabel, resolveMediaUrl, toFiniteNumber } from '../utils/presentation';
import { vehicles } from '../services/api';

function OperationalDetails({ load }) {
  const dimensions = load.dimensions || {};
  return <>
    <DetailRow icon="time-outline" label="Nakliye zamanı" value={formatListingTime(load)} />
    <DetailRow icon="cube-outline" label="Yük türü" value={`${cargoTypeLabel(load.cargoType)}${load.cargoTypeNote ? ` · ${load.cargoTypeNote}` : ''}`} />
    <DetailRow icon="car-outline" label="Araç ihtiyacı" value={vehicleTypeLabel(load.vehicleType)} />
    <DetailRow icon="scale-outline" label="Ağırlık ve ölçüler" value={`${toFiniteNumber(dimensions.weightKg)} kg · ${toFiniteNumber(dimensions.lengthCm)} × ${toFiniteNumber(dimensions.widthCm)} × ${toFiniteNumber(dimensions.heightCm)} cm`} />
    <DetailRow icon="arrow-up-circle-outline" label="Çıkış erişimi" value={`${load.pickupFloor ?? '—'}. kat · Asansör ${load.pickupElevatorAvailable ? 'var' : 'yok'}`} />
    <DetailRow icon="arrow-down-circle-outline" label="Varış erişimi" value={`${load.deliveryFloor ?? '—'}. kat · Asansör ${load.deliveryElevatorAvailable ? 'var' : 'yok'}`} />
    <DetailRow icon="people-outline" label="Yardımcı personel" value={load.helperNeeded ? `${load.helperCount} kişi gerekli` : 'Gerekmiyor'} />
    <DetailRow icon="document-text-outline" label="Açıklama" value={load.description || 'Belirtilmedi'} />
  </>;
}

function DriverHero({ jobs, onShowOffers }) {
  const averagePrice = jobs.length ? jobs.reduce((total, load) => total + toFiniteNumber(load.basePriceTl || load.agreedPriceTl), 0) / jobs.length : 0;
  return <>
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="navigate" size={24} color={colors.white} /></View><Text style={styles.heroEyebrow}>ŞOFÖR OPERASYON PANELİ</Text><Text style={styles.heroTitle}>Uygun rotayı seç, teklifini güvenle yönet.</Text><Text style={styles.heroText}>Yük ve operasyon koşullarını inceleyerek hazırlıklı yola çık.</Text></View>
    <View style={styles.summaryRow}><SummaryCard icon="briefcase-outline" value={jobs.length} label="Uygun iş" /><SummaryCard icon="cash-outline" value={formatMoney(averagePrice)} label="Ortalama fiyat" tone="accent" onPress={onShowOffers} /></View>
  </>;
}

export function DriverJobs({ loading, error, jobs, selected, form, setForm, formErrors, setFormErrors, saving, onOpen, onClose, onAdjust, onSaveOffer, onStatus, retry, onShowOffers }) {
  const setOfferField = (field, value) => {
    setForm(current => ({ ...current, [field]: value }));
    setFormErrors(current => ({ ...current, [field]: '' }));
  };
  const statusAction = selected ? driverStatusAction(selected.status) : null;
  if (selected) return <View style={styles.detail}>
    <AppButton label="İşlere dön" icon="arrow-back" variant="ghost" compact fullWidth={false} onPress={onClose} style={styles.backButton} />
    <View style={styles.detailTitleRow}><View style={styles.detailTitleCopy}><Text style={styles.detailTitle}>{selected.title || 'Başlıksız ilan'}</Text><Text style={styles.detailCode}>İlan #{String(selected.id || '').slice(-8).toUpperCase()}</Text></View><StatusBadge status={selected.status} label={loadStatusLabel(selected.status)} /></View>
    <LoadPhotoGallery photos={selected.photoUrls} />
    <SectionCard title="Rota" icon="navigate-outline" style={styles.firstSection}><RouteTimeline pickup={selected.pickup?.address} delivery={selected.delivery?.address} /></SectionCard>
    <SectionCard title="Operasyon özeti" description="Yola çıkmadan önce tüm koşulları kontrol edin." icon="clipboard-outline"><OperationalDetails load={selected} /></SectionCard>
    <DriverRouteMap load={selected} />
    <View style={styles.pricePanel}><View><Text style={styles.priceLabel}>MÜŞTERİ TAHMİNİ FİYATI</Text><Text style={styles.priceValue}>{formatMoney(selected.basePriceTl || selected.agreedPriceTl)}</Text></View><View style={styles.priceMeta}><Icon name="navigate-outline" size={17} color={colors.primary} /><Text style={styles.priceMetaText}>{toFiniteNumber(selected.estimatedKm).toFixed(1)} km · {Math.round(toFiniteNumber(selected.routeDurationSeconds) / 60)} dk</Text></View></View>
    {statusAction ? <SectionCard title="Aktif taşıma" description="Yalnızca gerçekleşen bir sonraki operasyon adımını kaydedin." icon="shield-checkmark-outline">
      <AppButton label={statusAction.label} icon={statusAction.icon} onPress={() => onStatus(selected, statusAction.nextStatus)} />
    </SectionCard> : isOfferableLoadStatus(selected.status) ? <SectionCard title="Teklifiniz" description="Fiyatı, tahmini varış süresini ve notunuzu girin." icon="pricetag-outline">
      <View style={styles.adjustRow}><AppButton label="−100 TL" variant="secondary" compact fullWidth={false} onPress={() => onAdjust(-100)} /><TextField containerStyle={styles.amountField} value={form.amount} onChangeText={value => setOfferField('amount', value)} keyboardType="decimal-pad" inputStyle={styles.amountInput} error={formErrors?.amount} /><AppButton label="+100 TL" variant="secondary" compact fullWidth={false} onPress={() => onAdjust(100)} /></View>
      <TextField label="Tahmini varış süresi" required value={form.eta} onChangeText={value => setOfferField('eta', value)} keyboardType="number-pad" placeholder="dakika" leftIcon="time-outline" error={formErrors?.eta} />
      <TextField label="Müşteriye not" value={form.note} onChangeText={value => setOfferField('note', value)} placeholder="Örn. Bugün taşıyabilirim." multiline maxLength={600} />
      <AppButton label={saving ? 'Teklif kaydediliyor' : 'Teklifi gönder'} icon="send-outline" loading={saving} onPress={onSaveOffer} style={styles.cardAction} />
    </SectionCard> : <SectionCard title="Operasyon durumu" description={loadStatusLabel(selected.status)} icon="information-circle-outline" />}
  </View>;

  return <>
    <DriverHero jobs={jobs} onShowOffers={onShowOffers} />
    <PageHeading eyebrow="Uygun ilanlar" title="Yakındaki işler" subtitle="Rota, zaman, yük ve araç ihtiyacını karşılaştırın." />
    {loading && !jobs.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="İşler yüklenemedi" message={error} onRetry={retry} /> : !jobs.length ? <ScreenState title="Şu an uygun ilan yok" message="Yeni yayınlanan uygun yükler burada görüntülenecek." /> : jobs.map(load => <ListingCard key={load.id} load={load} onPress={() => onOpen(load)} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} />)}
  </>;
}

const offerStatus = status => ({
  pending: { label: 'Bekliyor', tone: 'warning', icon: 'time-outline' },
  accepted: { label: 'Kabul edildi', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Reddedildi', tone: 'danger', icon: 'close-circle-outline' },
  withdrawn: { label: 'Geri çekildi', tone: 'neutral', icon: 'remove-circle-outline' },
}[status] || { label: status || 'Bilinmiyor', tone: 'neutral', icon: 'information-circle-outline' });

export function DriverOffers({ loading, error, items, onOpen, onWithdraw, retry }) {
  const validItems = items.filter(item => item?.offer && item?.load);
  return <>
    <PageHeading eyebrow="Teklif yönetimi" title="Tekliflerim" subtitle="Gönderdiğiniz tekliflerin durumunu takip edin ve bekleyenleri düzenleyin." />
    {loading && !validItems.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Teklifler yüklenemedi" message={error} onRetry={retry} /> : !validItems.length ? <ScreenState title="Henüz teklifiniz yok" message="Uygun bir işe teklif verdiğinizde burada görüntülenecek." /> : validItems.map(item => {
      const { offer, load } = item;
      const status = offerStatus(offer.status);
      return <View key={offer.id} style={styles.offerCard}>
        <View style={styles.offerHeader}><View style={styles.offerStatusIcon}><Icon name={status.icon} size={20} color={status.tone === 'danger' ? colors.danger : status.tone === 'success' ? colors.success : colors.primary} /></View><View style={styles.offerTitleCopy}><Text style={styles.offerTitle}>{load.title || 'Başlıksız ilan'}</Text><Text style={styles.offerTime}>{formatListingTime(load)}</Text></View><StatusBadge status={offer.status === 'accepted' ? 'completed' : offer.status === 'rejected' ? 'cancelled' : 'offers_received'} label={status.label} /></View>
        <RouteTimeline compact pickup={load.pickup?.address} delivery={load.delivery?.address} />
        <Divider style={styles.offerDivider} />
        <View style={styles.offerPrices}><View><Text style={styles.priceLabel}>TEKLİFİNİZ</Text><Text style={styles.offerPrice}>{formatMoney(offer.amountTl)}</Text></View><View style={styles.offerBase}><Text style={styles.priceLabel}>MÜŞTERİ FİYATI</Text><Text style={styles.offerBaseValue}>{formatMoney(load.basePriceTl || load.agreedPriceTl)}</Text></View></View>
        {offer.note ? <Text style={styles.offerNote}>{offer.note}</Text> : null}
        {offer.status === 'pending' ? <View style={styles.offerActions}><AppButton label="Düzenle" icon="create-outline" variant="secondary" compact fullWidth={false} style={styles.offerAction} onPress={() => onOpen(load, offer)} /><AppButton label="Geri çek" icon="trash-outline" variant="outlineDanger" compact fullWidth={false} style={styles.offerAction} onPress={() => onWithdraw(offer)} /></View> : null}
      </View>;
    })}
  </>;
}

export function DriverAccount({ loading, error, account, form, setForm, save, saveLoading, changePassword, passwordLoading, logout, retry }) {
  if (loading && !account) return <ListSkeleton count={3} />;
  if (error || !account) return <ScreenState type="error" title="Hesap yüklenemedi" message={error || 'Profil bulunamadı.'} onRetry={retry} />;
  return <>
    <PageHeading eyebrow="Şoför hesabı" title="Profil, araç ve güvenlik" subtitle="Müşterilere doğru bilgilerin gösterilmesi için profilinizi güncel tutun." />
    <View style={styles.profileHero}><View style={styles.profileAvatar}><Text style={styles.profileInitials}>{account.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName}>{account.name}</Text><Text style={styles.profileMeta}>Şoför hesabı · {new Date(account.createdAt).toLocaleDateString('tr-TR')}</Text></View></View>
    <SectionCard title="Profil bilgileri" icon="person-outline">
      <TextField label="Ad soyad" required value={form.name} onChangeText={value => setForm(current => ({ ...current, name: value }))} leftIcon="person-outline" autoCapitalize="words" />
      <TextField label="E-posta" required value={form.email} onChangeText={value => setForm(current => ({ ...current, email: value }))} leftIcon="mail-outline" keyboardType="email-address" autoCapitalize="none" />
      <TextField label="Telefon" required value={form.phone} onChangeText={value => setForm(current => ({ ...current, phone: value }))} leftIcon="call-outline" keyboardType="phone-pad" />
    </SectionCard>
    <SectionCard title="Araç ve hizmet" description="İlan eşleştirmesinde kullanılan bilgiler." icon="car-sport-outline">
      <SearchableSelect label="Araç tipi" required value={form.vehicleType} options={VEHICLE_TYPE_OPTIONS.filter(option => option.value !== 'farketmez')} onChange={value => setForm(current => ({ ...current, vehicleType: value }))} searchPlaceholder="Araç türünde ara" />
      <TextField label="Marka / model" required value={form.vehicleModel} onChangeText={value => setForm(current => ({ ...current, vehicleModel: value }))} leftIcon="car-outline" autoCapitalize="words" />
      <TextField label="Plaka" required value={form.licensePlate} onChangeText={value => setForm(current => ({ ...current, licensePlate: value.toLocaleUpperCase('tr-TR') }))} leftIcon="card-outline" autoCapitalize="characters" />
      <TextField label="Taşıma kapasitesi" required value={form.capacityKg} onChangeText={value => setForm(current => ({ ...current, capacityKg: value }))} keyboardType="decimal-pad" placeholder="kg" leftIcon="scale-outline" />
      <TextField label="Hizmet bölgesi" required value={form.serviceArea} onChangeText={value => setForm(current => ({ ...current, serviceArea: value }))} placeholder="Örn. İstanbul ve çevresi" leftIcon="map-outline" />
      <View style={styles.notificationRow}><View style={styles.notificationCopy}><Text style={styles.notificationTitle}>Yakındaki yeni ilan bildirimleri</Text><Text style={styles.notificationText}>Size uygun yeni ilan yayınlandığında bildirim alın.</Text></View><Switch value={form.nearbyLoadNotifications} onValueChange={value => setForm(current => ({ ...current, nearbyLoadNotifications: value }))} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={form.nearbyLoadNotifications ? colors.primary : colors.textMuted} /></View>
      <AppButton label="Bilgileri kaydet" icon="save-outline" loading={saveLoading} onPress={save} style={styles.cardAction} />
    </SectionCard>
    <SectionCard title="Şifre değiştir" description="En az 8 karakterli güçlü bir şifre kullanın." icon="lock-closed-outline">
      <TextField label="Mevcut şifre" required value={form.currentPassword} onChangeText={value => setForm(current => ({ ...current, currentPassword: value }))} leftIcon="key-outline" secureTextEntry autoCapitalize="none" />
      <TextField label="Yeni şifre" required value={form.newPassword} onChangeText={value => setForm(current => ({ ...current, newPassword: value }))} leftIcon="shield-checkmark-outline" secureTextEntry autoCapitalize="none" helper="En az 8 karakter" />
      <AppButton label="Şifreyi değiştir" variant="secondary" icon="refresh-outline" loading={passwordLoading} onPress={changePassword} style={styles.cardAction} />
    </SectionCard>
    <AppButton label="Hesaptan çıkış yap" icon="log-out-outline" variant="outlineDanger" onPress={logout} style={styles.dangerAction} />
  </>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.ink, borderRadius: radius.xl, marginBottom: spacing.md, padding: spacing.xl }, heroIcon: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.md, height: 46, justifyContent: 'center', marginBottom: spacing.md, width: 46 }, heroEyebrow: { ...typography.caption, color: '#9FCBC1', letterSpacing: 1 }, heroTitle: { ...typography.display, color: colors.white, marginTop: spacing.xs }, heroText: { ...typography.body, color: '#C6D0DB', marginTop: spacing.sm }, summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  detail: { paddingBottom: spacing.md }, backButton: { marginBottom: spacing.sm, marginLeft: -spacing.sm }, detailTitleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }, detailTitleCopy: { flex: 1 }, detailTitle: { ...typography.h1, color: colors.ink }, detailCode: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs }, firstSection: { marginTop: spacing.md }, pricePanel: { backgroundColor: colors.primarySoft, borderColor: '#C9E1DB', borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, marginTop: spacing.md, padding: spacing.lg }, priceLabel: { ...typography.caption, color: colors.textMuted, letterSpacing: .7 }, priceValue: { ...typography.display, color: colors.primaryDark, marginTop: spacing.xxs }, priceMeta: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }, priceMetaText: { ...typography.smallMedium, color: colors.text },
  adjustRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }, amountField: { flex: 1, marginTop: 0 }, amountInput: { ...typography.h3, textAlign: 'center' }, cardAction: { marginTop: spacing.md },
  offerCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.lg }, offerHeader: { alignItems: 'center', flexDirection: 'row' }, offerStatusIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 40, justifyContent: 'center', marginRight: spacing.sm, width: 40 }, offerTitleCopy: { flex: 1, paddingRight: spacing.xs }, offerTitle: { ...typography.h3, color: colors.ink }, offerTime: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, offerDivider: { marginVertical: spacing.md }, offerPrices: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' }, offerPrice: { ...typography.h2, color: colors.primaryDark, marginTop: 2 }, offerBase: { alignItems: 'flex-end' }, offerBaseValue: { ...typography.bodyMedium, color: colors.text, marginTop: 2 }, offerNote: { ...typography.small, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, color: colors.text, marginTop: spacing.md, padding: spacing.sm }, offerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }, offerAction: { flex: 1 },
  profileHero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.lg, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.lg }, profileAvatar: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 28, height: 56, justifyContent: 'center', marginRight: spacing.md, width: 56 }, profileInitials: { ...typography.h2, color: colors.white }, profileCopy: { flex: 1 }, profileName: { ...typography.h2, color: colors.white }, profileMeta: { ...typography.caption, color: '#B9C5D2', marginTop: spacing.xxs }, dangerAction: { marginBottom: spacing.xl, marginTop: spacing.sm },
  notificationRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }, notificationCopy: { flex: 1 }, notificationTitle: { ...typography.bodyMedium, color: colors.text }, notificationText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs },
});
