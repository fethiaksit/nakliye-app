import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CARGO_TYPE_OPTIONS, LOAD_TIMING_OPTIONS, VEHICLE_TYPE_OPTIONS, cargoTypeLabel, formatListingTime, vehicleTypeLabel } from '../../../shared/loadMetadata';
import DatePickerField from '../../../shared/ui/DatePickerField';
import Icon from '../../../shared/ui/Icon';
import SearchableSelect from '../../../shared/ui/SearchableSelect';
import { DetailRow, ListingCard, RouteTimeline, StatusBadge, SummaryCard } from '../../../shared/ui/listing';
import { PageHeading } from '../../../shared/ui/navigation';
import { AppButton, Divider, ListSkeleton, ScreenState, SectionCard, SegmentedControl, TextField } from '../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';
import LoadPhotoPicker from '../components/LoadPhotoPicker';
import RoutePicker from '../components/RoutePicker';
import { formatMoney, loadStatusLabel, resolveMediaUrl, toFiniteNumber } from '../utils/presentation';

const dateFromKey = key => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
};
const timeFromKey = (key, dateKey) => {
  const match = /^(\d{2}):(\d{2})$/.exec(key || '');
  if (!match) return null;
  const base = dateFromKey(dateKey) || new Date();
  base.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return base;
};
const toDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const toTimeKey = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const minimumDate = () => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; };
const minimumTimeForDate = key => key === toDateKey(new Date()) ? new Date() : undefined;

const timingOptions = LOAD_TIMING_OPTIONS.map(option => ({
  ...option,
  icon: option.value === 'immediate' ? 'flash-outline' : option.value === 'today' ? 'sunny-outline' : 'calendar-outline',
}));
const yesNoOptions = [{ value: true, label: 'Var', icon: 'checkmark-circle-outline' }, { value: false, label: 'Yok', icon: 'close-circle-outline' }];
const helperOptions = [{ value: false, label: 'Gerekmiyor', icon: 'person-outline' }, { value: true, label: 'Gerekli', icon: 'people-outline' }];

function fieldProps(errors, field) {
  return { error: errors?.[field] };
}

export function CustomerHome({ form, setForm, errors, setErrors, photos, setPhotos, routeDraft, onLocationsChange, onRouteChange, saving, publish, loads: items = [], onShowLoads }) {
  const set = (field, value) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: '' }));
  };
  const activeCount = items.filter(item => !['completed', 'cancelled'].includes(item.status)).length;
  const offerCount = items.reduce((total, item) => total + Number(item.offerCount || 0), 0);
  return <>
    <View style={styles.hero}>
      <View style={styles.heroIcon}><Icon name="shield-checkmark" size={24} color={colors.white} /></View>
      <Text style={styles.heroEyebrow}>GÜVENLİ NAKLİYE PAZARYERİ</Text>
      <Text style={styles.heroTitle}>Taşıma ihtiyacını netleştir, doğru şoförle buluş.</Text>
      <Text style={styles.heroText}>Zamanı, yükü ve operasyon koşullarını gir; teklifleri tek yerden yönet.</Text>
    </View>
    <View style={styles.summaryRow}>
      <SummaryCard icon="file-tray-full-outline" value={activeCount} label="Aktif ilan" onPress={onShowLoads} />
      <SummaryCard icon="pricetags-outline" value={offerCount} label="Toplam teklif" tone="accent" onPress={onShowLoads} />
    </View>
    <PageHeading eyebrow="Yeni talep" title="Nakliye ilanı oluştur" subtitle="Şoförlerin doğru araç ve ekiple hazırlanması için alanları eksiksiz doldurun." />

    <SectionCard title="Nakliye zamanı" description="Acil taşıma veya ileri tarih seçin." icon="time-outline">
      <SegmentedControl options={timingOptions} value={form.urgencyType} onChange={value => set('urgencyType', value)} error={errors?.urgencyType} />
      {form.urgencyType === 'scheduled' ? <View style={styles.fieldRow}>
        <DatePickerField testID="scheduled-date" label="Tarih" required mode="date" value={dateFromKey(form.scheduledDate)} minimumDate={minimumDate()} onChange={value => set('scheduledDate', value ? toDateKey(value) : '')} {...fieldProps(errors, 'scheduledDate')} />
        <DatePickerField testID="scheduled-time" label="Saat" required mode="time" value={timeFromKey(form.scheduledTime, form.scheduledDate)} minimumDate={minimumTimeForDate(form.scheduledDate)} onChange={value => set('scheduledTime', value ? toTimeKey(value) : '')} {...fieldProps(errors, 'scheduledTime')} />
      </View> : null}
    </SectionCard>

    <SectionCard title="Yük bilgileri" description="Eşleştirme ve fiyatlandırmada kullanılacak bilgiler." icon="cube-outline">
      <SearchableSelect label="Nakliye türü" required value={form.cargoType} options={CARGO_TYPE_OPTIONS} onChange={value => set('cargoType', value)} placeholder="Yük türünü seçin" searchPlaceholder="Yük türünde ara" {...fieldProps(errors, 'cargoType')} />
      {form.cargoType === 'diger' ? <TextField label="Diğer yük türü" required value={form.cargoTypeNote} onChangeText={value => set('cargoTypeNote', value)} placeholder="Yükü kısaca tanımlayın" leftIcon="create-outline" {...fieldProps(errors, 'cargoTypeNote')} /> : null}
      <TextField label="Yük başlığı" required value={form.title} onChangeText={value => set('title', value)} placeholder="Örn. Üç parça ev eşyası" leftIcon="document-text-outline" returnKeyType="next" {...fieldProps(errors, 'title')} />
      <TextField label="Açıklama" required value={form.description} onChangeText={value => set('description', value)} placeholder="Paketleme, hassasiyet ve erişim notları…" multiline maxLength={1200} {...fieldProps(errors, 'description')} />
      <LoadPhotoPicker photos={photos} onChange={setPhotos} />
    </SectionCard>

    <SectionCard title="Başlangıç ve varış" description="Adresleri arayın, doğru sonucu seçin ve rotayı doğrulayın." icon="map-outline">
      <RoutePicker value={routeDraft} onLocationsChange={onLocationsChange} onRouteChange={onRouteChange} />
      {errors?.route ? <View style={styles.inlineError}><Icon name="alert-circle" size={16} color={colors.danger} /><Text style={styles.inlineErrorText}>{errors.route}</Text></View> : null}
    </SectionCard>

    <SectionCard title="Araç ihtiyacı" description="Yük için en uygun araç tipini seçin." icon="car-outline">
      <SearchableSelect label="Araç türü" required value={form.vehicleType} options={VEHICLE_TYPE_OPTIONS} onChange={value => set('vehicleType', value)} searchPlaceholder="Araç türünde ara" clearable={false} {...fieldProps(errors, 'vehicleType')} />
    </SectionCard>

    <SectionCard title="Ölçü ve ağırlık" description="Yaklaşık toplam değerleri santimetre ve kilogram olarak girin." icon="scale-outline">
      <TextField label="Tahmini ağırlık" required value={form.weight} onChangeText={value => set('weight', value)} placeholder="kg" keyboardType="decimal-pad" leftIcon="barbell-outline" {...fieldProps(errors, 'weight')} />
      <View style={styles.fieldRow}>
        <TextField containerStyle={styles.flexField} label="Uzunluk" required value={form.length} onChangeText={value => set('length', value)} placeholder="cm" keyboardType="decimal-pad" {...fieldProps(errors, 'length')} />
        <TextField containerStyle={styles.flexField} label="Genişlik" required value={form.width} onChangeText={value => set('width', value)} placeholder="cm" keyboardType="decimal-pad" {...fieldProps(errors, 'width')} />
      </View>
      <TextField label="Yükseklik" required value={form.height} onChangeText={value => set('height', value)} placeholder="cm" keyboardType="decimal-pad" {...fieldProps(errors, 'height')} />
    </SectionCard>

    <SectionCard title="Operasyon bilgileri" description="Kat, asansör ve yardımcı personel ihtiyacını belirtin." icon="business-outline">
      <View style={styles.fieldRow}>
        <TextField containerStyle={styles.flexField} label="Çıkış katı" required value={form.pickupFloor} onChangeText={value => set('pickupFloor', value)} keyboardType="numbers-and-punctuation" {...fieldProps(errors, 'pickupFloor')} />
        <TextField containerStyle={styles.flexField} label="Varış katı" required value={form.deliveryFloor} onChangeText={value => set('deliveryFloor', value)} keyboardType="numbers-and-punctuation" {...fieldProps(errors, 'deliveryFloor')} />
      </View>
      <SegmentedControl label="Çıkışta asansör" options={yesNoOptions} value={form.pickupElevatorAvailable} onChange={value => set('pickupElevatorAvailable', value)} />
      <SegmentedControl label="Varışta asansör" options={yesNoOptions} value={form.deliveryElevatorAvailable} onChange={value => set('deliveryElevatorAvailable', value)} />
      <SegmentedControl label="Yardımcı personel" options={helperOptions} value={form.helperNeeded} onChange={value => set('helperNeeded', value)} />
      {form.helperNeeded ? <TextField label="Personel sayısı" required value={form.helperCount} onChangeText={value => set('helperCount', value)} keyboardType="number-pad" leftIcon="people-outline" {...fieldProps(errors, 'helperCount')} /> : null}
    </SectionCard>
    <AppButton label="İlanı yayınla" icon="send" loading={saving} onPress={publish} style={styles.publishButton} />
    <Text style={styles.publishHint}>Yayınlamadan önce rota ve operasyon bilgilerinizi kontrol edin.</Text>
  </>;
}

function PhotoStrip({ photos = [] }) {
  if (!photos.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>{photos.map((path, index) => {
    const uri = resolveMediaUrl(path);
    return uri ? <Image key={`${path}-${index}`} source={{ uri }} style={styles.detailPhoto} /> : null;
  })}</ScrollView>;
}

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

export function CustomerLoads({ loading, error, items, selected, offers, offersLoading, deliveryCode, deliveryCodeLoading, deliveryCodeError, onOpen, onClose, onAccept, onCancel, retry }) {
  if (selected) return <View style={styles.detail}>
    <AppButton label="İlanlarıma dön" icon="arrow-back" variant="ghost" compact fullWidth={false} onPress={onClose} style={styles.backButton} />
    <View style={styles.detailTitleRow}><View style={styles.detailTitleCopy}><Text style={styles.detailTitle}>{selected.title || 'Başlıksız ilan'}</Text><Text style={styles.detailCode}>İlan #{String(selected.id || '').slice(-8).toUpperCase()}</Text></View><StatusBadge status={selected.status} label={loadStatusLabel(selected.status)} /></View>
    <PhotoStrip photos={selected.photoUrls} />
    <SectionCard title="Rota" icon="navigate-outline"><RouteTimeline pickup={selected.pickup?.address} delivery={selected.delivery?.address} /><View style={styles.routeMeta}><View style={styles.routeMetaItem}><Icon name="navigate-outline" size={17} color={colors.primary} /><Text style={styles.routeMetaText}>{toFiniteNumber(selected.estimatedKm).toFixed(1)} km</Text></View><View style={styles.routeMetaItem}><Icon name="time-outline" size={17} color={colors.primary} /><Text style={styles.routeMetaText}>{Math.round(toFiniteNumber(selected.routeDurationSeconds) / 60)} dk</Text></View></View></SectionCard>
    <SectionCard title="Operasyon özeti" icon="clipboard-outline"><OperationalDetails load={selected} /></SectionCard>
    {['driver_selected', 'driver_en_route', 'at_pickup', 'picked_up', 'en_route_to_delivery', 'delivered'].includes(selected.status) && !selected.deliveryVerified ? <SectionCard title="Teslimat kodu" description="Teslimat gerçekleştiğinde bu kodu yalnızca atanmış şoförle paylaşın." icon="keypad-outline">
      {deliveryCodeLoading ? <Text style={styles.deliveryCodeMessage}>Kod yükleniyor…</Text> : deliveryCodeError ? <Text style={styles.deliveryCodeError}>{deliveryCodeError}</Text> : <Text selectable style={styles.deliveryCodeValue}>{deliveryCode || '—'}</Text>}
    </SectionCard> : null}
    {selected.deliveryVerified ? <SectionCard title="Teslimat doğrulandı" description={selected.deliveryVerifiedAt ? new Date(selected.deliveryVerifiedAt).toLocaleString('tr-TR') : 'Doğrulama zamanı kaydedildi.'} icon="checkmark-done-circle-outline">
      <DetailRow icon="shield-checkmark-outline" label="Doğrulama" value="Teslimat kodu ve fotoğraf" />
      <PhotoStrip photos={selected.deliveryPhotoUrl ? [selected.deliveryPhotoUrl] : []} />
    </SectionCard> : null}
    <View style={styles.pricePanel}><Text style={styles.priceLabel}>İLAN FİYATI</Text><Text style={styles.priceValue}>{formatMoney(selected.agreedPriceTl || selected.basePriceTl)}</Text></View>
    <PageHeading title="Gelen teklifler" subtitle="Fiyat, süre ve şoför notlarını karşılaştırın." />
    {offersLoading ? <ListSkeleton count={2} /> : !offers.length ? <ScreenState compact title="Henüz teklif yok" message="Şoför teklifleri geldiğinde burada görüntülenecek." /> : offers.map(item => {
      const offer = item.offer || item;
      const driver = item.driver || {};
      const difference = toFiniteNumber(offer.amountTl) - toFiniteNumber(selected.basePriceTl);
      return <View key={offer.id} style={styles.offerCard}>
        <View style={styles.offerHeader}><View style={styles.driverAvatar}><Icon name="person" size={20} color={colors.primary} /></View><View style={styles.offerCopy}><Text style={styles.offerName}>{driver.name || 'Şoför'}</Text><Text style={styles.offerEta}>{offer.estimatedArrivalMinutes ? `${offer.estimatedArrivalMinutes} dk içinde gelebilir` : 'Varış süresi belirtilmedi'}</Text></View><StatusBadge status={offer.status} label={offer.status === 'pending' ? 'Bekliyor' : offer.status === 'accepted' ? 'Kabul edildi' : 'Kapandı'} /></View>
        {offer.note ? <Text style={styles.offerNote}>{offer.note}</Text> : null}
        <Divider style={styles.offerDivider} />
        <View style={styles.offerPriceRow}><View><Text style={styles.priceLabel}>TEKLİF</Text><Text style={styles.offerPrice}>{formatMoney(offer.amountTl)}</Text></View><Text style={styles.offerDifference}>{difference < 0 ? `${formatMoney(Math.abs(difference))} daha uygun` : difference > 0 ? `${formatMoney(difference)} fark` : 'Tahmini fiyatla aynı'}</Text></View>
        {offer.status === 'pending' ? <AppButton label="Teklifi kabul et" icon="checkmark-circle-outline" onPress={() => onAccept(offer)} style={styles.cardAction} /> : null}
      </View>;
    })}
    {['draft', 'published', 'open', 'offers_received'].includes(selected.status) ? <AppButton label="İlanı iptal et" icon="close-circle-outline" variant="outlineDanger" onPress={() => onCancel(selected)} style={styles.dangerAction} /> : null}
  </View>;
  return <>
    <PageHeading eyebrow="Talepleriniz" title="İlanlarım" subtitle="İlan durumlarını ve şoför tekliflerini takip edin." />
    {loading && !items.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="İlanlar yüklenemedi" message={error} onRetry={retry} /> : !items.length ? <ScreenState title="Henüz ilanınız yok" message="Ana sayfadan yeni nakliye talebi oluşturabilirsiniz." /> : items.map(load => <ListingCard key={load.id} load={load} onPress={() => onOpen(load)} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} />)}
  </>;
}

export function CustomerAccount({ loading, error, account, form, setForm, save, saveLoading, changePassword, passwordLoading, logout, retry }) {
  if (loading && !account) return <ListSkeleton count={3} />;
  if (error || !account) return <ScreenState type="error" title="Hesap yüklenemedi" message={error || 'Profil bulunamadı.'} onRetry={retry} />;
  return <>
    <PageHeading eyebrow="Hesap" title="Profil ve güvenlik" subtitle="İletişim bilgilerinizi ve şifrenizi yönetin." />
    <View style={styles.profileHero}><View style={styles.profileAvatar}><Text style={styles.profileInitials}>{account.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName}>{account.name}</Text><Text style={styles.profileMeta}>Müşteri hesabı · {new Date(account.createdAt).toLocaleDateString('tr-TR')}</Text></View></View>
    <SectionCard title="Profil bilgileri" description="Teklif ve taşıma iletişiminde kullanılır." icon="person-outline">
      <TextField label="Ad soyad" required value={form.name} onChangeText={value => setForm(current => ({ ...current, name: value }))} leftIcon="person-outline" autoCapitalize="words" />
      <TextField label="E-posta" required value={form.email} onChangeText={value => setForm(current => ({ ...current, email: value }))} leftIcon="mail-outline" keyboardType="email-address" autoCapitalize="none" />
      <TextField label="Telefon" required value={form.phone} onChangeText={value => setForm(current => ({ ...current, phone: value }))} leftIcon="call-outline" keyboardType="phone-pad" />
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
  hero: { backgroundColor: colors.ink, borderRadius: radius.xl, marginBottom: spacing.md, overflow: 'hidden', padding: spacing.xl }, heroIcon: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.md, height: 46, justifyContent: 'center', marginBottom: spacing.md, width: 46 }, heroEyebrow: { ...typography.caption, color: '#9FCBC1', letterSpacing: 1 }, heroTitle: { ...typography.display, color: colors.white, marginTop: spacing.xs }, heroText: { ...typography.body, color: '#C6D0DB', marginTop: spacing.sm },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }, fieldRow: { flexDirection: 'row', gap: spacing.sm }, flexField: { flex: 1 }, publishButton: { marginTop: spacing.xs }, publishHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg, marginTop: spacing.xs, textAlign: 'center' }, inlineError: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }, inlineErrorText: { ...typography.caption, color: colors.danger, flex: 1 },
  detail: { paddingBottom: spacing.md }, backButton: { marginBottom: spacing.sm, marginLeft: -spacing.sm }, detailTitleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }, detailTitleCopy: { flex: 1 }, detailTitle: { ...typography.h1, color: colors.ink }, detailCode: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs }, photoStrip: { gap: spacing.sm, paddingBottom: spacing.md }, detailPhoto: { borderRadius: radius.md, height: 128, width: 160 }, routeMeta: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, paddingTop: spacing.sm }, routeMetaItem: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs }, routeMetaText: { ...typography.smallMedium, color: colors.text },
  deliveryCodeValue: { ...typography.display, color: colors.primaryDark, letterSpacing: 8, paddingVertical: spacing.sm, textAlign: 'center' }, deliveryCodeMessage: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm }, deliveryCodeError: { ...typography.small, color: colors.danger, paddingVertical: spacing.sm },
  pricePanel: { backgroundColor: colors.primarySoft, borderColor: '#C9E1DB', borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.xl, padding: spacing.lg }, priceLabel: { ...typography.caption, color: colors.textMuted, letterSpacing: .7 }, priceValue: { ...typography.display, color: colors.primaryDark, marginTop: spacing.xxs }, offerCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.lg }, offerHeader: { alignItems: 'center', flexDirection: 'row' }, driverAvatar: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 21, height: 42, justifyContent: 'center', marginRight: spacing.sm, width: 42 }, offerCopy: { flex: 1 }, offerName: { ...typography.h3, color: colors.ink }, offerEta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, offerNote: { ...typography.small, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, color: colors.text, marginTop: spacing.md, padding: spacing.sm }, offerDivider: { marginVertical: spacing.md }, offerPriceRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' }, offerPrice: { ...typography.h2, color: colors.primaryDark, marginTop: 2 }, offerDifference: { ...typography.caption, color: colors.textSecondary }, cardAction: { marginTop: spacing.md }, dangerAction: { marginBottom: spacing.xl, marginTop: spacing.sm },
  profileHero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.lg, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.lg }, profileAvatar: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 28, height: 56, justifyContent: 'center', marginRight: spacing.md, width: 56 }, profileInitials: { ...typography.h2, color: colors.white }, profileCopy: { flex: 1 }, profileName: { ...typography.h2, color: colors.white }, profileMeta: { ...typography.caption, color: '#B9C5D2', marginTop: spacing.xxs },
});
