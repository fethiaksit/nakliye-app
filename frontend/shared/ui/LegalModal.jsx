import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from './Icon';
import { colors, radius, spacing, typography } from './theme';
import { LEGAL_DOCS } from '../legalTexts';

export const LEGAL_TEXTS = LEGAL_DOCS;

export default function LegalModal({ visible, docType, onClose, onAccept, acceptLabel = 'Okudum, Kabul Ediyorum' }) {
  const doc = LEGAL_DOCS[docType];
  if (!visible || !doc) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={styles.title} numberOfLines={1}>{doc.title}</Text>
            {doc.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{doc.subtitle}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Kapat">
            <Icon name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>Sürüm {doc.version || '1.0.0'} · {doc.updatedAt || '14 Ekim 2026'}</Text>
          </View>
          <Text style={styles.bodyText}>{doc.content}</Text>
        </ScrollView>
        <View style={styles.footer}>
          {onAccept ? (
            <Pressable onPress={onAccept} style={[styles.okButton, { marginBottom: spacing.xs }]}>
              <Text style={styles.okButtonText}>{acceptLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} style={[styles.okButton, onAccept && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}>
            <Text style={[styles.okButtonText, onAccept && { color: colors.text }]}>Anladım, Kapat</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  versionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  versionText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  okButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  okButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
