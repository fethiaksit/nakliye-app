import React, { useEffect, useState } from 'react';
import { driverWallet, apiError } from '../../services/api';
import { parseWalletUnits, formatWalletCents } from '../../../../shared/walletMoney.mjs';
import { StyleSheet, Text, View } from 'react-native';

import Icon from '../../../../shared/ui/Icon';
import { AppButton, TextField } from '../../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../../shared/ui/theme';

export default function DriverOfferForm({
  form,
  setForm,
  formErrors,
  setFormErrors,
  onAdjust,
  saving,
  onSaveOffer,
  isEdit = false,
}) {
  const [wallet, setWallet] = useState(null);
  const [walletError, setWalletError] = useState('');
  useEffect(() => {
    let active = true;
    driverWallet.get().then(({ data }) => { if (active) setWallet(data.wallet); })
      .catch(error => { if (active) setWalletError(apiError(error)); });
    return () => { active = false; };
  }, []);
  const amountCents = parseWalletUnits(form.amount);
  const commissionCents = amountCents > 0 ? Math.floor(amountCents / 10 + 0.5) : 0;
  const setField = (field, value) => {
    setForm(current => ({ ...current, [field]: value }));
    setFormErrors(current => ({ ...current, [field]: '' }));
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Icon name="pricetag-outline" size={20} color={colors.primary} />
        </View>
        <View>
          <Text style={styles.headerTitle}>{isEdit ? 'Teklifi Düzenle' : 'Teklif Ver'}</Text>
          <Text style={styles.headerSubtitle}>Fiyat ve varış süresini belirleyin.</Text>
        </View>
      </View>

      <View style={styles.formBody}>
        <Text style={styles.label}>Teklifiniz (TL)</Text>
        <View style={styles.adjustRow}>
          <AppButton
            label="−100 TL"
            variant="secondary"
            compact
            fullWidth={false}
            onPress={() => onAdjust(-100)}
            style={styles.adjustBtn}
          />
          <TextField
            containerStyle={styles.amountField}
            value={form.amount}
            onChangeText={value => setField('amount', value)}
            keyboardType="decimal-pad"
            inputStyle={styles.amountInput}
            error={formErrors?.amount}
            placeholder="0"
          />
          <AppButton
            label="+100 TL"
            variant="secondary"
            compact
            fullWidth={false}
            onPress={() => onAdjust(100)}
            style={styles.adjustBtn}
          />
        </View>

        <View style={{ marginVertical: spacing.sm }}>
          <Text style={styles.label}>Hizmet bedeli (%10): {formatWalletCents(commissionCents)}</Text>
          <Text style={styles.headerSubtitle}>İş tamamlandığında %10 hizmet bedeli alınır. Teklif verirken hesabınızdan ücret alınmaz. Teklif kabul edilince hizmet bedeli bloke edilir.</Text>
          {wallet ? <Text style={styles.label}>Kullanılabilir bakiye: {formatWalletCents(wallet.availableCents)}</Text> : <Text style={styles.headerSubtitle}>{walletError || 'Bakiye yükleniyor…'}</Text>}
          {wallet && wallet.availableCents < commissionCents ? <Text style={{ color: colors.danger }}>Bu teklif için en az {formatWalletCents(commissionCents)} kullanılabilir bakiye gerekiyor.</Text> : null}
        </View>
        <TextField
          label="Tahmini Varış Süresi"
          required
          value={form.eta}
          onChangeText={value => setField('eta', value)}
          keyboardType="number-pad"
          placeholder="Örn: 45 dakika"
          leftIcon="time-outline"
          error={formErrors?.eta}
        />

        <TextField
          label="Müşteriye Not (Opsiyonel)"
          value={form.note}
          onChangeText={value => setField('note', value)}
          placeholder="Örn: 30 dakika içinde yüklemeye gelebilirim."
          multiline
          numberOfLines={2}
          maxLength={400}
        />

        <AppButton
          label={saving ? 'Teklif Gönderiliyor…' : isEdit ? 'Teklifi Güncelle' : 'Teklifi Gönder'}
          icon="send-outline"
          loading={saving}
          onPress={onSaveOffer}
          style={styles.submitButton}
        />
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
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  formBody: {
    marginTop: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  adjustRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  adjustBtn: {
    minHeight: 46,
  },
  amountField: {
    flex: 1,
    marginTop: 0,
  },
  amountInput: {
    ...typography.h2,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  submitButton: {
    marginTop: spacing.sm,
  },
});
