import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LOAD_TIMING_OPTIONS } from '../../../../shared/loadMetadata';
import DatePickerField from '../../../../shared/ui/DatePickerField';
import Icon from '../../../../shared/ui/Icon';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';

const timingCards = [
  {
    value: 'immediate',
    title: 'Hemen (Acil)',
    description: 'En kısa sürede uygun şoför atanır ve yola çıkar.',
    icon: 'flash',
    accentColor: '#E07A5F',
  },
  {
    value: 'today',
    title: 'Bugün İçinde',
    description: 'Günün uygun bir saatinde taşıma organize edilir.',
    icon: 'sunny',
    accentColor: '#F4A261',
  },
  {
    value: 'scheduled',
    title: 'İleri Tarihli Planlı',
    description: 'Belirleyeceğiniz gün ve saatte rezervasyon yapılır.',
    icon: 'calendar',
    accentColor: colors.primary,
  },
];

const dateFromKey = key => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
};

const timeFromKey = (key, dateKey) => {
  const match = /^(\d{2}):(\d{2})$/.exec(key || '');
  if (!match) return null;
  const base = dateFromKey(dateKey) || new Date();
  base.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return base;
};

const toDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const toTimeKey = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const minimumDate = () => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; };
const minimumTimeForDate = key => key === toDateKey(new Date()) ? new Date() : undefined;

export default function ScheduleStep({ form, onChange, errors = {} }) {
  const selectedTiming = form.urgencyType || 'immediate';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Taşıma ne zaman yapılacak?</Text>
      <Text style={styles.subtitle}>İhtiyacınıza uygun zaman planlamasını seçin.</Text>

      {errors.urgencyType ? (
        <View style={styles.errorBanner}>
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{errors.urgencyType}</Text>
        </View>
      ) : null}

      <View style={styles.cardList}>
        {timingCards.map(card => {
          const isSelected = selectedTiming === card.value;
          return (
            <Pressable
              key={card.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.card,
                isSelected && styles.cardSelected,
              ]}
              onPress={() => {
                onChange('urgencyType', card.value);
                if (card.value === 'today') {
                  onChange('scheduledDate', toDateKey(new Date()));
                }
              }}
            >
              <View style={[styles.iconWrap, isSelected && { backgroundColor: card.accentColor }]}>
                <Icon
                  name={card.icon}
                  size={24}
                  color={isSelected ? colors.white : card.accentColor}
                />
              </View>

              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, isSelected && styles.cardTitleSelected]}>
                    {card.title}
                  </Text>
                  {isSelected && (
                    <View style={styles.checkBadge}>
                      <Icon name="checkmark" size={14} color={colors.white} />
                    </View>
                  )}
                </View>
                <Text style={[styles.cardDesc, isSelected && styles.cardDescSelected]}>
                  {card.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {selectedTiming === 'scheduled' && (
        <View style={styles.datePickerContainer}>
          <Text style={styles.sectionHeading}>Tarih ve Saat Seçimi</Text>
          <View style={styles.datePickerRow}>
            <View style={styles.flexPicker}>
              <DatePickerField
                testID="scheduled-date"
                label="Taşıma Tarihi"
                required
                mode="date"
                value={dateFromKey(form.scheduledDate)}
                minimumDate={minimumDate()}
                onChange={value => onChange('scheduledDate', value ? toDateKey(value) : '')}
                error={errors.scheduledDate}
              />
            </View>
            <View style={styles.flexPicker}>
              <DatePickerField
                testID="scheduled-time"
                label="Taşıma Saati"
                required
                mode="time"
                value={timeFromKey(form.scheduledTime, form.scheduledDate)}
                minimumDate={minimumTimeForDate(form.scheduledDate)}
                onChange={value => onChange('scheduledTime', value ? toTimeKey(value) : '')}
                error={errors.scheduledTime}
              />
            </View>
          </View>
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
  cardList: {
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
  datePickerContainer: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  sectionHeading: {
    ...typography.h4,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexPicker: {
    flex: 1,
  },
});
