import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cargoTypeLabel, formatListingTime } from '../../../../shared/loadMetadata';
import Icon from '../../../../shared/ui/Icon';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { formatMoney, toFiniteNumber } from '../../utils/presentation';

export function getShortLocation(location) {
  if (!location) return 'Konum belirtilmedi';
  if (location.district && location.city && location.district !== location.city) {
    return `${location.district}, ${location.city}`;
  }
  if (location.district) return location.district;
  if (location.city) return location.city;
  const parts = String(location.address || location.formattedAddress || '').split(',');
  return parts[0]?.trim() || 'Konum belirtilmedi';
}

export function getJobTags(load) {
  const tags = [];
  const cargoType = load.cargoType;
  const details = load.cargoDetails || {};

  // 1. Primary Category Tag
  tags.push({ label: cargoTypeLabel(cargoType), type: 'category' });

  // 2. Subtype Tag
  switch (cargoType) {
    case 'ev_esyasi':
      if (details.homeSize) tags.push({ label: details.homeSize, type: 'spec' });
      else if (details.moveType === 'parca') tags.push({ label: 'Parça', type: 'spec' });
      break;
    case 'mobilya': {
      const count = (details.items || []).reduce((sum, item) => sum + (Number(item.count) || 1), 0);
      if (count > 0) tags.push({ label: `${count} Parça`, type: 'spec' });
      break;
    }
    case 'beyaz_esya': {
      const count = (details.items || []).reduce((sum, item) => sum + (Number(item.count) || 1), 0);
      if (count > 0) tags.push({ label: `${count} Cihaz`, type: 'spec' });
      break;
    }
    case 'motosiklet':
      if (details.motorcycleModel) tags.push({ label: details.motorcycleModel, type: 'spec' });
      else if (details.motorcycleType) tags.push({ label: details.motorcycleType, type: 'spec' });
      if (details.rampRequired !== false) tags.push({ label: 'Rampa Gerekli', type: 'feature' });
      break;
    case 'paletli_yuk':
      if (details.palletCount) tags.push({ label: `${details.palletCount} Palet`, type: 'spec' });
      break;
    case 'ticari_yuk':
      if (details.commercialType) tags.push({ label: details.commercialType, type: 'spec' });
      else if (details.pieceCount) tags.push({ label: `${details.pieceCount} Koli`, type: 'spec' });
      break;
    case 'parsiyel_yuk':
      if (details.pieceCount) tags.push({ label: `${details.pieceCount} Parça`, type: 'spec' });
      if (details.fragile) tags.push({ label: 'Hassas', type: 'warning' });
      break;
    default:
      if (load.cargoTypeNote) tags.push({ label: load.cargoTypeNote.slice(0, 16), type: 'spec' });
      break;
  }

  // 3. Elevator Tag for Home & Furniture
  if (['ev_esyasi', 'mobilya', 'beyaz_esya'].includes(cargoType)) {
    if (load.pickupElevatorAvailable === false || load.deliveryElevatorAvailable === false) {
      tags.push({ label: 'Asansör Yok', type: 'muted' });
    } else if (load.pickupElevatorAvailable && load.deliveryElevatorAvailable) {
      tags.push({ label: 'Asansör Var', type: 'muted' });
    }
  }

  // 4. Stops count tag
  if (Array.isArray(load.stops) && load.stops.length > 0) {
    tags.push({ label: `+${load.stops.length} Durak`, type: 'stops' });
  }

  return tags;
}

export default function DriverJobCard({ load, onPress }) {
  const pickup = getShortLocation(load.pickup);
  const delivery = getShortLocation(load.delivery);
  const distanceKm = toFiniteNumber(load.estimatedKm, toFiniteNumber(load.routeDistanceMeters) / 1000);
  const price = load.pricing?.recommendedPrice || load.basePriceTl || load.agreedPriceTl;
  const timeLabel = formatListingTime(load);
  const tags = getJobTags(load);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {/* Route Row (Main Headline) */}
      <View style={styles.routeRow}>
        <Text style={styles.routeText} numberOfLines={1}>
          {pickup} <Text style={styles.routeArrow}>→</Text> {delivery}
        </Text>
      </View>

      {/* Sub-info: Distance & Time */}
      <View style={styles.subInfoRow}>
        <View style={styles.metaItem}>
          <Icon name="navigate-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.metaText}>{distanceKm > 0 ? `${distanceKm.toFixed(0)} km` : 'Mesafe hesabı'}</Text>
        </View>
        <Text style={styles.dotSeparator}>·</Text>
        <View style={styles.metaItem}>
          <Icon name="time-outline" size={13} color={colors.primary} />
          <Text style={[styles.metaText, styles.timeText]}>{timeLabel}</Text>
        </View>
      </View>

      {/* Tags Row */}
      <View style={styles.tagsRow}>
        {tags.map((tag, idx) => (
          <View
            key={`${tag.label}-${idx}`}
            style={[
              styles.tag,
              tag.type === 'category' && styles.tagCategory,
              tag.type === 'stops' && styles.tagStops,
              tag.type === 'warning' && styles.tagWarning,
            ]}
          >
            <Text
              style={[
                styles.tagText,
                tag.type === 'category' && styles.tagTextCategory,
                tag.type === 'stops' && styles.tagTextStops,
                tag.type === 'warning' && styles.tagTextWarning,
              ]}
            >
              {tag.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Footer Row: Price & Action */}
      <View style={styles.footerRow}>
        <View style={styles.priceWrap}>
          <Text style={styles.priceLabel}>TAHMİNİ</Text>
          <Text style={styles.priceValue}>{formatMoney(price)}</Text>
        </View>

        <View style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>Detayı Gör</Text>
          <Icon name="chevron-forward" size={15} color={colors.primaryDark} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: '#E2E8F0',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.card,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.995 }],
  },
  routeRow: {
    marginBottom: 4,
  },
  routeText: {
    ...typography.h3,
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  routeArrow: {
    color: colors.primary,
    fontWeight: '800',
  },
  subInfoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.xs,
  },
  metaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  metaText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  timeText: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  dotSeparator: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tagsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: spacing.xs,
  },
  tag: {
    backgroundColor: colors.surfaceMuted,
    borderColor: '#E2E8F0',
    borderRadius: radius.xs,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  tagCategory: {
    backgroundColor: colors.primarySoft,
    borderColor: '#C9E1DB',
  },
  tagStops: {
    backgroundColor: colors.accentSoft,
    borderColor: '#FED7AA',
  },
  tagWarning: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#FECACA',
  },
  tagText: {
    ...typography.caption,
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  tagTextCategory: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  tagTextStops: {
    color: colors.accentDark || colors.accent,
    fontWeight: '700',
  },
  tagTextWarning: {
    color: colors.danger,
    fontWeight: '700',
  },
  footerRow: {
    alignItems: 'center',
    borderTopColor: '#F1F5F9',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
  },
  priceWrap: {
    flexDirection: 'column',
  },
  priceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  priceValue: {
    ...typography.h2,
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 1,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: '#C9E1DB',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  actionBtnText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
  },
});
