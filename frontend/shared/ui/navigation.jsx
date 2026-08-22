import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import { colors, control, radius, shadows, spacing, typography } from './theme';

export function AppHeader({ title, subtitle, initials, action, topInset = 0 }) {
  return <View style={[styles.header, { paddingTop: topInset + spacing.sm }]}><View style={styles.brandMark}><Icon name="cube" size={23} color={colors.white} /></View><View style={styles.headerCopy}><Text style={styles.headerTitle}>{title}</Text>{subtitle ? <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text> : null}</View>{action || <View style={styles.avatar}><Text style={styles.avatarText}>{initials || '?'}</Text></View>}</View>;
}

export function BottomNav({ items, value, onChange, bottomInset = 0 }) {
  return <View style={[styles.nav, { height: control.bottomNavHeight + bottomInset, paddingBottom: bottomInset }]}>{items.map(item => {
    const active = item.value === value;
    return <Pressable key={item.value} accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(item.value)} style={styles.navItem}><View style={[styles.navIcon, active && styles.navIconActive]}><Icon name={active ? item.activeIcon || item.icon : item.icon} size={23} color={active ? colors.primary : colors.textMuted} />{item.badge ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{item.badge > 99 ? '99+' : item.badge}</Text></View> : null}</View><Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text></Pressable>;
  })}</View>;
}

export function PageHeading({ eyebrow, title, subtitle, action }) {
  return <View style={styles.pageHeading}><View style={styles.pageHeadingCopy}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.pageTitle}>{title}</Text>{subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}</View>{action}</View>;
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', backgroundColor: colors.ink, flexDirection: 'row', minHeight: 78, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg }, brandMark: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.sm, height: 42, justifyContent: 'center', marginRight: spacing.sm, width: 42 }, headerCopy: { flex: 1 }, headerTitle: { ...typography.h3, color: colors.white }, headerSubtitle: { ...typography.caption, color: '#B9C5D2', marginTop: 2 }, avatar: { alignItems: 'center', backgroundColor: '#E8F0EE', borderColor: 'rgba(255,255,255,.15)', borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 }, avatarText: { ...typography.smallMedium, color: colors.primaryDark },
  nav: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, flexDirection: 'row', left: 0, position: 'absolute', right: 0, ...shadows.card }, navItem: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: spacing.xs }, navIcon: { alignItems: 'center', borderRadius: radius.pill, height: 31, justifyContent: 'center', position: 'relative', width: 48 }, navIconActive: { backgroundColor: colors.primarySoft }, navBadge: { alignItems: 'center', backgroundColor: colors.danger, borderColor: colors.surface, borderRadius: 9, borderWidth: 2, justifyContent: 'center', minHeight: 18, minWidth: 18, paddingHorizontal: 3, position: 'absolute', right: 2, top: -3 }, navBadgeText: { color: colors.white, fontSize: 8, fontWeight: '800' }, navLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 }, navLabelActive: { color: colors.primaryDark, fontWeight: '800' },
  pageHeading: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg }, pageHeadingCopy: { flex: 1 }, eyebrow: { ...typography.caption, color: colors.primary, letterSpacing: .8, marginBottom: spacing.xxs, textTransform: 'uppercase' }, pageTitle: { ...typography.h1, color: colors.ink }, pageSubtitle: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
});
