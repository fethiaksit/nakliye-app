import React, { useCallback } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

const MAX_PHOTOS = 5;

export default function LoadPhotoPicker({ photos, onChange }) {
  const choose = useCallback(async source => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Fotoğraf sınırı', 'Bir ilana en fazla 5 fotoğraf ekleyebilirsiniz.');
      return;
    }
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Kamera izni verilmedi', 'Fotoğraf eklemek için galeriyi kullanabilirsiniz.');
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Galeri izni verilmedi', 'Fotoğraf seçebilmek için galeri iznine izin verin.');
          return;
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.8 });
      if (result.canceled) return;
      const accepted = (result.assets || []).filter(asset => asset.uri && (!asset.mimeType || ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)));
      if (accepted.length !== (result.assets || []).length) Alert.alert('Bazı fotoğraflar eklenemedi', 'Yalnızca JPEG, PNG veya WEBP fotoğraflar desteklenir.');
      onChange([...photos, ...accepted].slice(0, MAX_PHOTOS));
    } catch (error) {
      if (__DEV__) console.warn('[PHOTO PICKER] Selection failed.', { code: error?.code, message: error?.message });
      Alert.alert('Fotoğraf seçilemedi', 'Fotoğraf seçilirken beklenmeyen bir hata oluştu.');
    }
  }, [onChange, photos]);

  return <View style={styles.container}>
    <View style={styles.actions}>
      <Pressable style={styles.button} onPress={() => choose('library')}><Text style={styles.buttonText}>▧ Galeriden ekle</Text></Pressable>
      <Pressable style={styles.button} onPress={() => choose('camera')}><Text style={styles.buttonText}>◉ Kamera</Text></Pressable>
    </View>
    {photos.length > 0 && <View style={styles.previewRow}>{photos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.preview}><Image source={{ uri: photo.uri }} style={styles.image} /><Pressable style={styles.remove} onPress={() => onChange(photos.filter((_, itemIndex) => itemIndex !== index))}><Text style={styles.removeText}>×</Text></Pressable></View>)}</View>}
    <Text style={styles.hint}>{photos.length}/{MAX_PHOTOS} fotoğraf · JPEG, PNG veya WEBP · en fazla 10 MB</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: 15 },
  actions: { flexDirection: 'row', gap: 9 },
  button: { alignItems: 'center', backgroundColor: '#eef1ff', borderRadius: 10, flex: 1, minHeight: 43, justifyContent: 'center', paddingHorizontal: 8 },
  buttonText: { color: '#405bd2', fontSize: 12, fontWeight: '800' },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  preview: { height: 66, position: 'relative', width: 66 },
  image: { borderRadius: 10, height: '100%', width: '100%' },
  remove: { alignItems: 'center', backgroundColor: '#273875', borderRadius: 10, height: 20, justifyContent: 'center', position: 'absolute', right: -5, top: -5, width: 20 },
  removeText: { color: '#fff', fontSize: 16, lineHeight: 19 },
  hint: { color: '#8d97a7', fontSize: 11, marginTop: 10 },
});
