import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cargoTypeLabel, vehicleTypeLabel } from '../../../../shared/loadMetadata';
import Icon from '../../../../shared/ui/Icon';
import { DetailRow } from '../../../../shared/ui/listing';
import { colors, radius, spacing, typography } from '../../../../shared/ui/theme';
import { toFiniteNumber } from '../../utils/presentation';
import LoadPhotoGallery from '../LoadPhotoGallery';

export default function DriverLoadDetails({ load }) {
  const [expanded, setExpanded] = useState(true);

  if (!load) return null;

  const cargoType = load.cargoType || 'diger';
  const details = load.cargoDetails || {};
  const dimensions = load.dimensions || {};
  const photos = load.photoUrls || [];

  const renderCategorySpecificRows = () => {
    switch (cargoType) {
      case 'ev_esyasi':
        return (
          <>
            <DetailRow
              icon="home-outline"
              label="Taşıma Kapsamı"
              value={details.homeSize ? `${details.homeSize} Komple Ev` : details.moveType === 'parca' ? 'Parça Ev Eşyası' : 'Komple Ev'}
            />
            {details.itemSummary ? (
              <DetailRow icon="list-outline" label="Eşya Özeti" value={details.itemSummary} />
            ) : null}
            {(details.packingRequired || details.disassemblyRequired || details.assemblyRequired || details.exteriorLiftRequired) ? (
              <DetailRow
                icon="construct-outline"
                label="Ek Hizmetler"
                value={[
                  details.packingRequired ? 'Paketleme' : null,
                  details.disassemblyRequired ? 'Söküm (Demontaj)' : null,
                  details.assemblyRequired ? 'Montaj' : null,
                  details.exteriorLiftRequired ? 'Mobil Dış Asansör' : null,
                ].filter(Boolean).join(' · ')}
              />
            ) : null}
            {details.hasSpecialItems && details.specialItemsDescription ? (
              <DetailRow icon="alert-circle-outline" label="Özel Eşya" value={details.specialItemsDescription} />
            ) : null}
          </>
        );

      case 'mobilya': {
        const items = details.items || [];
        return (
          <>
            {items.length > 0 ? (
              <DetailRow
                icon="bed-outline"
                label="Mobilyalar"
                value={items.map(i => `${i.name} (${i.count})`).join(', ')}
              />
            ) : null}
            {(details.disassemblyRequired || details.assemblyRequired) ? (
              <DetailRow
                icon="construct-outline"
                label="Mobilya Hizmeti"
                value={[
                  details.disassemblyRequired ? 'Söküm' : null,
                  details.assemblyRequired ? 'Montaj' : null,
                ].filter(Boolean).join(' & ')}
              />
            ) : null}
          </>
        );
      }

      case 'beyaz_esya': {
        const items = details.items || [];
        return (
          <>
            {items.length > 0 ? (
              <DetailRow
                icon="tv-outline"
                label="Cihazlar"
                value={items.map(i => `${i.name} (${i.count})`).join(', ')}
              />
            ) : null}
            {(details.disassemblyRequired || details.assemblyRequired) ? (
              <DetailRow
                icon="construct-outline"
                label="Tesisat & Kurulum"
                value={[
                  details.disassemblyRequired ? 'Söküm' : null,
                  details.assemblyRequired ? 'Bağlantı/Kurulum' : null,
                ].filter(Boolean).join(' & ')}
              />
            ) : null}
          </>
        );
      }

      case 'motosiklet':
        return (
          <>
            {details.motorcycleModel || details.motorcycleType ? (
              <DetailRow
                icon="bicycle-outline"
                label="Motosiklet"
                value={[details.motorcycleType, details.motorcycleModel].filter(Boolean).join(' · ')}
              />
            ) : null}
            <DetailRow
              icon="flash-outline"
              label="Çalışma Durumu"
              value={details.motorcycleRunning !== false ? 'Çalışır / yürür durumda' : 'Çalışmıyor (Çekici / itme)'}
            />
            {details.rampRequired !== false ? (
              <DetailRow icon="trending-up-outline" label="Rampa İhtiyacı" value="Araca yükleme için rampa gerekli" />
            ) : null}
            {details.specialFixingRequired !== false ? (
              <DetailRow icon="shield-outline" label="Sabitleme" value="Özel bağlama & sabitleme gerekli" />
            ) : null}
          </>
        );

      case 'paletli_yuk':
        return (
          <>
            <DetailRow
              icon="layers-outline"
              label="Palet Bilgisi"
              value={`${details.palletCount || 1} Palet${details.palletSize ? ` (${details.palletSize === 'euro' ? 'Euro 80×120' : details.palletSize === 'industrial' ? 'Endüstriyel' : 'Özel'})` : ''}`}
            />
            <DetailRow
              icon="hardware-chip-outline"
              label="Forklift Durumu"
              value={`Alımda: ${details.forkliftPickup ? 'Var' : 'Yok'} · Teslimatta: ${details.forkliftDelivery ? 'Var' : 'Yok'}`}
            />
            <DetailRow
              icon="apps-outline"
              label="İstifleme"
              value={details.stackable ? 'Üst üste konabilir (İstiflenebilir)' : 'İstiflenemez'}
            />
          </>
        );

      case 'ticari_yuk':
        return (
          <>
            {details.commercialType ? (
              <DetailRow icon="business-outline" label="Yük Türü" value={details.commercialType} />
            ) : null}
            {details.pieceCount ? (
              <DetailRow icon="cube-outline" label="Koli / Parça" value={`${details.pieceCount} adet`} />
            ) : null}
            {details.forkliftNeeded ? (
              <DetailRow icon="hardware-chip-outline" label="Ekipman" value="Forklift gerekiyor" />
            ) : null}

          </>
        );

      case 'parsiyel_yuk':
        return (
          <>
            {details.pieceCount ? (
              <DetailRow icon="cube-outline" label="Parça Sayısı" value={`${details.pieceCount} parça`} />
            ) : null}
            {details.fragile ? (
              <DetailRow icon="alert-circle-outline" label="Hassasiyet" value="Hassas / Kırılabilir yük" />
            ) : null}
            <DetailRow
              icon="apps-outline"
              label="İstifleme"
              value={details.stackable !== false ? 'Üzerine yük konabilir' : 'Üzerine yük konamaz'}
            />
          </>
        );

      default:
        return null;
    }
  };

  // Show building access (floors & elevators) only when meaningful (e.g. not motorcycle/pallet/commercial unless relevant)
  const isBuildingRelevant = ['ev_esyasi', 'mobilya', 'beyaz_esya'].includes(cargoType) ||
    Boolean(load.pickupFloor || load.deliveryFloor || load.pickupElevatorAvailable || load.deliveryElevatorAvailable);

  const hasWeightOrDims = toFiniteNumber(dimensions.weightKg) > 0 ||
    toFiniteNumber(dimensions.lengthCm) > 0 ||
    toFiniteNumber(load.weight) > 0;

  const totalWeight = toFiniteNumber(dimensions.weightKg, toFiniteNumber(load.weight));

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded(prev => !prev)}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Icon name="cube-outline" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Yük Detayları</Text>
            <Text style={styles.headerSubtitle}>{cargoTypeLabel(cargoType)} · {vehicleTypeLabel(load.vehicleType)}</Text>
          </View>
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
      </Pressable>

      {expanded ? (
        <View style={styles.content}>
          {photos.length > 0 ? (
            <View style={styles.galleryWrap}>
              <LoadPhotoGallery photos={photos} />
            </View>
          ) : null}

          {renderCategorySpecificRows()}
          <DetailRow
            icon="people-outline"
            label="Yükleme / Boşaltma"
            value={`Yükleme: ${(details.loadingResponsibility || (load.helperNeeded ? 'driver' : 'customer')) === 'driver' ? 'Şoför / Ekip' : 'Müşteri'} · Boşaltma: ${(details.unloadingResponsibility || (load.helperNeeded ? 'driver' : 'customer')) === 'driver' ? 'Şoför / Ekip' : 'Müşteri'}`}
          />

          {isBuildingRelevant ? (
            <>
              {(load.pickupFloor !== undefined && load.pickupFloor !== null) || (load.deliveryFloor !== undefined && load.deliveryFloor !== null) ? (
                <>
                  <DetailRow
                    icon="arrow-up-circle-outline"
                    label="Çıkış Katı"
                    value={`${load.pickupFloor ?? '0'}. kat · Asansör ${load.pickupElevatorAvailable ? 'var' : 'yok'}${details.pickupElevatorSuitable === false ? ' (Eşyaya uygun değil)' : ''}`}
                  />
                  <DetailRow
                    icon="arrow-down-circle-outline"
                    label="Varış Katı"
                    value={`${load.deliveryFloor ?? '0'}. kat · Asansör ${load.deliveryElevatorAvailable ? 'var' : 'yok'}${details.deliveryElevatorSuitable === false ? ' (Eşyaya uygun değil)' : ''}`}
                  />
                </>
              ) : null}
            </>
          ) : null}

          {load.helperNeeded ? (
            <DetailRow icon="people-outline" label="Yardımcı Eleman" value={`${load.helperCount || 1} kişi talep ediliyor`} />
          ) : null}

          {hasWeightOrDims ? (
            <DetailRow
              icon="scale-outline"
              label="Ağırlık & Ölçüler"
              value={[
                totalWeight > 0 ? `${totalWeight} kg` : null,
                !dimensions.volumeM3 && dimensions.lengthCm ? `${dimensions.lengthCm}×${dimensions.widthCm || '-'}×${dimensions.heightCm || '-'} cm` : null,
              ].filter(Boolean).join(' · ')}
            />
          ) : null}

          {dimensions.volumeM3 > 0 ? <DetailRow icon="cube-outline" label="Toplam Yük Hacmi" value={`${dimensions.volumeM3} m³`} /> : null}
          {load.pricing?.vehicleType && !load.pricing.manualQuoteRequired ? <DetailRow icon="car-outline" label="Önerilen Araç Sınıfı" value={vehicleTypeLabel(load.pricing.vehicleType)} /> : null}
          <DetailRow icon="car-outline" label="Araç İhtiyacı" value={vehicleTypeLabel(load.vehicleType)} />

          {load.description ? (
            <DetailRow icon="document-text-outline" label="Müşteri Notu" value={load.description} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: '#E2E8F0',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  content: {
    borderTopColor: '#F1F5F9',
    borderTopWidth: 1,
    padding: spacing.md,
    paddingTop: spacing.xs,
  },
  galleryWrap: {
    marginBottom: spacing.sm,
  },
});
