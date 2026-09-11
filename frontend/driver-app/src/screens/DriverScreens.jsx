import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { cargoTypeLabel, formatListingTime, vehicleTypeLabel } from '../../../shared/loadMetadata';
import { driverStatusAction, isOfferableLoadStatus } from '../../../shared/loadStatus';
import Icon from '../../../shared/ui/Icon';
import { DetailRow, ListingCard, RouteTimeline, StatusBadge, SummaryCard } from '../../../shared/ui/listing';
import { PageHeading } from '../../../shared/ui/navigation';
import { AppButton, Divider, ListSkeleton, ScreenState, SectionCard, TextField } from '../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';
import DriverRouteMap from '../components/DriverRouteMap';
import LoadPhotoGallery from '../components/LoadPhotoGallery';
import { formatMoney, loadStatusLabel, resolveMediaUrl, toFiniteNumber } from '../utils/presentation';

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

function DeliveryCompletionCard({ load, saving, onComplete }) {
  const [code, setCode] = useState('');
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setCode('');
    setPhoto(null);
    setError('');
  }, [load.id]);

  const choosePhoto = async source => {
    setError('');
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(source === 'camera' ? 'Kamera izni verilmedi.' : 'Galeri izni verilmedi.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled) return;
      const selectedPhoto = result.assets?.[0];
      if (!selectedPhoto?.uri || (selectedPhoto.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(selectedPhoto.mimeType))) {
        setError('Yalnızca JPEG, PNG veya WEBP fotoğraf seçilebilir.');
        return;
      }
      setPhoto(selectedPhoto);
    } catch (selectionError) {
      if (__DEV__) console.warn('[DELIVERY PHOTO] Selection failed.', { code: selectionError?.code, message: selectionError?.message });
      setError('Fotoğraf seçilirken bir hata oluştu.');
    }
  };

  const submit = () => {
    const normalizedCode = code.trim();
    if (!/^\d{4,6}$/.test(normalizedCode)) {
      setError('Müşterinin 4–6 haneli teslimat kodunu girin.');
      return;
    }
    if (!photo) {
      setError('Teslimat fotoğrafı zorunludur.');
      return;
    }
    setError('');
    onComplete(load, { code: normalizedCode, photo });
  };

  return <SectionCard title="Teslimatı tamamla" description="Müşterinin kodunu doğrulayın ve teslimat fotoğrafını ekleyin." icon="shield-checkmark-outline">
    <TextField label="Teslimat kodu" required value={code} onChangeText={value => { setCode(value.replace(/\D/g, '').slice(0, 6)); setError(''); }} keyboardType="number-pad" maxLength={6} placeholder="6 haneli kod" leftIcon="keypad-outline" />
    <View style={styles.deliveryPhotoActions}>
      <AppButton label="Galeriden seç" icon="images-outline" variant="secondary" compact fullWidth={false} style={styles.deliveryPhotoAction} onPress={() => choosePhoto('library')} />
      <AppButton label="Fotoğraf çek" icon="camera-outline" variant="secondary" compact fullWidth={false} style={styles.deliveryPhotoAction} onPress={() => choosePhoto('camera')} />
    </View>
    {photo ? <View style={styles.deliveryPhotoPreviewWrap}><Image source={{ uri: photo.uri }} style={styles.deliveryPhotoPreview} /><Pressable accessibilityLabel="Teslimat fotoğrafını kaldır" style={styles.deliveryPhotoRemove} onPress={() => setPhoto(null)}><Icon name="close" size={17} color={colors.white} /></Pressable></View> : null}
    {error ? <Text style={styles.deliveryError}>{error}</Text> : null}
    <Text style={styles.deliveryHint}>Kod ve fotoğraf backend tarafından birlikte doğrulanır.</Text>
    <AppButton label={saving ? 'Teslimat doğrulanıyor' : 'Teslimatı Tamamla'} icon="checkmark-done-outline" loading={saving} onPress={submit} style={styles.cardAction} />
  </SectionCard>;
}

function DriverHero({ jobs, onShowOffers }) {
  const averagePrice = jobs.length ? jobs.reduce((total, load) => total + toFiniteNumber(load.basePriceTl || load.agreedPriceTl), 0) / jobs.length : 0;
  return <>
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="navigate" size={24} color={colors.white} /></View><Text style={styles.heroEyebrow}>ŞOFÖR OPERASYON PANELİ</Text><Text style={styles.heroTitle}>Uygun rotayı seç, teklifini güvenle yönet.</Text><Text style={styles.heroText}>Yük ve operasyon koşullarını inceleyerek hazırlıklı yola çık.</Text></View>
    <View style={styles.summaryRow}><SummaryCard icon="briefcase-outline" value={jobs.length} label="Uygun iş" /><SummaryCard icon="cash-outline" value={formatMoney(averagePrice)} label="Ortalama fiyat" tone="accent" onPress={onShowOffers} /></View>
  </>;
}

export function DriverJobs({ loading, error, jobs, selected, form, setForm, formErrors, setFormErrors, saving, deliverySaving, onOpen, onClose, onAdjust, onSaveOffer, onStatus, onCompleteDelivery, retry, onShowOffers }) {
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
    <View style={styles.pricePanel}><View><Text style={styles.priceLabel}>MÜŞTERİ TAHMİNİ FİYATI</Text><Text style={styles.priceValue}>{formatMoney(selected.pricing?.recommendedPrice || selected.basePriceTl || selected.agreedPriceTl)}</Text></View>{selected.pricing?.loadExtra > 0 ? <Text style={styles.priceMetaText}>Yük farkı: +{formatMoney(selected.pricing.loadExtra)}</Text> : null}<View style={styles.priceMeta}><Icon name="navigate-outline" size={17} color={colors.primary} /><Text style={styles.priceMetaText}>{toFiniteNumber(selected.estimatedKm).toFixed(1)} km · {Math.round(toFiniteNumber(selected.routeDurationSeconds) / 60)} dk</Text></View></View>
    {statusAction?.nextStatus === 'completed' ? <DeliveryCompletionCard load={selected} saving={deliverySaving} onComplete={onCompleteDelivery} /> : statusAction ? <SectionCard title="Aktif taşıma" description="Yalnızca gerçekleşen bir sonraki operasyon adımını kaydedin." icon="shield-checkmark-outline">
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
        <View style={styles.offerPrices}><View><Text style={styles.priceLabel}>TEKLİFİNİZ</Text><Text style={styles.offerPrice}>{formatMoney(offer.amountTl)}</Text></View><View style={styles.offerBase}><Text style={styles.priceLabel}>MÜŞTERİ FİYATI</Text><Text style={styles.offerBaseValue}>{formatMoney(load.pricing?.recommendedPrice || load.basePriceTl || load.agreedPriceTl)}</Text></View></View>
        {offer.note ? <Text style={styles.offerNote}>{offer.note}</Text> : null}
        {offer.status === 'pending' ? <View style={styles.offerActions}><AppButton label="Düzenle" icon="create-outline" variant="secondary" compact fullWidth={false} style={styles.offerAction} onPress={() => onOpen(load, offer)} /><AppButton label="Geri çek" icon="trash-outline" variant="outlineDanger" compact fullWidth={false} style={styles.offerAction} onPress={() => onWithdraw(offer)} /></View> : null}
      </View>;
    })}
  </>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.ink, borderRadius: radius.xl, marginBottom: spacing.md, padding: spacing.xl }, heroIcon: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.md, height: 46, justifyContent: 'center', marginBottom: spacing.md, width: 46 }, heroEyebrow: { ...typography.caption, color: '#9FCBC1', letterSpacing: 1 }, heroTitle: { ...typography.display, color: colors.white, marginTop: spacing.xs }, heroText: { ...typography.body, color: '#C6D0DB', marginTop: spacing.sm }, summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  detail: { paddingBottom: spacing.md }, backButton: { marginBottom: spacing.sm, marginLeft: -spacing.sm }, detailTitleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }, detailTitleCopy: { flex: 1 }, detailTitle: { ...typography.h1, color: colors.ink }, detailCode: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs }, firstSection: { marginTop: spacing.md }, pricePanel: { backgroundColor: colors.primarySoft, borderColor: '#C9E1DB', borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, marginTop: spacing.md, padding: spacing.lg }, priceLabel: { ...typography.caption, color: colors.textMuted, letterSpacing: .7 }, priceValue: { ...typography.display, color: colors.primaryDark, marginTop: spacing.xxs }, priceMeta: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }, priceMetaText: { ...typography.smallMedium, color: colors.text },
  adjustRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }, amountField: { flex: 1, marginTop: 0 }, amountInput: { ...typography.h3, textAlign: 'center' }, cardAction: { marginTop: spacing.md },
  deliveryPhotoActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }, deliveryPhotoAction: { flex: 1 }, deliveryPhotoPreviewWrap: { alignSelf: 'flex-start', marginTop: spacing.md, position: 'relative' }, deliveryPhotoPreview: { borderRadius: radius.md, height: 150, width: 190 }, deliveryPhotoRemove: { alignItems: 'center', backgroundColor: colors.ink, borderColor: colors.surface, borderRadius: 13, borderWidth: 2, height: 26, justifyContent: 'center', position: 'absolute', right: -7, top: -7, width: 26 }, deliveryError: { ...typography.caption, color: colors.danger, marginTop: spacing.sm }, deliveryHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  offerCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.lg }, offerHeader: { alignItems: 'center', flexDirection: 'row' }, offerStatusIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 40, justifyContent: 'center', marginRight: spacing.sm, width: 40 }, offerTitleCopy: { flex: 1, paddingRight: spacing.xs }, offerTitle: { ...typography.h3, color: colors.ink }, offerTime: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, offerDivider: { marginVertical: spacing.md }, offerPrices: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' }, offerPrice: { ...typography.h2, color: colors.primaryDark, marginTop: 2 }, offerBase: { alignItems: 'flex-end' }, offerBaseValue: { ...typography.bodyMedium, color: colors.text, marginTop: 2 }, offerNote: { ...typography.small, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, color: colors.text, marginTop: spacing.md, padding: spacing.sm }, offerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }, offerAction: { flex: 1 },
});
