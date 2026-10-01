import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CARGO_TYPE_OPTIONS } from '../../../../shared/loadMetadata';
import Icon from '../../../../shared/ui/Icon';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import { TextField } from '../../../../shared/ui/primitives';

export default function CargoTypeStep({ form, onChange, errors = {} }) {
  const selectedType = form.cargoType;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Taşınacak yükün türü nedir?</Text>
      <Text style={styles.subtitle}>Yük türünüze göre taşıma koşulları ve araç gereksinimleri belirlenir.</Text>

      {errors.cargoType ? (
        <View style={styles.errorBanner}>
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{errors.cargoType}</Text>
        </View>
      ) : null}

      <View style={styles.grid}>
        {CARGO_TYPE_OPTIONS.map(option => {
          const isSelected = selectedType === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.card,
                isSelected && styles.cardSelected,
              ]}
              onPress={() => onChange('cargoType', option.value)}
            >
              <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                <Icon
                  name={option.icon || 'cube-outline'}
                  size={26}
                  color={isSelected ? colors.white : colors.primary}
                />
              </View>
              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, isSelected && styles.cardTitleSelected]}>
                    {option.label}
                  </Text>
                  {isSelected && (
                    <View style={styles.checkBadge}>
                      <Icon name="checkmark" size={14} color={colors.white} />
                    </View>
                  )}
                </View>
                <Text style={[styles.cardDesc, isSelected && styles.cardDescSelected]} numberOfLines={2}>
                  {option.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {selectedType === 'diger' && (
        <View style={styles.otherInputWrap}>
          <TextField
            label="Diğer Yük Türü Açıklaması"
            required
            value={form.cargoTypeNote || ''}
            onChangeText={value => onChange('cargoTypeNote', value)}
            placeholder="Taşınacak yükü kısaca açıklayın (örn. Piyano, Sanat eseri)"
            leftIcon="create-outline"
            error={errors.cargoTypeNote}
          />
        </View>
      )}
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
  errorBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  errorText: {
    ...typography.small,
    color: colors.danger,
    flex: 1,
  },
  grid: {
    gap: spacing.sm,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    padding: spacing.md,
    ...shadows.card,
  },
  cardSelected: {
    backgroundColor: '#F0FDF8',
    borderColor: colors.primary,
    borderWidth: 2,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 48,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 48,
  },
  iconWrapSelected: {
    backgroundColor: colors.primary,
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  cardTitleSelected: {
    color: colors.primaryDark,
  },
  cardDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  cardDescSelected: {
    color: colors.text,
  },
  checkBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  otherInputWrap: {
    marginTop: spacing.md,
  },
});
