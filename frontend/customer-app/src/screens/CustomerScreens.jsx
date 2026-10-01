import React, { useEffect, useState } from 'react';
import { formatWalletCents, walletUsagePreview } from '../../../shared/walletMoney.mjs';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CARGO_TYPE_OPTIONS,
  LOAD_TIMING_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  cargoTypeLabel,
  formatListingTime,
  stopTypeLabel,
  vehicleTypeLabel,
} from '../../../shared/loadMetadata';
import Icon from '../../../shared/ui/Icon';
import { DetailRow, ListingCard, RouteTimeline, StatusBadge, SummaryCard } from '../../../shared/ui/listing';
import { PageHeading } from '../../../shared/ui/navigation';
import { AppButton, Divider, ListSkeleton, ScreenState, SectionCard, TextField } from '../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../shared/ui/theme';
import { formatMoney, loadStatusLabel, resolveMediaUrl, toFiniteNumber } from '../utils/presentation';

export function CustomerHome({
  loads: items = [],
  onShowLoads,
  onOpenLoad,
  onNewLoad,
}) {
  const activeLoads = items.filter(item => !['completed', 'cancelled'].includes(item.status));
  const activeCount = activeLoads.length;
  const offerCount = items.reduce((total, item) => total + Number(item.offerCount || 0), 0);
  const completedCount = items.filter(item => item.status === 'completed').length;
  const recentLoads = items.slice(0, 3);

  return (
    <>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="shield-checkmark" size={24} color={colors.white} />
        </View>
        <Text style={styles.heroEyebrow}>GÜVENLİ NAKLİYE PAZARYERİ</Text>
        <Text style={styles.heroTitle}>Yükünü güvenle taşıt, en iyi teklifi seç.</Text>
        <Text style={styles.heroText}>
          Ev eşyası, mobilya, paletli ve ticari yükleriniz için onaylı nakliyecilerden dakikalar içinde teklif alın.
        </Text>
      </View>

      {/* Main CTA: + Yeni Nakliye Oluştur */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yeni Nakliye Oluştur"
        style={styles.newLoadCTA}
        onPress={onNewLoad}
      >
        <View style={styles.ctaIconWrap}>
          <Icon name="add" size={28} color={colors.white} />
        </View>
        <View style={styles.ctaCopy}>
          <Text style={styles.ctaTitle}>+ Yeni Nakliye Oluştur</Text>
          <Text style={styles.ctaSubtitle}>6 adımda kolayca ilan oluşturun ve teklif toplayın</Text>
        </View>
        <Icon name="chevron-forward" size={22} color={colors.primary} />
      </Pressable>

      {/* Summary Statistics */}
      <View style={styles.summaryRow}>
        <SummaryCard
          icon="file-tray-full-outline"
          value={activeCount}
          label="Aktif ilan"
          onPress={onShowLoads}
        />
        <SummaryCard
          icon="pricetags-outline"
          value={offerCount}
          label="Gelen teklif"
          tone="accent"
          onPress={onShowLoads}
        />
        <SummaryCard
          icon="checkmark-done-outline"
          value={completedCount}
          label="Tamamlanan"
          onPress={onShowLoads}
        />
      </View>

      {/* Recent Loads Section */}
      <View style={styles.sectionHeaderRow}>
        <PageHeading
          eyebrow="Takip"
          title="Son İlanlarım"
          subtitle="Güncel taşıma taleplerinizin anlık durumları."
        />
        {items.length > 3 ? (
          <Pressable onPress={onShowLoads} style={styles.seeAllButton}>
            <Text style={styles.seeAllText}>Tümünü Gör</Text>
            <Icon name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {!items.length ? (
        <View style={styles.emptyCard}>
          <Icon name="cube-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Henüz bir nakliye ilanınız yok</Text>
          <Text style={styles.emptySubtitle}>
            Hemen yeni bir ilan oluşturarak onaylı şoförlerden teklif almaya başlayabilirsiniz.
          </Text>
          <AppButton
            label="İlk İlanını Oluştur"
            icon="add-circle-outline"
            onPress={onNewLoad}
            style={styles.emptyAction}
          />
        </View>
      ) : (
        recentLoads.map(load => (
          <ListingCard
            key={load.id}
            load={load}
            onPress={() => onOpenLoad(load)}
            statusLabel={loadStatusLabel}
            formatMoney={formatMoney}
            resolveMediaUrl={resolveMediaUrl}
          />
        ))
      )}
    </>
  );
}

function PhotoStrip({ photos = [] }) {
  if (!photos.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.photoStrip}
    >
      {photos.map((path, index) => {
        const uri = resolveMediaUrl(path);
        return uri ? (
          <Image
            key={`${path}-${index}`}
            source={{ uri }}
            style={styles.detailPhoto}
          />
        ) : null;
      })}
    </ScrollView>
  );
}

function OperationalDetails({ load }) {
  const dimensions = load.dimensions || {};
  const cargoDetails = load.cargoDetails || {};

  return (
    <>
      <DetailRow
        icon="time-outline"
        label="Nakliye zamanı"
        value={formatListingTime(load)}
      />
      <DetailRow
        icon="cube-outline"
        label="Yük türü"
        value={`${cargoTypeLabel(load.cargoType)}${load.cargoTypeNote ? ` · ${load.cargoTypeNote}` : ''}`}
      />
      {load.stops && load.stops.length > 0 ? (
        <DetailRow
          icon="trail-sign-outline"
          label="Ara Duraklar"
          value={`${load.stops.length} ara durak mevcut`}
        />
      ) : null}
      <DetailRow
        icon="car-outline"
        label="Araç ihtiyacı"
        value={vehicleTypeLabel(load.vehicleType)}
      />
      <DetailRow
        icon="scale-outline"
        label="Ağırlık ve ölçüler"
        value={`${toFiniteNumber(dimensions.weightKg)} kg · ${toFiniteNumber(dimensions.lengthCm)} × ${toFiniteNumber(dimensions.widthCm)} × ${toFiniteNumber(dimensions.heightCm)} cm`}
      />
      {(load.pickupFloor !== undefined && load.pickupFloor !== null) ||
      (load.deliveryFloor !== undefined && load.deliveryFloor !== null) ? (
        <>
          <DetailRow
            icon="arrow-up-circle-outline"
            label="Çıkış erişimi"
            value={`${load.pickupFloor ?? '—'}. kat · Asansör ${load.pickupElevatorAvailable ? 'var' : 'yok'}`}
          />
          <DetailRow
            icon="arrow-down-circle-outline"
            label="Varış erişimi"
            value={`${load.deliveryFloor ?? '—'}. kat · Asansör ${load.deliveryElevatorAvailable ? 'var' : 'yok'}`}
          />
        </>
      ) : null}
      <DetailRow
        icon="people-outline"
        label="Yardımcı personel"
        value={load.helperNeeded ? `${load.helperCount} kişi gerekli` : 'Gerekmiyor'}
      />
      {cargoDetails.packagingRequired || cargoDetails.assemblyRequired ? (
        <DetailRow
          icon="construct-outline"
          label="Ek Hizmetler"
          value={[
            cargoDetails.packagingRequired ? 'Paketleme' : null,
            cargoDetails.assemblyRequired ? 'Montaj & Demontaj' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      ) : null}
      <DetailRow
        icon="document-text-outline"
        label="Açıklama"
        value={load.description || 'Belirtilmedi'}
      />
    </>
  );
}

export function CustomerLoads({
  loading,
  error,
  items,
  selected,
  offers,
  offersLoading,
  deliveryCode,
  deliveryCodeLoading,
  deliveryCodeError,
  walletInfo,
  walletError,
  walletLoading,
  onRetryWallet,
  walletSaving,
  onApplyWallet,
  isCorporate,
  isFavorite,
  favoriteSaving,
  onToggleFavorite,
  onRepeat,
  onOpen,
  onClose,
  onAccept,
  onCancel,
  retry,
}) {
  const [walletAmount, setWalletAmount] = useState('');
  useEffect(() => {
    setWalletAmount(walletInfo?.maxUsableCents > 0 ? String(walletInfo.maxUsableCents / 100) : '');
  }, [selected?.id, walletInfo?.maxUsableCents]);
  const walletPreview = walletUsagePreview(walletAmount, walletInfo?.maxUsableCents, walletInfo?.agreedAmountCents);

  if (selected) {
    return (
      <View style={styles.detail}>
        <AppButton
          label="İlanlarıma dön"
          icon="arrow-back"
          variant="ghost"
          compact
          fullWidth={false}
          onPress={onClose}
          style={styles.backButton}
        />
        <View style={styles.detailTitleRow}>
          <View style={styles.detailTitleCopy}>
            <Text style={styles.detailTitle}>{selected.title || 'Başlıksız ilan'}</Text>
            <Text style={styles.detailCode}>İlan #{String(selected.id || '').slice(-8).toUpperCase()}</Text>
          </View>
          <StatusBadge status={selected.status} label={loadStatusLabel(selected.status)} />
        </View>

        <PhotoStrip photos={selected.photoUrls} />

        <SectionCard title="Rota ve Duraklar" icon="navigate-outline">
          <RouteTimeline
            pickup={selected.pickup?.address}
            delivery={selected.delivery?.address}
            stops={selected.stops}
          />
          <View style={styles.routeMeta}>
            <View style={styles.routeMetaItem}>
              <Icon name="navigate-outline" size={17} color={colors.primary} />
              <Text style={styles.routeMetaText}>{toFiniteNumber(selected.estimatedKm).toFixed(1)} km</Text>
            </View>
            <View style={styles.routeMetaItem}>
              <Icon name="time-outline" size={17} color={colors.primary} />
              <Text style={styles.routeMetaText}>{Math.round(toFiniteNumber(selected.routeDurationSeconds) / 60)} dk</Text>
            </View>
          </View>
        </SectionCard>

        <SectionCard title="Operasyon özeti" icon="clipboard-outline">
          <OperationalDetails load={selected} />
        </SectionCard>

        {['driver_selected', 'driver_en_route', 'at_pickup', 'picked_up', 'en_route_to_delivery', 'delivered'].includes(selected.status) && !selected.deliveryVerified ? (
          <SectionCard
            title="Teslimat kodu"
            description="Teslimat gerçekleştiğinde bu kodu yalnızca atanmış şoförle paylaşın."
            icon="keypad-outline"
          >
            {deliveryCodeLoading ? (
              <Text style={styles.deliveryCodeMessage}>Kod yükleniyor…</Text>
            ) : deliveryCodeError ? (
              <Text style={styles.deliveryCodeError}>{deliveryCodeError}</Text>
            ) : (
              <Text selectable style={styles.deliveryCodeValue}>{deliveryCode || '—'}</Text>
            )}
          </SectionCard>
        ) : null}

        {selected.deliveryVerified ? (
          <SectionCard
            title="Teslimat doğrulandı"
            description={selected.deliveryVerifiedAt ? new Date(selected.deliveryVerifiedAt).toLocaleString('tr-TR') : 'Doğrulama zamanı kaydedildi.'}
            icon="checkmark-done-circle-outline"
          >
            <DetailRow icon="shield-checkmark-outline" label="Doğrulama" value="Teslimat kodu ve fotoğraf" />
            <PhotoStrip photos={selected.deliveryPhotoUrl ? [selected.deliveryPhotoUrl] : []} />
          </SectionCard>
        ) : null}

        <View style={styles.pricePanel}>
          <Text style={styles.priceLabel}>İLAN FİYATI</Text>
          <Text style={styles.priceValue}>
            {formatMoney(selected.agreedPriceTl || selected.pricing?.finalPrice || selected.basePriceTl)}
          </Text>
          {selected.pricing ? (
            <>
              <Text style={styles.priceBreakdown}>Başlangıç + yol: {formatMoney(selected.pricing.basePrice)}</Text>
              {selected.pricing.loadExtra > 0 ? (
                <Text style={styles.priceBreakdown}>Yük farkı: +{formatMoney(selected.pricing.loadExtra)}</Text>
              ) : null}
              {selected.pricing.waitingFee > 0 ? (
                <Text style={styles.priceBreakdown}>Bekleme: +{formatMoney(selected.pricing.waitingFee)}</Text>
              ) : null}
            </>
          ) : null}
        </View>

        {isCorporate && walletInfo ? (
          <SectionCard
            title="Kurumsal cüzdan"
            description="Bakiyenizi bu nakliyede kullanmak isteğe bağlıdır. Şoförün anlaşılan taşıma tutarı korunur."
            icon="wallet-outline"
          >
            <DetailRow icon="wallet-outline" label="Kullanılabilir bakiye" value={formatWalletCents(walletInfo.wallet?.balanceCents)} />
            <DetailRow icon="pricetag-outline" label="Kesinleşen nakliye tutarı" value={formatWalletCents(walletInfo.agreedAmountCents)} />
            {walletInfo.allocation ? (
              <>
                <DetailRow icon="remove-circle-outline" label={walletInfo.allocation.usageReversalTransactionId ? 'İade edilen kredi' : 'Kullanılan kredi'} value={formatWalletCents(walletInfo.usedCents)} />
                {!walletInfo.allocation.usageReversalTransactionId ? <DetailRow icon="cash-outline" label="Ödenecek kalan tutar" value={formatWalletCents(walletInfo.customerPayableCents)} /> : null}
              </>
            ) : selected.status === 'driver_selected' && walletInfo.maxUsableCents > 0 ? (
              <>
                <TextField
                  label="Kullanılacak kredi"
                  value={walletAmount}
                  onChangeText={setWalletAmount}
                  keyboardType="decimal-pad"
                  leftIcon="wallet-outline"
                  helper={`En fazla ${formatWalletCents(walletInfo.maxUsableCents)} kullanabilirsiniz. Tutarı azaltabilir veya kullanmadan devam edebilirsiniz.`}
                />
                <DetailRow icon="remove-circle-outline" label="Cüzdandan düşülecek" value={formatWalletCents(walletPreview.valid ? walletPreview.amountCents : 0)} />
                <DetailRow icon="cash-outline" label="Ödenecek kalan tutar" value={formatWalletCents(walletPreview.payableCents)} />
                {walletAmount && !walletPreview.valid ? <Text style={styles.walletMessage}>Kullanım sınırı içinde, en fazla iki ondalıklı pozitif bir tutar girin.</Text> : null}
                <AppButton
                  label="Cüzdan Bakiyemi Kullan"
                  icon="checkmark-circle-outline"
                  loading={walletSaving}
                  disabled={!walletPreview.valid || walletSaving}
                  onPress={() => onApplyWallet(walletPreview.amountCents)}
                  style={styles.cardAction}
                />
              </>
            ) : (
              <Text style={styles.walletMessage}>
                {walletInfo.enabled === false
                  ? 'Cüzdan kullanımı şu anda kapalıdır. Mevcut bakiyeniz korunur.'
                  : selected.status === 'driver_selected'
                  ? walletInfo.wallet?.balanceCents > 0 ? 'Bu nakliyede cüzdan kullanımı için izin verilen tutar sıfırdır.' : 'Kullanılabilir cüzdan bakiyesi bulunmuyor.'
                  : 'Cüzdan kredisi yalnız teklif kabul edildikten ve taşıma başlamadan önce uygulanabilir.'}
              </Text>
            )}
          </SectionCard>
        ) : null}

        {isCorporate && !walletInfo ? (
          <SectionCard title="Kurumsal cüzdan" icon="wallet-outline">
            {walletLoading ? <Text style={styles.walletMessage}>Cüzdan yükleniyor…</Text> : walletError ? <><Text style={styles.walletMessage}>{walletError}</Text><AppButton label="Cüzdanı yeniden yükle" onPress={onRetryWallet} /></> : null}
          </SectionCard>
        ) : null}

        <PageHeading title="Gelen teklifler" subtitle="Fiyat, süre ve şoför notlarını karşılaştırın." />
        {offersLoading ? (
          <ListSkeleton count={2} />
        ) : !offers.length ? (
          <ScreenState compact title="Henüz teklif yok" message="Şoför teklifleri geldiğinde burada görüntülenecek." />
        ) : (
          offers.map(item => {
            const offer = item.offer || item;
            const driver = item.driver || {};
            const difference = toFiniteNumber(offer.amountTl) - toFiniteNumber(selected.basePriceTl);
            return (
              <View key={offer.id} style={styles.offerCard}>
                <View style={styles.offerHeader}>
                  <View style={styles.driverAvatar}>
                    <Icon name="person" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.offerCopy}>
                    <Text style={styles.offerName}>{driver.name || 'Şoför'}</Text>
                    <Text style={styles.offerEta}>
                      {offer.estimatedArrivalMinutes ? `${offer.estimatedArrivalMinutes} dk içinde gelebilir` : 'Varış süresi belirtilmedi'}
                    </Text>
                  </View>
                  <StatusBadge status={offer.status} label={offer.status === 'pending' ? 'Bekliyor' : offer.status === 'accepted' ? 'Kabul edildi' : 'Kapandı'} />
                </View>
                {offer.note ? <Text style={styles.offerNote}>{offer.note}</Text> : null}
                <Divider style={styles.offerDivider} />
                <View style={styles.offerPriceRow}>
                  <View>
                    <Text style={styles.priceLabel}>TEKLİF</Text>
                    <Text style={styles.offerPrice}>{formatMoney(offer.amountTl)}</Text>
                  </View>
                  <Text style={styles.offerDifference}>
                    {difference < 0 ? `${formatMoney(Math.abs(difference))} daha uygun` : difference > 0 ? `${formatMoney(difference)} fark` : 'Tahmini fiyatla aynı'}
                  </Text>
                </View>
                {offer.status === 'pending' ? (
                  <AppButton label="Teklifi kabul et" icon="checkmark-circle-outline" onPress={() => onAccept(offer)} style={styles.cardAction} />
                ) : null}
              </View>
            );
          })
        )}

        {isCorporate && selected.status === 'completed' && selected.assignedDriverId ? (
          <AppButton
            label={isFavorite ? 'Favoriden Çıkar' : 'Favorilere Ekle'}
            icon={isFavorite ? 'heart-dislike-outline' : 'heart-outline'}
            variant="secondary"
            loading={favoriteSaving}
            onPress={() => onToggleFavorite(selected.assignedDriverId)}
            style={styles.cardAction}
          />
        ) : null}

        {isCorporate && ['completed', 'cancelled'].includes(selected.status) ? (
          <AppButton label="Tekrar İlan Ver" icon="copy-outline" variant="outline" onPress={() => onRepeat(selected)} style={styles.cardAction} />
        ) : null}

        {!['completed', 'cancelled'].includes(selected.status) ? (
          <AppButton label="İlanı iptal et" icon="close-circle-outline" variant="outlineDanger" onPress={() => onCancel(selected)} style={styles.dangerAction} />
        ) : null}
      </View>
    );
  }

  return (
    <>
      <PageHeading eyebrow="Talepleriniz" title="İlanlarım" subtitle="İlan durumlarını ve şoför tekliflerini takip edin." />
      {loading && !items.length ? (
        <ListSkeleton count={3} />
      ) : error ? (
        <ScreenState type="error" title="İlanlar yüklenemedi" message={error} onRetry={retry} />
      ) : !items.length ? (
        <ScreenState title="Henüz ilanınız yok" message="Ana sayfadan yeni nakliye talebi oluşturabilirsiniz." />
      ) : (
        items.map(load => (
          <ListingCard
            key={load.id}
            load={load}
            onPress={() => onOpen(load)}
            statusLabel={loadStatusLabel}
            formatMoney={formatMoney}
            resolveMediaUrl={resolveMediaUrl}
          />
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radius.xl,
    marginBottom: spacing.md,
    overflow: 'hidden',
    padding: spacing.xl,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 46,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 46,
  },
  heroEyebrow: {
    ...typography.caption,
    color: '#9FCBC1',
    letterSpacing: 1,
  },
  heroTitle: {
    ...typography.display,
    color: colors.white,
    marginTop: spacing.xs,
  },
  heroText: {
    ...typography.body,
    color: '#C6D0DB',
    marginTop: spacing.sm,
  },
  newLoadCTA: {
    alignItems: 'center',
    backgroundColor: '#F0FDF8',
    borderColor: colors.primary,
    borderRadius: radius.xl,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: spacing.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  ctaIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 48,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 48,
  },
  ctaCopy: {
    flex: 1,
  },
  ctaTitle: {
    ...typography.h3,
    color: colors.primaryDark,
  },
  ctaSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  seeAllButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    paddingVertical: spacing.xs,
  },
  seeAllText: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    textAlign: 'center',
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.ink,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: spacing.lg,
  },
  detail: {
    paddingBottom: spacing.md,
  },
  backButton: {
    marginBottom: spacing.sm,
    marginLeft: -spacing.sm,
  },
  detailTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  detailTitleCopy: {
    flex: 1,
  },
  detailTitle: {
    ...typography.h1,
    color: colors.ink,
  },
  detailCode: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  photoStrip: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  detailPhoto: {
    borderRadius: radius.md,
    height: 128,
    width: 160,
  },
  routeMeta: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  routeMetaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  routeMetaText: {
    ...typography.smallMedium,
    color: colors.text,
  },
  deliveryCodeValue: {
    ...typography.display,
    color: colors.primaryDark,
    letterSpacing: 8,
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  deliveryCodeMessage: {
    ...typography.body,
    color: colors.textSecondary,
    paddingVertical: spacing.sm,
  },
  deliveryCodeError: {
    ...typography.small,
    color: colors.danger,
    paddingVertical: spacing.sm,
  },
  walletMessage: {
    ...typography.small,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  pricePanel: {
    backgroundColor: colors.primarySoft,
    borderColor: '#C9E1DB',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  priceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.7,
  },
  priceValue: {
    ...typography.display,
    color: colors.primaryDark,
    marginTop: spacing.xxs,
  },
  priceBreakdown: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  offerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  offerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  driverAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 42,
  },
  offerCopy: {
    flex: 1,
  },
  offerName: {
    ...typography.h3,
    color: colors.ink,
  },
  offerEta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  offerNote: {
    ...typography.small,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    color: colors.text,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  offerDivider: {
    marginVertical: spacing.md,
  },
  offerPriceRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  offerPrice: {
    ...typography.h2,
    color: colors.primaryDark,
    marginTop: 2,
  },
  offerDifference: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  cardAction: {
    marginTop: spacing.md,
  },
  dangerAction: {
    marginBottom: spacing.xl,
    marginTop: spacing.sm,
  },
});
