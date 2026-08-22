import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { directionsURL } from './mapRuntime';
import Icon from '../ui/Icon';
import { useToast } from '../ui/feedback';
import { colors, radius, spacing, typography } from '../ui/theme';

const label = value => value || 'Henüz seçilmedi';

export default function MapUnavailable({ pickup, dropoff, distanceLabel, durationLabel, priceLabel, message, style }) {
  const { showToast } = useToast();
  const [opening, setOpening] = useState(false);
  const url = directionsURL(pickup, dropoff);
  const openDirections = useCallback(async () => {
    if (!url || opening) return;
    setOpening(true);
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    } catch (error) {
      if (__DEV__) console.warn('[MAPS] Google Maps link could not be opened.', error?.message);
      showToast('Google Haritalar bağlantısı açılamadı.', { type: 'error' });
    } finally {
      setOpening(false);
    }
  }, [opening, showToast, url]);

  return <View style={[styles.root, style]}>
    <View style={styles.icon}><Icon name="map-outline" size={24} color={colors.danger} /></View><Text style={styles.title}>{message || 'Harita şu anda bu geliştirme modunda kullanılamıyor.'}</Text>
    <Text style={styles.detail}>Başlangıç ve varış adresleri ile rota bilgileri görüntülenmeye devam eder.</Text>
    <View style={styles.route}><Text style={styles.routeLabel}>BAŞLANGIÇ</Text><Text style={styles.routeValue}>{label(pickup?.address)}</Text><Text style={styles.routeLabel}>VARIŞ</Text><Text style={styles.routeValue}>{label(dropoff?.address)}</Text></View>
    {(distanceLabel || durationLabel || priceLabel) ? <View style={styles.metrics}>
      {distanceLabel ? <View style={styles.metric}><Icon name="navigate-outline" size={15} color={colors.primary} /><Text style={styles.metricText}>{distanceLabel}</Text></View> : null}
      {durationLabel ? <View style={styles.metric}><Icon name="time-outline" size={15} color={colors.primary} /><Text style={styles.metricText}>{durationLabel}</Text></View> : null}
      {priceLabel ? <View style={styles.metric}><Icon name="cash-outline" size={15} color={colors.primary} /><Text style={styles.metricText}>{priceLabel}</Text></View> : null}
    </View> : null}
    {url ? <Pressable style={styles.button} onPress={() => void openDirections()} disabled={opening} accessibilityRole="link" accessibilityLabel="Rotayı Google Haritalar'da aç">
      {opening ? <ActivityIndicator color={colors.primary} size="small" /> : <><Icon name="open-outline" size={17} color={colors.primary} /><Text style={styles.buttonText}>Google Haritalar’da aç</Text></>}
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { alignItems: 'stretch', backgroundColor: colors.dangerSoft, flex: 1, justifyContent: 'center', padding: spacing.md }, icon: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.md, height: 46, justifyContent: 'center', marginBottom: spacing.xs, width: 46 },
  title: { ...typography.smallMedium, color: colors.danger, textAlign: 'center' }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, route: { backgroundColor: colors.surface, borderColor: '#E7B6B2', borderRadius: radius.sm, borderWidth: 1, marginTop: spacing.sm, padding: spacing.sm }, routeLabel: { ...typography.caption, color: colors.textMuted, letterSpacing: .5, marginTop: spacing.xxs }, routeValue: { ...typography.caption, color: colors.text, marginTop: 2 }, metrics: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.sm }, metric: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs }, metricText: { ...typography.caption, color: colors.primaryDark }, button: { alignItems: 'center', backgroundColor: colors.surface, borderColor: '#C9E1DB', borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, minHeight: 42, justifyContent: 'center' }, buttonText: { ...typography.caption, color: colors.primaryDark },
});
