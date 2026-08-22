import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { AppButton, ScreenState } from './primitives';
import { colors, control, radius, shadows, spacing, typography } from './theme';

export default function SearchableSelect({ label, required = false, helper, error, value, options = [], onChange, placeholder = 'Seçim yapın', searchPlaceholder = 'Ara', clearable = true, loading = false, loadError = '', disabled = false }) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(option => option.value === value);
  useEffect(() => { if (!visible) setQuery(''); }, [visible]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    return needle ? options.filter(option => `${option.label} ${option.description || ''}`.toLocaleLowerCase('tr-TR').includes(needle)) : options;
  }, [options, query]);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: visible, disabled }} disabled={disabled} onPress={() => setVisible(true)} style={[styles.trigger, error && styles.triggerError, selected && styles.triggerSelected, disabled && styles.disabled]}>
      <View style={styles.triggerIcon}><Icon name="search-outline" size={19} color={selected ? colors.primary : colors.textMuted} /></View>
      <Text style={[styles.triggerText, !selected && styles.placeholder]} numberOfLines={1}>{selected?.label || placeholder}</Text>
      {selected && clearable ? <Pressable accessibilityLabel="Seçimi temizle" hitSlop={10} onPress={event => { event.stopPropagation?.(); onChange(''); }}><Icon name="close-circle" size={20} color={colors.textMuted} /></Pressable> : <Icon name="chevron-down" size={20} color={colors.textMuted} />}
    </Pressable>
    {error ? <View style={styles.feedback}><Icon name="alert-circle" size={15} color={colors.danger} /><Text style={styles.error}>{error}</Text></View> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} /><View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.handle} />
        <View style={styles.header}><View><Text style={styles.title}>{label}</Text><Text style={styles.subtitle}>{selected ? `Seçili: ${selected.label}` : 'Listeden bir seçenek belirleyin'}</Text></View><Pressable hitSlop={10} onPress={() => setVisible(false)}><Icon name="close" size={25} color={colors.textSecondary} /></Pressable></View>
        <View style={styles.search}><Icon name="search" size={20} color={colors.textMuted} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder={searchPlaceholder} placeholderTextColor={colors.textMuted} selectionColor={colors.primary} style={styles.searchInput} returnKeyType="search" />{query ? <Pressable hitSlop={8} onPress={() => setQuery('')}><Icon name="close-circle" size={20} color={colors.textMuted} /></Pressable> : null}</View>
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Seçenekler yükleniyor…</Text></View> : loadError ? <ScreenState compact type="error" title="Seçenekler yüklenemedi" message={loadError} /> : <FlatList keyboardShouldPersistTaps="handled" data={filtered} keyExtractor={item => String(item.value)} contentContainerStyle={styles.list} ListEmptyComponent={<ScreenState compact title="Sonuç bulunamadı" message="Aramanızı değiştirerek tekrar deneyin." />} renderItem={({ item }) => {
          const active = item.value === value;
          return <Pressable onPress={() => { onChange(item.value); setVisible(false); }} style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.optionPressed]}><View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View><View style={styles.optionCopy}><Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{item.label}</Text>{item.description ? <Text style={styles.optionDescription}>{item.description}</Text> : null}</View>{active ? <Icon name="checkmark-circle" size={22} color={colors.primary} /> : null}</Pressable>;
        }} />}
        {selected && clearable ? <AppButton label="Seçimi temizle" icon="trash-outline" variant="ghost" onPress={() => { onChange(''); setVisible(false); }} /> : null}
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  field: { marginTop: spacing.md }, label: { ...typography.smallMedium, color: colors.text, marginBottom: spacing.xs }, required: { color: colors.danger }, trigger: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: control.inputHeight, paddingHorizontal: spacing.md }, triggerError: { borderColor: colors.danger }, triggerSelected: { borderColor: '#94BDB4' }, triggerIcon: { marginRight: spacing.sm }, triggerText: { ...typography.body, color: colors.ink, flex: 1 }, placeholder: { color: colors.textMuted }, disabled: { opacity: .5 }, feedback: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xs }, error: { ...typography.caption, color: colors.danger }, helper: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  overlay: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '86%', minHeight: '54%', paddingHorizontal: spacing.md, ...shadows.floating }, handle: { alignSelf: 'center', backgroundColor: colors.borderStrong, borderRadius: radius.pill, height: 5, marginVertical: spacing.sm, width: 44 }, header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.md, paddingHorizontal: spacing.xxs }, title: { ...typography.h2, color: colors.ink }, subtitle: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xxs }, search: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 50, paddingHorizontal: spacing.md }, searchInput: { ...typography.body, color: colors.ink, flex: 1, marginHorizontal: spacing.sm, padding: 0 }, list: { flexGrow: 1, paddingVertical: spacing.sm }, option: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 62, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm }, optionActive: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, borderBottomWidth: 0, marginVertical: 2 }, optionPressed: { opacity: .65 }, radio: { alignItems: 'center', borderColor: colors.borderStrong, borderRadius: 10, borderWidth: 1.5, height: 20, justifyContent: 'center', marginRight: spacing.sm, width: 20 }, radioActive: { borderColor: colors.primary }, radioDot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, width: 10 }, optionCopy: { flex: 1 }, optionLabel: { ...typography.bodyMedium, color: colors.ink }, optionLabelActive: { color: colors.primaryDark }, optionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs }, loading: { alignItems: 'center', flex: 1, justifyContent: 'center' }, loadingText: { ...typography.small, color: colors.textSecondary, marginTop: spacing.sm },
});
