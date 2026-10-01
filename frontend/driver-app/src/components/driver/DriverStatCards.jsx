import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '../../../../shared/ui/Icon';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';

export default function DriverStatCards({ jobsCount = 0, activeOffersCount = 0, activeJobsCount = 0, onOffersPress, onActiveJobPress }) {
  return (
    <View style={styles.container}>
      {/* Uygun İş Kartı */}
      <View style={[styles.card, styles.cardPrimary]}>
        <View style={[styles.iconWrap, styles.iconPrimary]}>
          <Icon name="briefcase-outline" size={17} color={colors.primary} />
        </View>
        <Text style={styles.value}>{jobsCount}</Text>
        <Text style={styles.label}>Uygun İş</Text>
      </View>

      {/* Aktif Teklif Kartı */}
      <Pressable
        accessibilityRole="button"
        onPress={onOffersPress}
        style={({ pressed }) => [styles.card, styles.cardAccent, pressed && styles.pressed]}
      >
        <View style={[styles.iconWrap, styles.iconAccent]}>
          <Icon name="pricetags-outline" size={17} color={colors.accent} />
        </View>
        <Text style={[styles.value, activeOffersCount > 0 && styles.valueAccent]}>{activeOffersCount}</Text>
        <Text style={styles.label}>Aktif Teklif</Text>
      </Pressable>

      {/* Aktif Taşıma Kartı */}
      <Pressable
        accessibilityRole="button"
        onPress={activeJobsCount > 0 ? onActiveJobPress : undefined}
        style={({ pressed }) => [
          styles.card,
          styles.cardInfo,
          activeJobsCount > 0 && styles.cardInfoActive,
          pressed && activeJobsCount > 0 && styles.pressed,
        ]}
      >
        <View style={[styles.iconWrap, styles.iconInfo, activeJobsCount > 0 && styles.iconInfoActive]}>
          <Icon
            name="navigate-circle-outline"
            size={17}
            color={activeJobsCount > 0 ? colors.white : colors.info}
          />
        </View>
        <Text style={[styles.value, activeJobsCount > 0 && styles.valueInfo]}>
          {activeJobsCount > 0 ? `${activeJobsCount} İş` : '0'}
        </Text>
        <Text style={styles.label}>Aktif Taşıma</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    padding: spacing.sm,
    ...shadows.card,
  },
  cardPrimary: {
    borderTopColor: colors.primary,
    borderTopWidth: 2,
  },
  cardAccent: {
    borderTopColor: colors.accent,
    borderTopWidth: 2,
  },
  cardInfo: {
    borderTopColor: colors.info,
    borderTopWidth: 2,
  },
  cardInfoActive: {
    backgroundColor: '#F0F7FF',
    borderColor: '#93C5FD',
    borderTopColor: colors.info,
    borderTopWidth: 2,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 30,
    justifyContent: 'center',
    marginBottom: 6,
    width: 30,
  },
  iconPrimary: {
    backgroundColor: colors.primarySoft,
  },
  iconAccent: {
    backgroundColor: colors.accentSoft,
  },
  iconInfo: {
    backgroundColor: colors.infoSoft,
  },
  iconInfoActive: {
    backgroundColor: colors.info,
  },
  value: {
    ...typography.h2,
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  valueAccent: {
    color: colors.accent,
  },
  valueInfo: {
    color: colors.info,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
