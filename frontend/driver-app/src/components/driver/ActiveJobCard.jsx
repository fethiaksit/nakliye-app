import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { driverStatusAction } from '../../../../shared/loadStatus';
import Icon from '../../../../shared/ui/Icon';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { getShortLocation } from './DriverJobCard';

export default function ActiveJobCard({ load, onPress, onAction, actionLoading }) {
  if (!load) return null;

  const pickup = getShortLocation(load.pickup);
  const delivery = getShortLocation(load.delivery);
  const action = driverStatusAction(load.status);
  const customerName = load.customer?.name || load.customerName || `İlan #${String(load.id || '').slice(-6).toUpperCase()}`;

  return (
    <View style={styles.card}>
      <Pressable onPress={() => onPress(load)} style={styles.contentArea}>
        {/* Top Tag & Customer */}
        <View style={styles.topRow}>
          <View style={styles.badge}>
            <View style={styles.dot} />
            <Text style={styles.badgeText}>AKTİF TAŞIMA</Text>
          </View>
          <View style={styles.customerWrap}>
            <Icon name="person-circle-outline" size={14} color="#94A3B8" />
            <Text style={styles.customerText} numberOfLines={1}>{customerName}</Text>
          </View>
        </View>

        {/* Route */}
        <Text style={styles.routeText} numberOfLines={1}>
          {pickup} <Text style={styles.routeArrow}>→</Text> {delivery}
        </Text>

        {/* Next Step Banner */}
        {action ? (
          <View style={styles.stepBanner}>
            <Icon name="arrow-forward-circle" size={16} color="#38BDF8" />
            <Text style={styles.stepText}>
              Sonraki Adım: <Text style={styles.stepHighlight}>{action.label}</Text>
            </Text>
          </View>
        ) : null}
      </Pressable>

      {/* Action Button */}
      <View style={styles.actionContainer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onAction ? onAction(load, action?.nextStatus) : onPress(load)}
          disabled={actionLoading}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        >
          <Icon name={action?.icon || 'arrow-forward-outline'} size={18} color={colors.white} />
          <Text style={styles.actionButtonText}>
            {actionLoading ? 'İşleniyor…' : action ? action.label : 'Detayı Gör & Devam Et'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
    padding: spacing.md,
    ...shadows.floating,
  },
  contentArea: {
    paddingBottom: spacing.xs,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: radius.xs,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  dot: {
    backgroundColor: '#38BDF8',
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeText: {
    ...typography.caption,
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  customerWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    maxWidth: '50%',
  },
  customerText: {
    ...typography.caption,
    color: '#94A3B8',
    fontSize: 11,
  },
  routeText: {
    ...typography.h2,
    color: colors.white,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  routeArrow: {
    color: '#38BDF8',
    fontWeight: '800',
  },
  stepBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  stepText: {
    ...typography.caption,
    color: '#CBD5E1',
    fontSize: 12,
  },
  stepHighlight: {
    color: colors.white,
    fontWeight: '700',
  },
  actionContainer: {
    marginTop: spacing.sm,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 48,
    justifyContent: 'center',
  },
  actionButtonPressed: {
    backgroundColor: colors.primaryDark,
    opacity: 0.9,
  },
  actionButtonText: {
    ...typography.button,
    color: colors.white,
    fontSize: 15,
  },
});
