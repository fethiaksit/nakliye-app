import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import Icon from './Icon';
import { AppButton } from './primitives';
import { colors, control, radius, spacing, typography } from './theme';

const { asValidDate, clampToMinimum, formatPickerValue, pickerValueForOpen } = require('./datePicker.cjs');

export default function DatePickerField({
  label,
  required = false,
  mode = 'date',
  value,
  onChange,
  minimumDate,
  error,
  helper,
  disabled = false,
  placeholder,
  testID,
}) {
  const selectedValue = asValidDate(value);
  const minimumValue = asValidDate(minimumDate);
  const selectedTimestamp = selectedValue?.getTime();
  const minimumTimestamp = minimumValue?.getTime();
  const initialValue = useMemo(
    () => pickerValueForOpen(mode, selectedValue, minimumValue),
    [minimumTimestamp, mode, selectedTimestamp],
  );
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(initialValue);

  const openPicker = useCallback(() => {
    if (disabled) return;
    setDraft(pickerValueForOpen(mode, selectedValue, minimumValue));
    setVisible(true);
  }, [disabled, minimumTimestamp, mode, selectedTimestamp]);

  const closePicker = useCallback(() => setVisible(false), []);

  const confirmIOS = useCallback(() => {
    const confirmed = clampToMinimum(draft, minimumValue);
    onChange?.(confirmed);
    setVisible(false);
  }, [draft, minimumTimestamp, onChange]);

  const handleAndroidChange = useCallback((event, nextValue) => {
    setVisible(false);
    if (event.type !== 'set' || !nextValue) return;
    onChange?.(clampToMinimum(nextValue, minimumValue));
  }, [minimumTimestamp, onChange]);

  const handleIOSChange = useCallback((event, nextValue) => {
    if (event.type === 'set' && nextValue) setDraft(clampToMinimum(nextValue, minimumValue));
  }, [minimumTimestamp]);

  const displayValue = selectedValue ? formatPickerValue(mode, selectedValue) : '';
  const resolvedPlaceholder = placeholder || (mode === 'date' ? 'Tarih seçin' : 'Saat seçin');

  return <View style={styles.field}>
    <Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text>
    <TouchableOpacity
      activeOpacity={0.72}
      accessibilityHint={mode === 'date' ? 'Takvim seçicisini açar' : 'Saat seçicisini açar'}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityValue={{ text: displayValue || resolvedPlaceholder }}
      disabled={disabled}
      onPress={openPicker}
      testID={testID || `date-picker-${mode}`}
      style={[styles.trigger, selectedValue && styles.triggerSelected, error && styles.triggerError, disabled && styles.disabled]}
    >
      <Icon name={mode === 'date' ? 'calendar-outline' : 'time-outline'} size={20} color={selectedValue ? colors.primary : colors.textMuted} />
      <Text numberOfLines={1} style={[styles.value, !selectedValue && styles.placeholder]}>{displayValue || resolvedPlaceholder}</Text>
      <Icon name="chevron-forward" size={19} color={colors.textMuted} />
    </TouchableOpacity>
    {error ? <View style={styles.feedback}><Icon name="alert-circle" size={15} color={colors.danger} /><Text style={styles.error}>{error}</Text></View> : helper ? <Text style={styles.helper}>{helper}</Text> : null}

    {Platform.OS === 'android' && visible ? <DateTimePicker
      value={initialValue}
      mode={mode}
      display="default"
      minimumDate={minimumValue || undefined}
      is24Hour
      onChange={handleAndroidChange}
    /> : null}

    {Platform.OS === 'ios' && visible ? <Modal
      visible
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={closePicker}
    >
      <View style={styles.overlay}>
        <View accessibilityElementsHidden pointerEvents="none" style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, styles.darkSheet]}>
          <View style={[styles.handle, styles.darkHandle]} />
          <View style={styles.header}>
            <Text style={[styles.title, styles.darkTitle]}>{mode === 'date' ? 'Nakliye tarihini seçin' : 'Nakliye saatini seçin'}</Text>
          </View>
          <DateTimePicker
            value={draft}
            mode={mode}
            display={mode === 'date' ? 'inline' : 'spinner'}
            minimumDate={minimumValue || undefined}
            is24Hour
            locale="tr-TR"
            themeVariant="dark"
            accentColor="#55D6BE"
            textColor={colors.white}
            onChange={handleIOSChange}
            style={[styles.picker, mode === 'date' ? styles.datePicker : styles.timePicker]}
            testID={`${testID || `date-picker-${mode}`}-native`}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.72}
              onPress={closePicker}
              style={[styles.cancelAction, styles.action]}
            >
              <Text style={styles.cancelActionText}>İptal</Text>
            </TouchableOpacity>
            <AppButton label="Tamam" icon="checkmark" compact fullWidth={false} style={styles.action} onPress={confirmIOS} />
          </View>
        </View>
      </View>
    </Modal> : null}
  </View>;
}

const styles = StyleSheet.create({
  field: { flex: 1, marginTop: spacing.md },
  label: { ...typography.smallMedium, color: colors.text, marginBottom: spacing.xs },
  required: { color: colors.danger },
  trigger: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: control.inputHeight, paddingHorizontal: spacing.md },
  triggerSelected: { borderColor: '#94BDB4' },
  triggerError: { borderColor: colors.danger },
  disabled: { opacity: .48 },
  value: { ...typography.body, color: colors.ink, flex: 1 },
  placeholder: { color: colors.textMuted },
  feedback: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xs },
  error: { ...typography.caption, color: colors.danger, flex: 1 },
  helper: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  overlay: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.md, paddingBottom: spacing.xxl },
  darkSheet: { backgroundColor: '#0B1018' },
  handle: { alignSelf: 'center', backgroundColor: colors.borderStrong, borderRadius: radius.pill, height: 5, marginBottom: spacing.md, width: 44 },
  darkHandle: { backgroundColor: '#506072' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { ...typography.h2, color: colors.ink },
  darkTitle: { color: colors.white },
  picker: { alignSelf: 'stretch' },
  datePicker: { backgroundColor: '#0B1018', height: 340, width: '100%' },
  timePicker: { backgroundColor: '#0B1018', height: 216, width: '100%' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  cancelAction: { alignItems: 'center', backgroundColor: '#172331', borderColor: '#344153', borderRadius: radius.sm, borderWidth: 1, height: 42, justifyContent: 'center' },
  cancelActionText: { ...typography.button, color: '#E7EEF6' },
});
