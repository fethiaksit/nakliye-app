import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { directionsURL } from './mapRuntime';

const label = value => value || 'Henüz seçilmedi';

export default function MapUnavailable({ pickup, dropoff, distanceLabel, durationLabel, priceLabel, message, style }) {
  const [opening, setOpening] = useState(false);
  const url = directionsURL(pickup, dropoff);
  const openDirections = useCallback(async () => {
    if (!url || opening) return;
    setOpening(true);
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    } catch (error) {
      if (__DEV__) console.warn('[MAPS] Google Maps link could not be opened.', error?.message);
    } finally {
      setOpening(false);
    }
  }, [opening, url]);

  return <View style={[styles.root, style]}>
    <Text style={styles.title}>{message || 'Harita şu anda bu geliştirme modunda kullanılamıyor.'}</Text>
    <Text style={styles.detail}>Başlangıç ve varış adresleri ile rota bilgileri görüntülenmeye devam eder.</Text>
    <View style={styles.route}><Text style={styles.routeLabel}>BAŞLANGIÇ</Text><Text style={styles.routeValue}>{label(pickup?.address)}</Text><Text style={styles.routeLabel}>VARIŞ</Text><Text style={styles.routeValue}>{label(dropoff?.address)}</Text></View>
    {(distanceLabel || durationLabel || priceLabel) ? <View style={styles.metrics}>
      {distanceLabel ? <Text style={styles.metric}>{distanceLabel}</Text> : null}
      {durationLabel ? <Text style={styles.metric}>{durationLabel}</Text> : null}
      {priceLabel ? <Text style={styles.metric}>{priceLabel}</Text> : null}
    </View> : null}
    {url ? <Pressable style={styles.button} onPress={() => void openDirections()} disabled={opening} accessibilityRole="link" accessibilityLabel="Rotayı Google Haritalar'da aç">
      {opening ? <ActivityIndicator color="#3658cb" size="small" /> : <Text style={styles.buttonText}>Google Haritalar’da Aç</Text>}
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { alignItems: 'stretch', backgroundColor: '#fff6f4', flex: 1, justifyContent: 'center', padding: 18 },
  title: { color: '#a74238', fontSize: 13, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
  detail: { color: '#68758b', fontSize: 11, lineHeight: 17, marginTop: 7, textAlign: 'center' },
  route: { backgroundColor: '#fff', borderColor: '#f1d7d2', borderRadius: 10, borderWidth: 1, marginTop: 13, padding: 10 },
  routeLabel: { color: '#9a6e67', fontSize: 9, fontWeight: '800', letterSpacing: .5, marginTop: 5 },
  routeValue: { color: '#445066', fontSize: 11, lineHeight: 15, marginTop: 2 },
  metrics: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center', marginTop: 10 },
  metric: { color: '#3658cb', fontSize: 11, fontWeight: '800' },
  button: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#cad5fc', borderRadius: 9, borderWidth: 1, marginTop: 12, minHeight: 38, justifyContent: 'center' },
  buttonText: { color: '#3658cb', fontSize: 11, fontWeight: '800' },
});
