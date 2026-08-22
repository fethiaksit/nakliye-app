import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import Icon from '../../../shared/ui/Icon';
import { useToast } from '../../../shared/ui/feedback';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';

const MAX_PHOTOS = 5;

export default function LoadPhotoPicker({ photos, onChange, error }) {
  const { showToast } = useToast();
  const choose = useCallback(async source => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      showToast('Bir ilana en fazla 5 fotoğraf ekleyebilirsiniz.', { type: 'warning', title: 'Fotoğraf sınırı' });
      return;
    }
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast(source === 'camera' ? 'Kamera izni verilmedi. Galeriden fotoğraf seçebilirsiniz.' : 'Fotoğraf seçebilmek için galeri iznine izin verin.', { type: 'error' });
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.8 });
      if (result.canceled) return;
      const accepted = (result.assets || []).filter(asset => asset.uri && (!asset.mimeType || ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)));
      if (accepted.length !== (result.assets || []).length) showToast('Yalnızca JPEG, PNG veya WEBP fotoğraflar desteklenir.', { type: 'warning' });
      onChange([...photos, ...accepted].slice(0, MAX_PHOTOS));
    } catch (selectionError) {
      if (__DEV__) console.warn('[PHOTO PICKER] Selection failed.', { code: selectionError?.code, message: selectionError?.message });
      showToast('Fotoğraf seçilirken beklenmeyen bir hata oluştu.', { type: 'error' });
    }
  }, [onChange, photos, showToast]);

  return <View style={styles.container}>
    <View style={styles.labelRow}><Text style={styles.label}>Yük fotoğrafları</Text><Text style={styles.counter}>{photos.length}/{MAX_PHOTOS}</Text></View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => choose('library')}><Icon name="images-outline" size={20} color={colors.primary} /><Text style={styles.buttonText}>Galeriden seç</Text></Pressable>
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => choose('camera')}><Icon name="camera-outline" size={20} color={colors.primary} /><Text style={styles.buttonText}>Fotoğraf çek</Text></Pressable>
    </View>
    {photos.length > 0 ? <View style={styles.previewRow}>{photos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.preview}><Image source={{ uri: photo.uri }} style={styles.image} /><Pressable accessibilityLabel="Fotoğrafı kaldır" style={styles.remove} onPress={() => onChange(photos.filter((_, itemIndex) => itemIndex !== index))}><Icon name="close" size={16} color={colors.white} /></Pressable></View>)}</View> : <View style={styles.empty}><Icon name="image-outline" size={22} color={colors.textMuted} /><Text style={styles.emptyText}>Yükün hacmini ve erişim koşullarını gösteren fotoğraflar teklif kalitesini artırır.</Text></View>}
    {error ? <View style={styles.feedback}><Icon name="alert-circle" size={15} color={colors.danger} /><Text style={styles.error}>{error}</Text></View> : <Text style={styles.hint}>JPEG, PNG veya WEBP · Fotoğraf başına en fazla 10 MB</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.lg }, labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }, label: { ...typography.smallMedium, color: colors.text }, counter: { ...typography.caption, color: colors.primary },
  actions: { flexDirection: 'row', gap: spacing.xs }, button: { alignItems: 'center', backgroundColor: colors.primarySoft, borderColor: '#C6DFD9', borderRadius: radius.sm, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.xs }, buttonText: { ...typography.smallMedium, color: colors.primaryDark }, pressed: { opacity: .7 },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }, preview: { height: 74, position: 'relative', width: 74 }, image: { borderRadius: radius.sm, height: '100%', width: '100%' }, remove: { alignItems: 'center', backgroundColor: colors.ink, borderColor: colors.surface, borderRadius: 12, borderWidth: 2, height: 24, justifyContent: 'center', position: 'absolute', right: -6, top: -6, width: 24 },
  empty: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.sm, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm }, emptyText: { ...typography.caption, color: colors.textSecondary, flex: 1 }, hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs }, feedback: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xs }, error: { ...typography.caption, color: colors.danger, flex: 1 },
});
