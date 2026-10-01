import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatListingTime } from '../../../../shared/loadMetadata';
import Icon from '../../../../shared/ui/Icon';
import { StatusBadge } from '../../../../shared/ui/listing';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { formatMoney, loadStatusLabel, toFiniteNumber } from '../../utils/presentation';
import { getJobTags, getShortLocation } from './DriverJobCard';

export default function DriverJobSummary({ load }) {
  if (!load) return null;

  const pickup = getShortLocation(load.pickup);
  const delivery = getShortLocation(load.delivery);
  const distanceKm = toFiniteNumber(load.estimatedKm, toFiniteNumber(load.routeDistanceMeters) / 1000);
  const durationMins = Math.round(toFiniteNumber(load.routeDurationSeconds) / 60);
  const timeLabel = formatListingTime(load);
  const price = load.pricing?.recommendedPrice || load.basePriceTl || load.agreedPriceTl;
  const loadExtra = load.pricing?.loadExtra || 0;
  const tags = getJobTags(load);

  return (
    <View style={styles.card}>
      {/* Top Header: Job Code & Status Badge */}
      <View style={styles.headerRow}>
        <View style={styles.codeBadge}>
          <Text style={styles.jobCode}>İLAN #{String(load.id || '').slice(-6).toUpperCase()}</Text>
        </View>
        <StatusBadge status={load.status} label={loadStatusLabel(load.status)} />
      </View>

      {/* Main Route */}
      <Text style={styles.routeText}>
        {pickup} <Text style={styles.routeArrow}>→</Text> {delivery}
      </Text>

      {/* Sub-info: Time, Distance, Duration */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Icon name="time-outline" size={13} color={colors.primary} />
          <Text style={styles.metaText}>{timeLabel}</Text>
        </View>
        {distanceKm > 0 ? (
          <>
            <Text style={styles.dot}>·</Text>
            <View style={styles.metaItem}>
              <Icon name="navigate-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.metaText}>
                {distanceKm.toFixed(1)} km{durationMins > 0 ? ` (${durationMins} dk)` : ''}
              </Text>
            </View>
          </>
        ) : null}
      </View>

      {/* Tags */}
      <View style={styles.tagsRow}>
        {tags.map((tag, idx) => (
          <View
            key={`${tag.label}-${idx}`}
            style={[
              styles.tag,
              tag.type === 'category' && styles.tagCategory,
              tag.type === 'stops' && styles.tagStops,
            ]}
          >
            <Text
              style={[
                styles.tagText,
                tag.type === 'category' && styles.tagTextCategory,
                tag.type === 'stops' && styles.tagTextStops,
              ]}
            >
              {tag.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Price Container */}
      <View style={styles.priceContainer}>
        <View>
          <Text style={styles.priceLabel}>MÜŞTERİ TAHMİNİ FİYATI</Text>
          <Text style={styles.priceValue}>{formatMoney(price)}</Text>
        </View>
        {loadExtra > 0 ? (
          <View style={styles.extraBadge}>
            <Text style={styles.extraText}>+{formatMoney(loadExtra)} ek yük</Text>
          </View>
        ) : null}
      </View>
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
    padding: spacing.md,
    ...shadows.card,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  codeBadge: {
    backgroundColor: colors.surfaceMuted,
    borderColor: '#E2E8F0',
    borderRadius: radius.xs,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  jobCode: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  routeText: {
    ...typography.h2,
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  routeArrow: {
    color: colors.primary,
    fontWeight: '800',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  metaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  metaText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  dot: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tagsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
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
  priceContainer: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: '#C9E1DB',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    padding: spacing.md,
  },
  priceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  priceValue: {
    ...typography.h2,
    color: colors.primaryDark,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  extraBadge: {
    backgroundColor: colors.white,
    borderColor: '#C9E1DB',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  extraText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
  },
});
