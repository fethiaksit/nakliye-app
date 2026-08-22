import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { AppButton } from './primitives';
import { colors, radius, shadows, spacing, typography } from './theme';

const ToastContext = createContext({ showToast: () => {} });

export function ToastProvider({ children }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const showToast = useCallback((message, options = {}) => {
    clearTimeout(timerRef.current);
    setToast({ message, type: options.type || 'info', title: options.title || '' });
    timerRef.current = setTimeout(() => setToast(null), options.duration || 3200);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const value = useMemo(() => ({ showToast, hideToast: () => setToast(null) }), [showToast]);
  const tone = toast?.type === 'error' ? 'danger' : toast?.type === 'success' ? 'success' : toast?.type === 'warning' ? 'warning' : 'info';
  const icon = tone === 'danger' ? 'alert-circle' : tone === 'success' ? 'checkmark-circle' : tone === 'warning' ? 'warning' : 'information-circle';
  return <ToastContext.Provider value={value}>
    {children}
    {toast ? <Pressable accessibilityRole="alert" onPress={() => setToast(null)} style={[styles.toast, styles[`toast_${tone}`], { top: Math.max(insets.top, spacing.sm) + spacing.xs }]}>
      <Icon name={icon} size={22} color={colors.white} />
      <View style={styles.toastCopy}>{toast.title ? <Text style={styles.toastTitle}>{toast.title}</Text> : null}<Text style={styles.toastText}>{toast.message}</Text></View>
      <Icon name="close" size={18} color="rgba(255,255,255,.82)" />
    </Pressable> : null}
  </ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);

export function ConfirmationModal({ visible, title, message, confirmLabel = 'Onayla', cancelLabel = 'Vazgeç', destructive = false, loading = false, onConfirm, onCancel }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={loading ? undefined : onCancel} />
      <View style={styles.dialog}>
        <View style={[styles.dialogIcon, destructive && styles.dialogIconDanger]}><Icon name={destructive ? 'warning-outline' : 'help-circle-outline'} size={28} color={destructive ? colors.danger : colors.primary} /></View>
        <Text style={styles.dialogTitle}>{title}</Text>
        <Text style={styles.dialogMessage}>{message}</Text>
        <View style={styles.dialogActions}><AppButton label={cancelLabel} variant="outline" compact fullWidth={false} onPress={onCancel} disabled={loading} style={styles.dialogAction} /><AppButton label={confirmLabel} variant={destructive ? 'danger' : 'primary'} compact fullWidth={false} onPress={onConfirm} loading={loading} style={styles.dialogAction} /></View>
      </View>
    </View>
  </Modal>;
}

export function ActionSheet({ visible, title, message, options = [], onClose }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.sheetOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.sheetHeader}><View style={styles.sheetHeaderCopy}><Text style={styles.sheetTitle}>{title}</Text>{message ? <Text style={styles.sheetMessage}>{message}</Text> : null}</View><Pressable hitSlop={10} onPress={onClose}><Icon name="close" size={24} color={colors.textSecondary} /></Pressable></View>
        {options.map((option, index) => <Pressable key={`${option.label}-${index}`} disabled={option.disabled} onPress={() => { onClose?.(); option.onPress?.(); }} style={({ pressed }) => [styles.sheetOption, option.destructive && styles.sheetOptionDanger, option.disabled && styles.disabled, pressed && styles.optionPressed]}>
          <View style={[styles.sheetOptionIcon, option.destructive && styles.sheetOptionIconDanger]}><Icon name={option.icon || 'ellipse-outline'} size={21} color={option.destructive ? colors.danger : colors.primary} /></View>
          <View style={styles.sheetOptionCopy}><Text style={[styles.sheetOptionLabel, option.destructive && styles.sheetOptionLabelDanger]}>{option.label}</Text>{option.description ? <Text style={styles.sheetOptionDescription}>{option.description}</Text> : null}</View>
          <Icon name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>)}
        <AppButton label="Vazgeç" variant="ghost" onPress={onClose} style={styles.sheetCancel} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  toast: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, left: spacing.md, minHeight: 58, padding: spacing.md, position: 'absolute', right: spacing.md, zIndex: 999, ...shadows.floating }, toast_info: { backgroundColor: colors.info }, toast_success: { backgroundColor: colors.success }, toast_warning: { backgroundColor: colors.warning }, toast_danger: { backgroundColor: colors.danger }, toastCopy: { flex: 1 }, toastTitle: { ...typography.smallMedium, color: colors.white }, toastText: { ...typography.small, color: colors.white },
  overlay: { alignItems: 'center', backgroundColor: colors.overlay, flex: 1, justifyContent: 'center', padding: spacing.xl }, dialog: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.xl, maxWidth: 420, padding: spacing.xl, width: '100%', ...shadows.floating }, dialogIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 }, dialogIconDanger: { backgroundColor: colors.dangerSoft }, dialogTitle: { ...typography.h2, color: colors.ink, marginTop: spacing.md, textAlign: 'center' }, dialogMessage: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, dialogActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, width: '100%' }, dialogAction: { flex: 1 },
  sheetOverlay: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: spacing.xl, paddingHorizontal: spacing.md, ...shadows.floating }, handle: { alignSelf: 'center', backgroundColor: colors.borderStrong, borderRadius: radius.pill, height: 5, marginBottom: spacing.md, marginTop: spacing.sm, width: 44 }, sheetHeader: { alignItems: 'flex-start', flexDirection: 'row', paddingHorizontal: spacing.xs, paddingBottom: spacing.md }, sheetHeaderCopy: { flex: 1 }, sheetTitle: { ...typography.h2, color: colors.ink }, sheetMessage: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xxs }, sheetOption: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 66, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm }, sheetOptionDanger: { backgroundColor: '#FFFBFA' }, sheetOptionIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 40, justifyContent: 'center', marginRight: spacing.sm, width: 40 }, sheetOptionIconDanger: { backgroundColor: colors.dangerSoft }, sheetOptionCopy: { flex: 1 }, sheetOptionLabel: { ...typography.bodyMedium, color: colors.ink }, sheetOptionLabelDanger: { color: colors.danger }, sheetOptionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs }, disabled: { opacity: .45 }, optionPressed: { opacity: .65 }, sheetCancel: { marginTop: spacing.xs },
});
