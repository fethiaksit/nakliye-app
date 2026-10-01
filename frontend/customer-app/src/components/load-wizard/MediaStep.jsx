import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { VEHICLE_TYPE_OPTIONS, vehicleTypeLabel } from '../../../../shared/loadMetadata';
import Icon from '../../../../shared/ui/Icon';
import SearchableSelect from '../../../../shared/ui/SearchableSelect';
import { TextField } from '../../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import LoadPhotoPicker from '../LoadPhotoPicker';

export default function MediaStep({ form, onChange, photos, setPhotos, errors = {} }) {
  const isCustomVehicle = form.vehicleType && form.vehicleType !== 'farketmez';
  const [customVehicleEnabled, setCustomVehicleEnabled] = useState(Boolean(isCustomVehicle));

  const handleToggleCustomVehicle = enabled => {
    setCustomVehicleEnabled(enabled);
    if (!enabled) {
      onChange('vehicleType', 'farketmez');
    } else if (form.vehicleType === 'farketmez' || !form.vehicleType) {
      onChange('vehicleType', 'kamyonet');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fotoğraf ve Araç Tercihi</Text>
      <Text style={styles.subtitle}>Şoförlerin yükünüzü net anlaması için fotoğraf ve detay notları ekleyin.</Text>

      {/* Fotoğraf Yükleme */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Icon name="camera-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>Yük Fotoğrafları (İsteğe Bağlı)</Text>
        </View>
        <Text style={styles.sectionDesc}>
          Fotoğraf eklemek doğru araç ve fiyat teklifleri almanızı kolaylaştırır.
        </Text>
        <LoadPhotoPicker photos={photos} onChange={setPhotos} error={errors.photos} />
      </View>

      {/* Taşıma Notu / Açıklama */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Icon name="document-text-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>Açıklama ve Özel Notlar</Text>
        </View>
        <TextField
          label="Şoföre Notlar"
          value={form.description || ''}
          onChangeText={value => onChange('description', value)}
          placeholder="Örn: Hassas eşyalar kutulandı, bina kapısında rampa var, giriş için site güvenliğine haber verildi..."
          multiline
          maxLength={1200}
          error={errors.description}
        />
      </View>

      {/* Araç Tercihi */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Icon name="car-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>Araç Tercihi</Text>
        </View>
        
        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchLabel}>
              {customVehicleEnabled ? 'Özel araç tipi seçiyorum' : 'Uygun aracı sistem önersin'}
            </Text>
            <Text style={styles.switchSub}>
              {customVehicleEnabled
                ? 'Seçtiğiniz araç tipine sahip şoförler teklif verecektir.'
                : 'Yük ölçülerinize ve türünüze en uygun araçlar otomatik eşleştirilir (Önerilen).'}
            </Text>
          </View>
          <Switch
            value={customVehicleEnabled}
            onValueChange={handleToggleCustomVehicle}
            trackColor={{ false: colors.borderDark, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>

        {customVehicleEnabled ? (
          <View style={styles.vehicleSelectWrap}>
            <SearchableSelect
              label="İstenen Araç Türü"
              required
              value={form.vehicleType}
              options={VEHICLE_TYPE_OPTIONS}
              onChange={value => onChange('vehicleType', value)}
              searchPlaceholder="Araç türünde ara"
              clearable={false}
              error={errors.vehicleType}
            />
          </View>
        ) : (
          <View style={styles.autoVehicleBadge}>
            <Icon name="sparkles" size={16} color={colors.primary} />
            <Text style={styles.autoVehicleText}>
              Akıllı eşleştirme: Yükünüz panelvan, kamyonet veya kamyon ile taşınabilir.
            </Text>
          </View>
        )}
      </View>
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
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
    ...shadows.card,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.ink,
  },
  sectionDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  switchTextWrap: {
    flex: 1,
    paddingRight: spacing.md,
  },
  switchLabel: {
    ...typography.h4,
    color: colors.ink,
  },
  switchSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  vehicleSelectWrap: {
    marginTop: spacing.md,
  },
  autoVehicleBadge: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  autoVehicleText: {
    ...typography.caption,
    color: colors.primaryDark,
    flex: 1,
    fontWeight: '500',
  },
});
