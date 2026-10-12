import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from './Icon';
import { colors, radius, spacing, typography } from './theme';

export const LEGAL_TEXTS = {
  terms: {
    title: 'Kullanım Koşulları',
    content: `NAKLİYEGO KULLANICI SÖZLEŞMESİ

1. Taraflar ve Amaç
İşbu Sözleşme, NakliyeGo ile yük taşımak isteyen Müşteriler ve bağımsız Taşıyıcılar (Şoförler) arasındaki platform aracılık hizmetini düzenler.

2. Aracılık Rolü
NakliyeGo bir kargo acentesi veya fiili taşıyıcı değildir; taşıma sözleşmesinin kurulmasına aracılık eden Aracı Hizmet Sağlayıcıdır.

3. Kullanıcı Sorumlulukları
- Yük bilgisi, ağırlık ve ebatlar doğru beyan edilmelidir.
- Taşınması kanunen yasaklı, yanıcı, patlayıcı veya kaçak maddelerin sisteme ilan olarak girilmesi kesinlikle yasaktır.
- Müşteri, yük sağlam teslim alınmadan önce 6 haneli güvenlik teslimat kodunu şoförle paylaşmamalıdır. Kodun girilmesi taşımanın eksiksiz tamamlandığını teyit eder.`,
  },
  privacy: {
    title: 'Gizlilik Politikası',
    content: `NAKLİYEGO GİZLİLİK POLİTİKASI

1. Toplanan Veriler
Hizmetin sağlanabilmesi için ad, soyad, telefon, e-posta, araç bilgileri (şoförler için), kargo fotoğrafları ve coğrafi konum bilgileri işlenmektedir.

2. Verilerin Kullanımı
- Taşıma taleplerinin eşleştirilmesi ve koordinasyonu,
- 6 haneli güvenlik teslimat kodu ile teslimat doğrulaması,
- Dolandırıcılık ve kötüye kullanımın engellenmesi,
- Uygulama performansının iyileştirilmesi.

3. Veri Güvenliği
Tüm iletişim TLS/HTTPS protokolüyle şifrelenir. Parolalar açık metin olarak asla tutulmaz, Argon2id ile özetlenir. Veriler üçüncü taraflara pazarlama amacıyla satılmaz veya kiralanmaz.

4. Hesap Silme
Kullanıcılar diledikleri zaman hesaplarını ve kişisel verilerini mobil uygulamada 'Hesabım > Güvenlik' alanından veya destek@nakliyego.com adresine başvurarak silebilirler.`,
  },
  kvkk: {
    title: 'KVKK Aydınlatma Metni',
    content: `6698 SAYILI KVKK AYDINLATMA METNİ

1. Veri Sorumlusu
NakliyeGo Teknoloji A.Ş., 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında veri sorumlusudur.

2. Hukuki Sebepler
Kişisel verileriniz KVKK m. 5/2-c (Sözleşmenin kurulması ve ifası), m. 5/2-ç (Hukuki yükümlülük), m. 5/2-f (Meşru menfaat) ve gereken hallerde açık rızanız doğrultusunda işlenmektedir.

3. İlgili Kişinin Hakları (KVKK m. 11)
Kullanıcılarımız; verilerinin işlenip işlenmediğini öğrenme, yanlış verilerin düzeltilmesini isteme, yasal şartlar çerçevesinde silinmesini talep etme haklarına sahiptir.
Başvurularınızı kvkk@nakliyego.com adresine iletebilirsiniz.`,
  },
};

export default function LegalModal({ visible, docType, onClose }) {
  if (!visible || !docType || !LEGAL_TEXTS[docType]) return null;

  const doc = LEGAL_TEXTS[docType];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{doc.title}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Kapat">
            <Icon name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.bodyText}>{doc.content}</Text>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable onPress={onClose} style={styles.okButton}>
            <Text style={styles.okButtonText}>Anladım, Kapat</Text>
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
    fontFamily: typography.semiBold,
    color: colors.text,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  content: {
    padding: spacing.lg,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: typography.regular,
    color: colors.textSecondary,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  okButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  okButtonText: {
    color: colors.white,
    fontFamily: typography.semiBold,
    fontSize: 15,
  },
});
