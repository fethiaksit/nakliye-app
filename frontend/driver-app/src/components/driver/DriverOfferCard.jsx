import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatListingTime } from '../../../../shared/loadMetadata';
import Icon from '../../../../shared/ui/Icon';
import { AppButton } from '../../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { formatMoney } from '../../utils/presentation';
import { getShortLocation } from './DriverJobCard';

export const offerStatusMeta = status => {
  switch (status) {
    case 'accepted':
      return { label: 'Kabul Edildi', tone: 'success', icon: 'checkmark-circle', bg: colors.successSoft, text: colors.success, border: '#A7F3D0' };
    case 'rejected':
      return { label: 'Reddedildi', tone: 'danger', icon: 'close-circle', bg: colors.dangerSoft, text: colors.danger, border: '#FECACA' };
    case 'withdrawn':
      return { label: 'Geri Çekildi', tone: 'neutral', icon: 'remove-circle-outline', bg: colors.surfaceMuted, text: colors.textSecondary, border: colors.border };
    case 'pending':
    default:
      return { label: 'Bekliyor', tone: 'warning', icon: 'time', bg: colors.warningSoft, text: colors.warning, border: '#FDE68A' };
  }
};

export default function DriverOfferCard({ item, onOpen, onWithdraw }) {
  const { offer, load } = item;
  if (!offer || !load) return null;

  const status = offerStatusMeta(offer.status);
  const pickup = getShortLocation(load.pickup);
  const delivery = getShortLocation(load.delivery);
  const timeLabel = formatListingTime(load);
  const basePrice = load.pricing?.recommendedPrice || load.basePriceTl || load.agreedPriceTl;

  return (
    <View style={styles.card}>
      {/* Top Row: Route & Status Badge */}
      <View style={styles.topRow}>
        <View style={styles.routeWrap}>
          <Text style={styles.routeText} numberOfLines={1}>
            {pickup} <Text style={styles.routeArrow}>→</Text> {delivery}
          </Text>
          <View style={styles.timeWrap}>
            <Icon name="time-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.timeText}>{timeLabel}</Text>
          </View>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: status.bg, borderColor: status.border }]}>
          <Icon name={status.icon} size={13} color={status.text} />
          <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
        </View>
      </View>

      {/* Pricing Box */}
      <View style={styles.priceBox}>
        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>TEKLİFİNİZ</Text>
          <Text style={styles.myPriceValue}>{formatMoney(offer.amountTl)}</Text>
        </View>

        <View style={styles.priceDivider} />

        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>MÜŞTERİ FİYATI</Text>
          <Text style={styles.basePriceValue}>{formatMoney(basePrice)}</Text>
        </View>
      </View>

      {/* Optional Note */}
      {offer.note ? (
        <View style={styles.noteWrap}>
          <Icon name="chatbox-outline" size={13} color={colors.textMuted} />
          <Text style={styles.noteText} numberOfLines={2}>{offer.note}</Text>
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <AppButton
          label="Detayı Gör"
          icon="eye-outline"
          variant="outline"
          compact
          style={styles.actionBtn}
          onPress={() => onOpen(load, offer)}
        />

        {offer.status === 'pending' ? (
          <>
            <AppButton
              label="Düzenle"
              icon="create-outline"
              variant="secondary"
              compact
              style={styles.actionBtn}
              onPress={() => onOpen(load, offer)}
            />
            <AppButton
              label="Geri Çek"
              icon="trash-outline"
              variant="outlineDanger"
              compact
              style={styles.actionBtn}
              onPress={() => onWithdraw(offer)}
            />
          </>
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
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.card,
  },
  topRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  routeWrap: {
    flex: 1,
    paddingRight: spacing.xs,
  },
  routeText: {
    ...typography.h3,
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  routeArrow: {
    color: colors.primary,
    fontWeight: '800',
  },
  timeWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  timeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  statusBadge: {
    alignItems: 'center',
    borderRadius: radius.xs,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
  },
  priceBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  priceCol: {
    flex: 1,
  },
  priceDivider: {
    backgroundColor: '#E2E8F0',
    height: 28,
    marginHorizontal: spacing.xs,
    width: 1,
  },
  priceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  myPriceValue: {
    ...typography.h3,
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 1,
  },
  basePriceValue: {
    ...typography.bodyMedium,
    color: colors.text,
    fontSize: 14,
    marginTop: 1,
  },
  noteWrap: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: radius.xs,
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  noteText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
});
