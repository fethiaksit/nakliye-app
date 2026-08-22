import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Icon from './Icon';
import { colors, control, radius, shadows, spacing, typography } from './theme';

const toneColors = {
  neutral: colors.textSecondary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  primary: colors.primaryDark,
};

export function AppButton({ label, onPress, variant = 'primary', icon, loading = false, disabled = false, compact = false, fullWidth = true, style }) {
  const inactive = disabled || loading;
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ disabled: inactive, busy: loading }}
    disabled={inactive}
    onPress={onPress}
    style={({ pressed }) => [styles.button, styles[`button_${variant}`], compact && styles.buttonCompact, fullWidth && styles.fullWidth, inactive && styles.disabled, pressed && !inactive && styles.pressed, style]}
  >
    {loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? colors.white : colors.primary} /> : <>
      {icon ? <Icon name={icon} size={compact ? 17 : 19} color={variant === 'primary' || variant === 'danger' ? colors.white : variant === 'outlineDanger' ? colors.danger : colors.primary} /> : null}
      <Text style={[styles.buttonLabel, styles[`buttonLabel_${variant}`]]}>{label}</Text>
    </>}
  </Pressable>;
}

export function IconButton({ icon, onPress, label, variant = 'ghost', disabled = false, size = control.iconButton, iconSize = 22, style }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} hitSlop={8} onPress={onPress} style={({ pressed }) => [styles.iconButton, styles[`iconButton_${variant}`], { height: size, width: size, borderRadius: size / 2 }, disabled && styles.disabled, pressed && styles.pressed, style]}>
    <Icon name={icon} size={iconSize} color={variant === 'primary' ? colors.white : variant === 'danger' ? colors.danger : colors.text} />
  </Pressable>;
}

export function TextField({ label, required = false, helper, error, success = false, leftIcon, rightAction, disabled = false, containerStyle, inputStyle, multiline = false, inputRef, ...props }) {
  const [focused, setFocused] = useState(false);
  return <View style={[styles.field, containerStyle]}>
    {label ? <View style={styles.labelRow}><Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text>{success && !error ? <Icon name="checkmark-circle" size={17} color={colors.success} /> : null}</View> : null}
    <View style={[styles.inputFrame, multiline && styles.inputFrameMultiline, focused && styles.inputFocused, error && styles.inputError, success && !error && styles.inputSuccess, disabled && styles.inputDisabled]}>
      {leftIcon ? <Icon name={leftIcon} size={20} color={focused ? colors.primary : colors.textMuted} style={styles.leftIcon} /> : null}
      <TextInput
        {...props}
        ref={inputRef}
        editable={!disabled}
        multiline={multiline}
        onBlur={event => { setFocused(false); props.onBlur?.(event); }}
        onFocus={event => { setFocused(true); props.onFocus?.(event); }}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        style={[styles.textInput, multiline && styles.textInputMultiline, inputStyle]}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {rightAction}
    </View>
    {error ? <View style={styles.feedbackRow}><Icon name="alert-circle" size={15} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : helper ? <Text style={styles.helperText}>{helper}</Text> : null}
  </View>;
}

export function SectionCard({ title, description, icon, children, style, action }) {
  return <View style={[styles.card, style]}>
    {(title || action) ? <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleWrap}>{icon ? <View style={styles.sectionIcon}><Icon name={icon} size={20} color={colors.primary} /></View> : null}<View style={styles.sectionCopy}><Text style={styles.sectionTitle}>{title}</Text>{description ? <Text style={styles.sectionDescription}>{description}</Text> : null}</View></View>
      {action}
    </View> : null}
    {children}
  </View>;
}

export function Badge({ label, tone = 'neutral', icon }) {
  return <View style={[styles.badge, styles[`badge_${tone}`]]}>{icon ? <Icon name={icon} size={13} color={toneColors[tone] || toneColors.neutral} /> : null}<Text style={[styles.badgeText, styles[`badgeText_${tone}`]]}>{label}</Text></View>;
}

export function InlineNotice({ title, message, tone = 'info', actionLabel, onAction }) {
  const icon = tone === 'danger' ? 'alert-circle' : tone === 'success' ? 'checkmark-circle' : tone === 'warning' ? 'warning' : 'information-circle';
  return <View style={[styles.notice, styles[`notice_${tone}`]]}><Icon name={icon} size={20} color={toneColors[tone] || toneColors.info} /><View style={styles.noticeCopy}>{title ? <Text style={[styles.noticeTitle, styles[`noticeText_${tone}`]]}>{title}</Text> : null}<Text style={[styles.noticeMessage, styles[`noticeText_${tone}`]]}>{message}</Text></View>{actionLabel ? <Pressable onPress={onAction}><Text style={[styles.noticeAction, styles[`noticeText_${tone}`]]}>{actionLabel}</Text></Pressable> : null}</View>;
}

export function Skeleton({ width = '100%', height = 16, radius: skeletonRadius = radius.sm, style }) {
  const opacity = useRef(new Animated.Value(0.38)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.72, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.38, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, { width, height, borderRadius: skeletonRadius, opacity }, style]} />;
}

export function ListSkeleton({ count = 3 }) {
  return <View>{Array.from({ length: count }, (_, index) => <View key={index} style={styles.skeletonCard}><Skeleton width={52} height={52} radius={radius.md} /><View style={styles.skeletonCopy}><Skeleton width="42%" /><Skeleton width="86%" height={12} style={styles.skeletonLine} /><Skeleton width="64%" height={12} style={styles.skeletonLine} /></View></View>)}</View>;
}

export function ScreenState({ type = 'empty', title, message, onRetry, compact = false }) {
  const icon = type === 'error' ? 'cloud-offline-outline' : type === 'connection' ? 'wifi-outline' : 'file-tray-outline';
  return <View style={[styles.state, compact && styles.stateCompact]}><View style={[styles.stateIcon, type === 'error' && styles.stateIconDanger]}><Icon name={icon} size={28} color={type === 'error' ? colors.danger : colors.primary} /></View><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateMessage}>{message}</Text>{onRetry ? <AppButton label="Tekrar dene" icon="refresh" variant="secondary" compact fullWidth={false} onPress={onRetry} style={styles.stateButton} /> : null}</View>;
}

export function Divider({ style }) { return <View style={[styles.divider, style]} />; }

export function SegmentedControl({ label, options, value, onChange, error, columns }) {
  return <View style={styles.segmentField}>{label ? <Text style={styles.label}>{label}</Text> : null}<View style={[styles.segments, columns && { flexWrap: 'wrap' }]}>{options.map(option => {
    const active = option.value === value;
    return <Pressable key={String(option.value)} accessibilityLabel={option.label} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.segment, columns && { flexBasis: `${Math.floor(100 / columns) - 2}%` }, active && styles.segmentActive, pressed && styles.pressed]}>{option.icon ? <Icon name={option.icon} size={18} color={active ? colors.white : colors.textSecondary} /> : null}<Text numberOfLines={1} style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>{active && !option.icon ? <Icon name="checkmark-circle" size={17} color={colors.white} /> : null}</Pressable>;
  })}</View>{error ? <View style={styles.feedbackRow}><Icon name="alert-circle" size={15} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}</View>;
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, height: control.buttonHeight, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.sm },
  fullWidth: { width: '100%' }, buttonCompact: { height: 42, paddingHorizontal: spacing.md },
  button_primary: { backgroundColor: colors.primary }, button_secondary: { backgroundColor: colors.primarySoft }, button_outline: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 }, button_danger: { backgroundColor: colors.danger }, button_outlineDanger: { backgroundColor: colors.surface, borderColor: '#E7B6B2', borderWidth: 1 }, button_ghost: { backgroundColor: 'transparent' },
  buttonLabel: typography.button, buttonLabel_primary: { color: colors.white }, buttonLabel_secondary: { color: colors.primaryDark }, buttonLabel_outline: { color: colors.text }, buttonLabel_danger: { color: colors.white }, buttonLabel_outlineDanger: { color: colors.danger }, buttonLabel_ghost: { color: colors.primary },
  disabled: { opacity: 0.48 }, pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  iconButton: { alignItems: 'center', justifyContent: 'center' }, iconButton_ghost: { backgroundColor: colors.surfaceMuted }, iconButton_outline: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }, iconButton_primary: { backgroundColor: colors.primary }, iconButton_danger: { backgroundColor: colors.dangerSoft },
  field: { marginTop: spacing.md }, labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }, label: { ...typography.smallMedium, color: colors.text }, required: { color: colors.danger },
  inputFrame: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: control.inputHeight, paddingHorizontal: spacing.md }, inputFrameMultiline: { alignItems: 'flex-start', minHeight: 104, paddingVertical: spacing.sm }, inputFocused: { borderColor: colors.primary, borderWidth: 1.5 }, inputError: { borderColor: colors.danger }, inputSuccess: { borderColor: '#83B9AA' }, inputDisabled: { backgroundColor: colors.surfaceStrong, opacity: 0.72 }, leftIcon: { marginRight: spacing.sm }, textInput: { ...typography.body, color: colors.ink, flex: 1, height: control.inputHeight, padding: 0 }, textInputMultiline: { height: 'auto', minHeight: 78 },
  feedbackRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xs }, errorText: { ...typography.caption, color: colors.danger, flex: 1 }, helperText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderColor: '#E6EBF0', borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.lg, ...shadows.card }, sectionHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }, sectionTitleWrap: { flex: 1, flexDirection: 'row' }, sectionIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginRight: spacing.sm, width: 38 }, sectionCopy: { flex: 1 }, sectionTitle: { ...typography.h3, color: colors.ink }, sectionDescription: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xxs },
  badge: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: radius.pill, flexDirection: 'row', gap: spacing.xxs, paddingHorizontal: 9, paddingVertical: 5 }, badge_neutral: { backgroundColor: colors.surfaceStrong }, badge_success: { backgroundColor: colors.successSoft }, badge_warning: { backgroundColor: colors.warningSoft }, badge_danger: { backgroundColor: colors.dangerSoft }, badge_info: { backgroundColor: colors.infoSoft }, badge_primary: { backgroundColor: colors.primarySoft }, badgeText: typography.caption, badgeText_neutral: { color: colors.textSecondary }, badgeText_success: { color: colors.success }, badgeText_warning: { color: colors.warning }, badgeText_danger: { color: colors.danger }, badgeText_info: { color: colors.info }, badgeText_primary: { color: colors.primaryDark },
  notice: { alignItems: 'flex-start', borderRadius: radius.sm, flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm, padding: spacing.sm }, notice_info: { backgroundColor: colors.infoSoft }, notice_danger: { backgroundColor: colors.dangerSoft }, notice_success: { backgroundColor: colors.successSoft }, notice_warning: { backgroundColor: colors.warningSoft }, noticeCopy: { flex: 1 }, noticeTitle: { ...typography.smallMedium }, noticeMessage: { ...typography.small }, noticeText_info: { color: colors.info }, noticeText_danger: { color: colors.danger }, noticeText_success: { color: colors.success }, noticeText_warning: { color: colors.warning }, noticeAction: { ...typography.caption, textDecorationLine: 'underline' },
  skeleton: { backgroundColor: '#DDE5EB' }, skeletonCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, flexDirection: 'row', marginBottom: spacing.sm, padding: spacing.md }, skeletonCopy: { flex: 1, marginLeft: spacing.md }, skeletonLine: { marginTop: spacing.xs },
  state: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing.lg, padding: spacing.xxl }, stateCompact: { marginTop: 0, padding: spacing.lg }, stateIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 26, height: 52, justifyContent: 'center', width: 52 }, stateIconDanger: { backgroundColor: colors.dangerSoft }, stateTitle: { ...typography.h3, color: colors.ink, marginTop: spacing.md, textAlign: 'center' }, stateMessage: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, stateButton: { marginTop: spacing.md },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  segmentField: { marginTop: spacing.md }, segments: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }, segment: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.xxs, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary }, segmentText: { ...typography.smallMedium, color: colors.textSecondary }, segmentTextActive: { color: colors.white },
});
