import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { cargoTypeLabel, formatListingTime, vehicleTypeLabel } from '../loadMetadata';
import Icon from './Icon';
import { Badge } from './primitives';
import { colors, radius, shadows, spacing, typography } from './theme';

const statusTone = status => ({ completed: 'success', delivered: 'success', en_route_to_delivery: 'info', picked_up: 'info', at_pickup: 'info', driver_en_route: 'info', in_transit: 'info', driver_selected: 'primary', cancelled: 'danger', offers_received: 'success', published: 'success', open: 'success', draft: 'neutral' }[status] || 'neutral');

export function StatusBadge({ status, label }) {
  const icon = status === 'completed' || status === 'delivered' ? 'checkmark-circle' : ['driver_en_route', 'at_pickup', 'picked_up', 'en_route_to_delivery', 'in_transit'].includes(status) ? 'navigate-circle' : status === 'cancelled' ? 'close-circle' : status === 'driver_selected' ? 'person-circle' : 'radio-button-on';
  return <Badge label={label} tone={statusTone(status)} icon={icon} />;
}

export function RouteTimeline({ pickup, delivery, compact = false }) {
  return <View style={[styles.timeline, compact && styles.timelineCompact]}>
    <View style={styles.timelineRail}><View style={styles.pickupDot} /><View style={styles.line} /><View style={styles.deliveryDot}><View style={styles.deliveryDotInner} /></View></View>
    <View style={styles.routeCopy}>
      <View style={styles.routePoint}><Text style={styles.routeLabel}>Başlangıç</Text><Text style={styles.routeAddress} numberOfLines={compact ? 1 : 2}>{pickup || 'Adres belirtilmedi'}</Text></View>
      <View style={[styles.routePoint, compact && styles.routePointCompact]}><Text style={styles.routeLabel}>Varış</Text><Text style={styles.routeAddress} numberOfLines={compact ? 1 : 2}>{delivery || 'Adres belirtilmedi'}</Text></View>
    </View>
  </View>;
}

export function ListingCard({ load, onPress, statusLabel, formatMoney, resolveMediaUrl, footer }) {
  const imageURI = resolveMediaUrl?.(load.photoUrls?.[0]);
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.cardTop}><StatusBadge status={load.status} label={statusLabel(load.status)} /><Text style={styles.time}>{formatListingTime(load)}</Text></View>
    <View style={styles.titleRow}><View style={styles.titleCopy}><Text style={styles.title} numberOfLines={2}>{load.title || 'Başlıksız ilan'}</Text><Text style={styles.category}>{cargoTypeLabel(load.cargoType)} · {vehicleTypeLabel(load.vehicleType)}</Text></View>{imageURI ? <Image source={{ uri: imageURI }} style={styles.thumbnail} /> : <View style={styles.thumbnailFallback}><Icon name="cube-outline" size={24} color={colors.primary} /></View>}</View>
    <RouteTimeline compact pickup={load.pickup?.address} delivery={load.delivery?.address} />
    <View style={styles.metaRow}><Meta icon="navigate-outline" label={`${Number(load.estimatedKm || 0).toFixed(1)} km`} /><Meta icon="scale-outline" label={`${Number(load.dimensions?.weightKg || 0)} kg`} />{Number(load.offerCount || 0) ? <Meta icon="pricetags-outline" label={`${load.offerCount} teklif`} /> : null}<Text style={styles.price}>{formatMoney(load.lastOfferTl || load.agreedPriceTl || load.pricing?.recommendedPrice || load.basePriceTl)}</Text></View>
    {footer}
  </Pressable>;
}

export function Meta({ icon, label }) { return <View style={styles.meta}><Icon name={icon} size={15} color={colors.textMuted} /><Text style={styles.metaText}>{label}</Text></View>; }

export function SummaryCard({ icon, value, label, tone = 'primary', onPress }) {
  const content = <><View style={[styles.summaryIcon, styles[`summaryIcon_${tone}`]]}><Icon name={icon} size={21} color={tone === 'accent' ? colors.accent : tone === 'info' ? colors.info : colors.primary} /></View><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></>;
  return onPress ? <Pressable onPress={onPress} style={styles.summary}>{content}</Pressable> : <View style={styles.summary}>{content}</View>;
}

export function DetailRow({ icon, label, value, valueTone }) {
  return <View style={styles.detailRow}><View style={styles.detailIcon}><Icon name={icon} size={19} color={colors.primary} /></View><View style={styles.detailCopy}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue, valueTone === 'danger' && { color: colors.danger }]}>{value || 'Belirtilmedi'}</Text></View></View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: '#E4EAF0', borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.md, ...shadows.card }, pressed: { opacity: .8, transform: [{ scale: .995 }] }, cardTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, time: { ...typography.caption, color: colors.textSecondary }, titleRow: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.sm }, titleCopy: { flex: 1, paddingRight: spacing.sm }, title: { ...typography.h3, color: colors.ink }, category: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xxs }, thumbnail: { borderRadius: radius.sm, height: 58, width: 58 }, thumbnailFallback: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 58, justifyContent: 'center', width: 58 },
  timeline: { flexDirection: 'row', marginTop: spacing.md }, timelineCompact: { marginTop: spacing.sm }, timelineRail: { alignItems: 'center', width: 20 }, pickupDot: { backgroundColor: colors.primary, borderColor: colors.primarySoft, borderRadius: 7, borderWidth: 3, height: 14, width: 14 }, line: { backgroundColor: colors.borderStrong, flex: 1, marginVertical: 2, minHeight: 27, width: 2 }, deliveryDot: { alignItems: 'center', borderColor: colors.accent, borderRadius: 7, borderWidth: 2, height: 14, justifyContent: 'center', width: 14 }, deliveryDotInner: { backgroundColor: colors.accent, borderRadius: 3, height: 6, width: 6 }, routeCopy: { flex: 1, marginLeft: spacing.xs }, routePoint: { minHeight: 42 }, routePointCompact: { minHeight: 32 }, routeLabel: { ...typography.caption, color: colors.textMuted }, routeAddress: { ...typography.smallMedium, color: colors.text, marginTop: 1 },
  metaRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm }, meta: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs }, metaText: { ...typography.caption, color: colors.textSecondary }, price: { ...typography.h3, color: colors.primaryDark, marginLeft: 'auto' },
  summary: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, minHeight: 112, padding: spacing.md }, summaryIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', width: 38 }, summaryIcon_accent: { backgroundColor: colors.accentSoft }, summaryIcon_info: { backgroundColor: colors.infoSoft }, summaryIcon_primary: { backgroundColor: colors.primarySoft }, summaryValue: { ...typography.h2, color: colors.ink, marginTop: spacing.sm }, summaryLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', paddingVertical: spacing.sm }, detailIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginRight: spacing.sm, width: 38 }, detailCopy: { flex: 1 }, detailLabel: { ...typography.caption, color: colors.textMuted }, detailValue: { ...typography.bodyMedium, color: colors.ink, marginTop: 2 },
});
