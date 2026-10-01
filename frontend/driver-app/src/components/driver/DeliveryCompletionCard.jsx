import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import Icon from '../../../../shared/ui/Icon';
import { AppButton, TextField } from '../../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../../shared/ui/theme';

export default function DeliveryCompletionCard({ load, saving, onComplete }) {
  const [code, setCode] = useState('');
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setCode('');
    setPhoto(null);
    setError('');
  }, [load?.id]);

  const choosePhoto = async source => {
    setError('');
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(source === 'camera' ? 'Kamera izni verilmedi.' : 'Galeri izni verilmedi.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled) return;
      const selectedPhoto = result.assets?.[0];
      if (!selectedPhoto?.uri || (selectedPhoto.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(selectedPhoto.mimeType))) {
        setError('Yalnızca JPEG, PNG veya WEBP fotoğraf seçilebilir.');
        return;
      }
      setPhoto(selectedPhoto);
    } catch (selectionError) {
      if (__DEV__) console.warn('[DELIVERY PHOTO] Selection failed.', selectionError);
      setError('Fotoğraf seçilirken bir hata oluştu.');
    }
  };

  const submit = () => {
    const normalizedCode = code.trim();
    if (!/^\d{4,6}$/.test(normalizedCode)) {
      setError('Müşterinin 4–6 haneli teslimat kodunu girin.');
      return;
    }
    if (!photo) {
      setError('Teslimat fotoğrafı zorunludur.');
      return;
    }
    setError('');
    onComplete(load, { code: normalizedCode, photo });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Icon name="shield-checkmark-outline" size={20} color={colors.primary} />
        </View>
        <View>
          <Text style={styles.headerTitle}>Teslimatı Tamamla</Text>
          <Text style={styles.headerSubtitle}>Müşteri kodunu girin ve teslimat fotoğrafını yükleyin.</Text>
        </View>
      </View>

      <View style={styles.body}>
        <TextField
          label="Teslimat Kodu"
          required
          value={code}
          onChangeText={value => {
            setCode(value.replace(/\D/g, '').slice(0, 6));
            setError('');
          }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="6 haneli kod"
          leftIcon="keypad-outline"
        />

        <Text style={styles.photoLabel}>Teslimat Fotoğrafı</Text>
        <View style={styles.photoActions}>
          <AppButton
            label="Galeriden Seç"
            icon="images-outline"
            variant="secondary"
            compact
            style={styles.photoBtn}
            onPress={() => choosePhoto('library')}
          />
          <AppButton
            label="Fotoğraf Çek"
            icon="camera-outline"
            variant="secondary"
            compact
            style={styles.photoBtn}
            onPress={() => choosePhoto('camera')}
          />
        </View>

        {photo ? (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
            <Pressable
              accessibilityLabel="Teslimat fotoğrafını kaldır"
              style={styles.photoRemove}
              onPress={() => setPhoto(null)}
            >
              <Icon name="close" size={16} color={colors.white} />
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <AppButton
          label={saving ? 'Teslimat Doğrulanıyor…' : 'Teslimatı Tamamla'}
          icon="checkmark-done-outline"
          loading={saving}
          onPress={submit}
          style={styles.submitBtn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: '#E2E8F0',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  body: {
    marginTop: spacing.xs,
  },
  photoLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: spacing.xs,
  },
  photoActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  photoBtn: {
    flex: 1,
  },
  photoPreviewWrap: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    position: 'relative',
  },
  photoPreview: {
    borderRadius: radius.md,
    height: 140,
    width: 180,
  },
  photoRemove: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderColor: colors.surface,
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: -6,
    top: -6,
    width: 24,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  submitBtn: {
    marginTop: spacing.md,
  },
});
