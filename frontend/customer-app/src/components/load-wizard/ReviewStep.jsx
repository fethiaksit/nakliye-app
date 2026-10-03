import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CARGO_TYPE_OPTIONS,
  LOAD_TIMING_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  cargoTypeLabel,
  generateLoadTitle,
  generateLoadDescription,
  stopTypeLabel,
  vehicleTypeLabel,
} from '../../../../shared/loadMetadata';
import { loads, logApiError } from '../../services/api';
import Icon from '../../../../shared/ui/Icon';
import { AppButton } from '../../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { formatMoney, resolveMediaUrl } from '../../utils/presentation';

const { buildPricingFields } = require('../../utils/loadForm.cjs');
const { verifyPricingEstimate, isPublishDisabled } = require('../../utils/pricingEstimate.cjs');

export default function ReviewStep({
  form = {},
  routeDraft = {},
  photos = [],
  onJumpToStep,
  onPublish,
  saving = false,
  errors = {},
}) {
  const { pickup, dropoff, stops = [], route } = routeDraft || {};
  const cargoDetails = form?.cargoDetails || {};

  useEffect(() => {
    if (!form?.cargoType && onJumpToStep) {
      onJumpToStep(1);
    }
  }, [form?.cargoType, onJumpToStep]);

  const autoTitle = generateLoadTitle(
    form?.cargoType,
    cargoDetails,
    form?.cargoTypeNote,
    pickup,
    dropoff,
  );

  // Timing text
  const timingLabel = form.urgencyType === 'immediate'
    ? 'Hemen (Acil Taşıma)'
    : form.urgencyType === 'today'
    ? 'Bugün İçinde'
    : `Planlı: ${form.scheduledDate || ''} ${form.scheduledTime || ''}`;

  // Vehicle label
  const vehicleLabel = !form.vehicleType || form.vehicleType === 'farketmez'
    ? 'Sistem En Uygun Aracı Önersin'
    : vehicleTypeLabel(form.vehicleType);

  // Distance & Duration
  const distanceKm = route?.distanceMeters ? (route.distanceMeters / 1000).toFixed(1) : null;
  const durationMin = route?.durationSeconds ? Math.round(route.durationSeconds / 60) : null;

  const location = value => ({ address: value?.address || value?.formattedAddress || '', latitude: Number(value?.latitude ?? value?.coordinate?.latitude), longitude: Number(value?.longitude ?? value?.coordinate?.longitude) });
  const requestKey = JSON.stringify({
    title: form.title?.trim() || autoTitle,
    description: form.description?.trim() || generateLoadDescription(form.cargoType, cargoDetails, form.cargoTypeNote, form),
    pickup: location(pickup), delivery: location(dropoff),
    stops: stops.map((stop, index) => ({ ...location(stop), stopType: stop.stopType || 'delivery', order: index + 1 })),
    ...buildPricingFields(form),
  });
  const [estimateState, setEstimateState] = useState({});
  const [retry, setRetry] = useState(0);
  const pricing = estimateState.key === requestKey ? estimateState.data : null;
  const estimateError = estimateState.key === requestKey ? estimateState.error : '';
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setEstimateState({ key: requestKey });
    loads.estimate(JSON.parse(requestKey), controller.signal)
      .then(({ data }) => { if (active) setEstimateState({ key: requestKey, data: verifyPricingEstimate(data) }); })
      .catch(error => { if (active) logApiError('pricingEstimate', error); if (active) setEstimateState({ key: requestKey, error: 'Şu anda tahmini fiyat gösterilemiyor. İlanınızı yayınlayabilirsiniz; fiyat şoför teklifleriyle belirlenecek.' }); });
    return () => { active = false; controller.abort(); };
  }, [requestKey, retry]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>İlanınızı İnceleyin</Text>
      <Text style={styles.subtitle}>Tüm bilgileri kontrol edip ilanı şoförlerin teklifine açabilirsiniz.</Text>

      {/* Auto Generated Title Card */}
      <View style={styles.titleCard}>
        <View style={styles.badgeRow}>
          <View style={styles.tagBadge}>
            <Icon name="sparkles" size={14} color={colors.primaryDark} />
            <Text style={styles.tagBadgeText}>Otomatik Oluşturulan Başlık</Text>
          </View>
        </View>
        <Text style={styles.loadMainTitle}>{autoTitle}</Text>
      </View>

      {/* 1. Yük ve Operasyon Bilgileri */}
      <View style={styles.sectionCard}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <Icon name="cube-outline" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Yük ve Hizmetler</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onJumpToStep(2)}
            style={styles.editButton}
          >
            <Icon name="create-outline" size={16} color={colors.primary} />
            <Text style={styles.editText}>Düzenle</Text>
          </Pressable>
        </View>

        <View style={styles.detailsList}>
          <DetailLine label="Yük Türü" value={`${cargoTypeLabel(form.cargoType)}${form.cargoTypeNote ? ` (${form.cargoTypeNote})` : ''}`} />
          
          {cargoDetails.moveType && (
            <DetailLine label="Taşıma Tipi" value={cargoDetails.moveType === 'komple' ? `Komple Ev (${cargoDetails.homeSize || 'Belirtilmedi'})` : 'Parça Eşya'} />
          )}

          {cargoDetails.items && cargoDetails.items.length > 0 && (
            <DetailLine
              label="Eşya Listesi"
              value={cargoDetails.items.map(i => `${i.name} (x${i.count})`).join(', ')}
            />
          )}

          {cargoDetails.palletCount ? (
            <DetailLine label="Palet Sayısı" value={`${cargoDetails.palletCount} adet`} />
          ) : null}

          {cargoDetails.pieceCount ? (
            <DetailLine label="Parça Sayısı" value={`${cargoDetails.pieceCount} parça`} />
          ) : null}

          {form.weight ? (
            <DetailLine label="Tahmini Ağırlık" value={`${form.weight} kg`} />
          ) : null}

          {/* Access info if relevant */}
          {['ev_esyasi', 'mobilya', 'beyaz_esya'].includes(form.cargoType) && (
            <>
              <DetailLine
                label="Çıkış Katı & Asansör"
                value={`${form.pickupFloor || 0}. Kat · ${form.pickupElevatorAvailable ? 'Asansör Var' : 'Asansör Yok'}`}
              />
              <DetailLine
                label="Varış Katı & Asansör"
                value={`${form.deliveryFloor || 0}. Kat · ${form.deliveryElevatorAvailable ? 'Asansör Var' : 'Asansör Yok'}`}
              />
            </>
          )}

          {/* Extra Services */}
          {(cargoDetails.packagingRequired || cargoDetails.assemblyRequired || form.helperNeeded) && (
            <DetailLine
              label="Ek Hizmetler"
              value={[
                form.helperNeeded ? `${form.helperCount || 1} Yardımcı Taşıyıcı` : null,
                cargoDetails.packagingRequired ? 'Paketleme' : null,
                cargoDetails.assemblyRequired ? 'Montaj & Demontaj' : null,
              ].filter(Boolean).join(' · ')}
            />
          )}
        </View>
      </View>

      {/* 2. Rota ve Duraklar */}
      <View style={styles.sectionCard}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <Icon name="map-outline" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Güzergah ve Duraklar</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onJumpToStep(3)}
            style={styles.editButton}
          >
            <Icon name="create-outline" size={16} color={colors.primary} />
            <Text style={styles.editText}>Düzenle</Text>
          </Pressable>
        </View>

        <View style={styles.routeBox}>
          {/* Pickup */}
          <View style={styles.routeItem}>
            <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
            <View style={styles.routeTextWrap}>
              <Text style={styles.routeType}>Başlangıç</Text>
              <Text style={styles.routeAddress}>{pickup?.address || 'Belirtilmedi'}</Text>
            </View>
          </View>

          {/* Intermediates */}
          {stops.map((stop, idx) => (
            <View key={`review-stop-${idx}`} style={styles.routeItem}>
              <View style={[styles.routeDot, { backgroundColor: '#F4A261' }]} />
              <View style={styles.routeTextWrap}>
                <Text style={styles.routeType}>
                  Ara Durak {idx + 1} ({stopTypeLabel(stop.stopType)})
                </Text>
                <Text style={styles.routeAddress}>{stop.address || 'Belirtilmedi'}</Text>
                {stop.note ? <Text style={styles.stopNote}>Not: {stop.note}</Text> : null}
              </View>
            </View>
          ))}

          {/* Dropoff */}
          <View style={styles.routeItem}>
            <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
            <View style={styles.routeTextWrap}>
              <Text style={styles.routeType}>Varış</Text>
              <Text style={styles.routeAddress}>{dropoff?.address || 'Belirtilmedi'}</Text>
            </View>
          </View>
        </View>

        {distanceKm ? (
          <View style={styles.routeMetricsRow}>
            <View style={styles.metricItem}>
              <Icon name="navigate-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.metricText}>Mesafe: {distanceKm} km</Text>
            </View>
            {durationMin ? (
              <View style={styles.metricItem}>
                <Icon name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.metricText}>Tahmini Süre: {durationMin} dk</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* 3. Zamanlama */}
      <View style={styles.sectionCard}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <Icon name="time-outline" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Taşıma Zamanı</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onJumpToStep(4)}
            style={styles.editButton}
          >
            <Icon name="create-outline" size={16} color={colors.primary} />
            <Text style={styles.editText}>Düzenle</Text>
          </Pressable>
        </View>

        <View style={styles.detailsList}>
          <DetailLine label="Zaman Planı" value={timingLabel} />
        </View>
      </View>

      {/* 4. Fotoğraflar, Araç ve Notlar */}
      <View style={styles.sectionCard}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <Icon name="options-outline" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Fotoğraf & Tercihler</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onJumpToStep(5)}
            style={styles.editButton}
          >
            <Icon name="create-outline" size={16} color={colors.primary} />
            <Text style={styles.editText}>Düzenle</Text>
          </Pressable>
        </View>

        <View style={styles.detailsList}>
          <DetailLine label="Araç Tercihi" value={vehicleLabel} />
          <DetailLine label="Fotoğraf Sayısı" value={photos.length > 0 ? `${photos.length} fotoğraf eklendi` : 'Fotoğraf eklenmedi'} />
          {form.description ? (
            <DetailLine label="Özel Notlar" value={form.description} />
          ) : null}
        </View>

        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoThumbList}>
            {photos.map((p, idx) => {
              const uri = typeof p === 'string' ? resolveMediaUrl(p) || p : p?.uri;
              return uri ? (
                <Image key={`review-photo-${idx}`} source={{ uri }} style={styles.photoThumb} />
              ) : null;
            })}
          </ScrollView>
        )}
      </View>

      {/* Tahmini Fiyat Aralığı Bilgilendirmesi */}
      <View style={styles.priceEstimateCard}>
        <View style={styles.priceHeader}>
          <Icon name="pricetag" size={20} color={colors.primary} />
          <Text style={styles.priceTitle}>Önerilen Nakliye Fiyatı</Text>
        </View>
        {pricing ? pricing.manualQuoteRequired ? (
          <Text style={styles.priceDisclaimer}>Bu taşıma için şoför teklifi gerekli. İlanınızı yayınlayabilirsiniz; eşya bilgileri ve taşıma koşullarına göre teklifler gelecektir.</Text>
        ) : (
          <>
            <Text style={styles.priceRange}>{formatMoney(pricing.recommendedPrice)}</Text>
            <Text style={styles.priceDisclaimer}>Tahmini aralık: {formatMoney(pricing.minPrice)} – {formatMoney(pricing.maxPrice)}</Text>
            <Text style={styles.priceDisclaimer}>Önerilen araç: {vehicleTypeLabel(pricing.vehicleType)} · İlk 5 km dahil</Text>
            <Text style={styles.priceDisclaimer}>Araç taban ücreti: {formatMoney(pricing.baseDriverFee)}</Text>
            <Text style={styles.priceDisclaimer}>Mesafe farkı: {formatMoney(pricing.distanceFee)} · {pricing.pricePerKm} TL/km</Text>
            {pricing.loadMultiplier > 1 ? <Text style={styles.priceDisclaimer}>Doluluk katsayısı: ×{pricing.loadMultiplier}</Text> : null}
            {pricing.nightMultiplier > 1 ? <Text style={styles.priceDisclaimer}>Saat katsayısı: ×{pricing.nightMultiplier}</Text> : null}
            {pricing.urgentMultiplier > 1 ? <Text style={styles.priceDisclaimer}>Aciliyet katsayısı: ×{pricing.urgentMultiplier}</Text> : null}
            {pricing.loadingFee > 0 ? <Text style={styles.priceDisclaimer}>Yükleme / boşaltma yardımı: {formatMoney(pricing.loadingFee)}</Text> : null}
            {pricing.pickupFloorFee + pricing.deliveryFloorFee > 0 ? <Text style={styles.priceDisclaimer}>Kat ücreti: {formatMoney(pricing.pickupFloorFee + pricing.deliveryFloorFee)}</Text> : null}
            <Text style={styles.priceDisclaimer}>Kesin fiyat, kabul edeceğiniz şoför teklifiyle belirlenir. Paketleme, montaj, forklift ve özel taşıma hizmetleri ayrıca teklif edilir.</Text>
          </>
        ) : estimateError ? (
          <><Text style={styles.priceDisclaimer}>{estimateError}</Text><AppButton label="Yeniden hesapla" variant="secondary" onPress={() => setRetry(value => value + 1)} /></>
        ) : <Text style={styles.priceDisclaimer}>Fiyat hesaplanıyor…</Text>}

      </View>

      {/* Errors Banner */}
      {Object.keys(errors).length > 0 ? (
        <View style={styles.errorBanner}>
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorBannerText}>
            Lütfen eksik veya hatalı adımları kontrol edin.
          </Text>
        </View>
      ) : null}

      {/* Publish Button */}
      <AppButton
        label={saving ? 'İlan Hazırlanıyor...' : 'İlanı Yayınla'}
        icon="send"
        loading={saving}
        onPress={onPublish}
        disabled={isPublishDisabled({ saving })}
        style={styles.publishButton}
      />
      <Text style={styles.publishHint}>
        İlanınız yayınlandıktan sonra uygun nakliyeciler teklif vermeye başlayacaktır.
      </Text>
    </View>
  );
}

function DetailLine({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
  },
  title: {
    ...typography.h2,
    color: colors.ink,
    marginBottom: spacing.xxs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  titleCard: {
    backgroundColor: '#F0FDF8',
    borderColor: colors.primary,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginBottom: spacing.md,
    padding: spacing.md,
    ...shadows.card,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  tagBadge: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  tagBadgeText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  loadMainTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
    ...shadows.card,
  },
  cardHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    marginBottom: spacing.sm,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.ink,
  },
  editButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    padding: spacing.xs,
  },
  editText: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '600',
  },
  detailsList: {
    gap: spacing.xs,
  },
  detailLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  detailValue: {
    ...typography.body,
    color: colors.ink,
    flex: 2,
    fontWeight: '500',
    textAlign: 'right',
  },
  routeBox: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  routeItem: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  routeDot: {
    borderRadius: 5,
    height: 10,
    marginTop: 5,
    width: 10,
  },
  routeTextWrap: {
    flex: 1,
  },
  routeType: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  routeAddress: {
    ...typography.body,
    color: colors.ink,
    marginTop: 1,
  },
  stopNote: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  routeMetricsRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
  },
  metricItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  metricText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  photoThumbList: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  photoThumb: {
    borderRadius: radius.md,
    height: 60,
    marginRight: spacing.xs,
    width: 60,
  },
  priceEstimateCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  priceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  priceTitle: {
    ...typography.h4,
    color: colors.ink,
  },
  priceRange: {
    ...typography.h2,
    color: colors.primaryDark,
    marginVertical: spacing.xs,
  },
  priceDisclaimer: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  errorBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  errorBannerText: {
    ...typography.small,
    color: colors.danger,
    flex: 1,
  },
  publishButton: {
    marginBottom: spacing.xs,
  },
  publishHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
