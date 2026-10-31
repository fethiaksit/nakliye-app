import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Icon from '../../../../shared/ui/Icon';
import { AppButton } from '../../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { formatWalletCents } from '../../../../shared/walletMoney.mjs';

export default function PaymentApprovalModal({
  visible,
  load,
  loading = false,
  onApprove,
  onReject,
  onClose,
}) {
  const approval = load?.paymentApproval;
  if (!approval) return null;

  const totalAmount = formatWalletCents(approval.amountCents);
  const payableAmount = formatWalletCents(approval.customerPayableCents);
  const creditAmount = formatWalletCents(approval.creditCents);
  const hasCredit = approval.creditCents > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={loading ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
        />
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.badgeWrap}>
              <View style={styles.badgeIcon}>
                <Icon name="briefcase-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.badgeTextWrap}>
                <Text style={styles.badgeTitle}>KURUMSAL NAKLİYE</Text>
                <Text style={styles.badgeSubtitle}>Ödeme Şekli ve Taşıma Onayı</Text>
              </View>
            </View>
            <Pressable
              hitSlop={12}
              disabled={loading}
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} bounces={false} showsVerticalScrollIndicator={false}>
            {/* Price Breakdown Container */}
            <View style={styles.breakdownBox}>
              <View style={styles.breakdownRow}>
                <Text style={styles.rowLabel}>Toplam Anlaşılan Bedel</Text>
                <Text style={styles.rowValuePrimary}>{totalAmount}</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.breakdownRow}>
                <View style={styles.rowLabelGroup}>
                  <Icon name="cash-outline" size={16} color={colors.success} />
                  <Text style={styles.rowLabel}>Müşteriden Alınacak Nakit</Text>
                </View>
                <Text style={styles.rowValueCash}>{payableAmount}</Text>
              </View>

              <View style={styles.breakdownRow}>
                <View style={styles.rowLabelGroup}>
                  <Icon name="wallet-outline" size={16} color={colors.primary} />
                  <Text style={styles.rowLabel}>Cüzdanınıza Aktarılacak</Text>
                </View>
                <Text style={styles.rowValueCredit}>+{creditAmount}</Text>
              </View>
            </View>

            {/* Explanatory Info Box */}
            <View style={styles.infoBox}>
              <Icon name="information-circle" size={18} color={colors.primary} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                {hasCredit
                  ? `Müşteri kurumsal cüzdanından ${creditAmount} indirim kullanmaktadır. Bu tutar teslimat başarıyla tamamlandığında NakliyeGo cüzdanınıza bakiye olarak aktarılacaktır.`
                  : 'Bu taşıma kurumsal müşteri kapsamında gerçekleşmektedir. Müşteri anlaşılan bedelin tamamını tarafınıza ödeyecektir.'}
              </Text>
            </View>

            <Text style={styles.subNote}>
              Cüzdan bakiyesi sonraki komisyon ödemelerinizde kullanılabilir. Bu ödeme koşullarını onaylıyor musunuz?
            </Text>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <AppButton
              label="Ödeme Şeklini Onayla ve İşi Al"
              accessibilityLabel="Ödeme Şeklini Onayla ve İşi Al"
              icon="checkmark-circle-outline"
              disabled={loading}
              loading={loading}
              onPress={() => onApprove(load)}
              style={styles.approveBtn}
            />
            <AppButton
              label="Reddet"
              accessibilityLabel="Reddet"
              variant="ghost"
              disabled={loading}
              onPress={() => onReject(load)}
              style={styles.rejectBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    ...shadows.floating,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  badgeIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTextWrap: {
    flex: 1,
  },
  badgeTitle: {
    ...typography.captionBold,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  badgeSubtitle: {
    ...typography.smallMedium,
    color: colors.ink,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
  body: {
    flexGrow: 0,
  },
  breakdownBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  rowValuePrimary: {
    ...typography.h2,
    color: colors.ink,
    fontWeight: '700',
  },
  rowValueCash: {
    ...typography.h3,
    color: colors.success,
    fontWeight: '700',
  },
  rowValueCredit: {
    ...typography.h3,
    color: colors.primary,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xxs,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  infoIcon: {
    marginTop: 2,
  },
  infoText: {
    ...typography.caption,
    color: colors.primaryStrong,
    flex: 1,
    lineHeight: 18,
  },
  subNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  approveBtn: {
    borderRadius: radius.pill,
  },
  rejectBtn: {
    borderRadius: radius.pill,
  },
});
