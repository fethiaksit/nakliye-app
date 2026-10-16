import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import Icon from './Icon';
import SearchableSelect from './SearchableSelect';
import { DetailRow, ListingCard } from './listing';
import { AppButton, Badge, ListSkeleton, ScreenState, SectionCard, SegmentedControl, TextField } from './primitives';
import { colors, radius, spacing, typography } from './theme';

export const initialsFor = name => String(name || '').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR') || '?';

export const splitFullName = name => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '—', lastName: parts.slice(1).join(' ') || '—' };
};

export function useAccountBack(page, onPageChange, resolveBackPage) {
  useEffect(() => {
    if (page === 'home') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onPageChange(resolveBackPage(page));
      return true;
    });
    return () => subscription.remove();
  }, [onPageChange, page, resolveBackPage]);
}

export function AccountBackHeader({ title, subtitle, onBack }) {
  return <View style={styles.backHeader}>
    <Pressable accessibilityLabel="Geri" accessibilityRole="button" hitSlop={8} onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="arrow-back" size={21} color={colors.ink} /></Pressable>
    <View style={styles.backCopy}><Text style={styles.backTitle}>{title}</Text>{subtitle ? <Text style={styles.backSubtitle}>{subtitle}</Text> : null}</View>
  </View>;
}

export function AccountProfileCard({ account, roleLabel, meta, stats = [] }) {
  return <View style={styles.profileCard}>
    <View style={styles.profileTop}><View style={styles.avatar}><Text style={styles.avatarText}>{initialsFor(account?.name)}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName}>{account?.name || 'Kullanıcı'}</Text><Text style={styles.profileContact}>{account?.phone || 'Telefon belirtilmedi'}</Text>{account?.email ? <Text style={styles.profileContact}>{account.email}</Text> : null}<Text style={styles.profileRole}>{roleLabel}</Text></View></View>
    {meta ? <Text style={styles.profileMeta}>{meta}</Text> : null}
    {stats.length ? <View style={styles.stats}>{stats.map(item => <View key={item.label} style={styles.stat}><Text style={styles.statValue}>{item.value}</Text><Text style={styles.statLabel}>{item.label}</Text></View>)}</View> : null}
  </View>;
}

export function AccountMenuSection({ title, children }) {
  return <View style={styles.menuSection}><Text style={styles.menuSectionTitle}>{title}</Text><View style={styles.menuCard}>{children}</View></View>;
}

export function AccountMenuItem({ icon, label, description, onPress, danger = false, last = false, badge }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuItem, !last && styles.menuDivider, pressed && styles.pressed]}>
    <View style={[styles.menuIcon, danger && styles.menuIconDanger]}><Icon name={icon} size={20} color={danger ? colors.danger : colors.primary} /></View>
    <View style={styles.menuCopy}><Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>{description ? <Text style={styles.menuDescription}>{description}</Text> : null}</View>
    {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}<Icon name="chevron-forward" size={19} color={colors.textMuted} />
  </Pressable>;
}

export function PersonalInfoPage({ account, onBack, onEdit }) {
  const { firstName, lastName } = splitFullName(account?.name);
  return <>
    <AccountBackHeader title="Kişisel Bilgiler" subtitle="Hesabınızda kayıtlı iletişim bilgileri" onBack={onBack} />
    <View style={styles.personalHero}><View style={styles.personalAvatar}><Text style={styles.personalAvatarText}>{initialsFor(account?.name)}</Text></View><Text style={styles.personalName}>{account?.name}</Text></View>
    <SectionCard title="Profil bilgileri" icon="person-outline">
      <DetailRow icon="person-outline" label="Ad" value={firstName} />
      <DetailRow icon="person-outline" label="Soyad" value={lastName} />
      <DetailRow icon="call-outline" label="Telefon" value={account?.phone || '—'} />
      <DetailRow icon="mail-outline" label="E-posta" value={account?.email || '—'} />
    </SectionCard>
    <AppButton label="Düzenle" icon="create-outline" onPress={onEdit} />
  </>;
}

export function ProfileEditPage({ form, setForm, loading, onSave, onCancel }) {
  return <>
    <AccountBackHeader title="Profili Düzenle" subtitle="Kaydedilen bilgiler backend hesabınıza uygulanır" onBack={onCancel} />
    <SectionCard title="Kişisel bilgiler" icon="create-outline">
      <TextField label="Ad soyad" required value={form.name} onChangeText={value => setForm(current => ({ ...current, name: value }))} leftIcon="person-outline" autoCapitalize="words" />
      <TextField label="Telefon" required value={form.phone} onChangeText={value => setForm(current => ({ ...current, phone: value }))} leftIcon="call-outline" keyboardType="phone-pad" />
      <TextField label="E-posta" required value={form.email} onChangeText={value => setForm(current => ({ ...current, email: value }))} leftIcon="mail-outline" keyboardType="email-address" autoCapitalize="none" />
    </SectionCard>
    <AppButton label="Kaydet" icon="save-outline" loading={loading} onPress={onSave} />
    <AppButton label="İptal" variant="ghost" onPress={onCancel} style={styles.secondaryAction} />
  </>;
}

export function PasswordPage({ form, setForm, loading, onSubmit, onBack }) {
  return <>
    <AccountBackHeader title="Şifre Değiştir" subtitle="Yeni şifreniz en az 8 karakter olmalıdır" onBack={onBack} />
    <SectionCard title="Güvenlik" icon="lock-closed-outline">
      <TextField label="Mevcut şifre" required value={form.currentPassword} onChangeText={value => setForm(current => ({ ...current, currentPassword: value }))} leftIcon="key-outline" secureTextEntry autoCapitalize="none" />
      <TextField label="Yeni şifre" required value={form.newPassword} onChangeText={value => setForm(current => ({ ...current, newPassword: value }))} leftIcon="shield-checkmark-outline" secureTextEntry autoCapitalize="none" />
      <TextField label="Yeni şifre tekrar" required value={form.newPasswordConfirm} onChangeText={value => setForm(current => ({ ...current, newPasswordConfirm: value }))} leftIcon="shield-checkmark-outline" secureTextEntry autoCapitalize="none" />
      <AppButton label="Şifreyi Güncelle" icon="refresh-outline" loading={loading} onPress={onSubmit} style={styles.cardAction} />
    </SectionCard>
  </>;
}

export function AccountJobsPage({ title, subtitle, items, loading, error, onRetry, onBack, onOpen, statusLabel, formatMoney, resolveMediaUrl, emptyMessage }) {
  return <>
    <AccountBackHeader title={title} subtitle={subtitle} onBack={onBack} />
    {loading && !items.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Nakliyeler yüklenemedi" message={error} onRetry={onRetry} /> : !items.length ? <ScreenState title="Kayıt bulunamadı" message={emptyMessage} /> : items.map(load => <ListingCard key={load.id} load={load} onPress={() => onOpen(load)} statusLabel={statusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} />)}
  </>;
}

const notificationLabel = status => ({ granted: 'İzin verildi', denied: 'İzin verilmedi', undetermined: 'Henüz sorulmadı' }[status] || 'Bilinmiyor');

export function DeviceNotificationsPage({ onBack, onPermissionGranted, children }) {
  const [permission, setPermission] = useState({ loading: true, status: '' });
  const readPermission = async () => {
    try {
      const result = await Notifications.getPermissionsAsync();
      setPermission({ loading: false, status: result.status });
    } catch {
      setPermission({ loading: false, status: 'unknown' });
    }
  };
  useEffect(() => { void readPermission(); }, []);
  const request = async () => {
    try {
      const result = await Notifications.requestPermissionsAsync();
      setPermission({ loading: false, status: result.status });
      if (result.status === 'granted') {
        try { await onPermissionGranted?.(); } catch { /* Device permission remains granted even if token registration is temporarily unavailable. */ }
      }
    } catch {
      setPermission({ loading: false, status: 'unknown' });
    }
  };
  return <>
    <AccountBackHeader title="Bildirim Ayarları" subtitle="Gerçek cihaz ve hesap ayarları" onBack={onBack} />
    <SectionCard title="Cihaz bildirim izni" icon="notifications-outline">
      <DetailRow icon="phone-portrait-outline" label="İzin durumu" value={permission.loading ? 'Kontrol ediliyor…' : notificationLabel(permission.status)} />
      {permission.status !== 'granted' ? <AppButton label="Bildirim izni iste" variant="secondary" icon="notifications-outline" onPress={request} style={styles.cardAction} /> : null}
      <Text style={styles.helper}>Sistem ayarlarında kalıcı olarak kapatılan izinler cihazın Ayarlar uygulamasından açılmalıdır.</Text>
    </SectionCard>
    {children}
  </>;
}

import { LEGAL_DOCS } from '../legalTexts';
import { Alert } from 'react-native';

export const LEGAL_LIST_ITEMS = [
  { key: 'terms', title: 'Kullanım Koşulları', subtitle: 'Platform genel kullanım şartları', icon: 'document-text-outline' },
  { key: 'privacy', title: 'Gizlilik Politikası', subtitle: 'Kişisel veri güvenliği ve ilkelerimiz', icon: 'shield-checkmark-outline' },
  { key: 'kvkk', title: 'KVKK Aydınlatma Metni', subtitle: '6698 sayılı kanun kapsamında bilgilendirme', icon: 'ribbon-outline' },
  { key: 'consent', title: 'Açık Rıza Metinleri', subtitle: 'Ticari ileti ve pazarlama onayları', icon: 'checkmark-circle-outline' },
  { key: 'location', title: 'Konum Verisi Aydınlatması', subtitle: 'Canlı takip ve mesafe hesaplama izinleri', icon: 'location-outline' },
  { key: 'deletion', title: 'Hesap ve Veri Silme Politikası', subtitle: 'Hesap kapatma ve imha prosedürleri', icon: 'trash-outline' },
  { key: 'customerTerms', title: 'Müşteri Hizmet Koşulları', subtitle: 'Yük taşıma talebi ve teslim alma kuralları', icon: 'cube-outline' },
  { key: 'driverTerms', title: 'Şoför Hizmet Koşulları', subtitle: 'Taşıyıcı sorumlulukları ve iş kuralları', icon: 'car-outline' },
  { key: 'dispute', title: 'İptal ve Uyuşmazlık Prosedürü', subtitle: 'Hasar, iptal ve şikâyet çözüm süreci', icon: 'alert-circle-outline' },
  { key: 'retention', title: 'Veri Saklama ve İmha Politikası', subtitle: 'Yasal saklama süreleri ve periyodik imha', icon: 'archive-outline' },
  { key: 'cookies', title: 'Çerez ve Analitik Politikası', subtitle: 'Web teknolojileri ve izleme tercihleri', icon: 'globe-outline' },
];

export function LegalIndexPage({ onSelectDoc, onBack }) {
  return <>
    <AccountBackHeader title="Yasal Bilgiler ve KVKK" subtitle="Şeffaflık, haklarınız ve sözleşmeler" onBack={onBack} />
    <AccountMenuSection title="Temel Yasal Belgeler">
      {LEGAL_LIST_ITEMS.slice(0, 5).map(item => (
        <AccountMenuItem
          key={item.key}
          icon={item.icon}
          label={item.title}
          description={item.subtitle}
          onPress={() => onSelectDoc(item.key)}
        />
      ))}
    </AccountMenuSection>
    <AccountMenuSection title="Hizmet ve Operasyon">
      {LEGAL_LIST_ITEMS.slice(5, 9).map(item => (
        <AccountMenuItem
          key={item.key}
          icon={item.icon}
          label={item.title}
          description={item.subtitle}
          onPress={() => onSelectDoc(item.key)}
        />
      ))}
    </AccountMenuSection>
    <AccountMenuSection title="Veri Saklama ve Web">
      {LEGAL_LIST_ITEMS.slice(9).map((item, idx) => (
        <AccountMenuItem
          key={item.key}
          icon={item.icon}
          label={item.title}
          description={item.subtitle}
          last={idx === LEGAL_LIST_ITEMS.slice(9).length - 1}
          onPress={() => onSelectDoc(item.key)}
        />
      ))}
    </AccountMenuSection>
  </>;
}

export function LegalPage({ type, onBack }) {
  const doc = LEGAL_DOCS[type] || LEGAL_DOCS.terms;
  return <>
    <AccountBackHeader title={doc?.title || 'Yasal Belge'} subtitle={doc?.subtitle || 'Yasal Bilgilendirme'} onBack={onBack} />
    <View style={styles.legalMetaBadge}>
      <Icon name="shield-checkmark" size={14} color={colors.primary} />
      <Text style={styles.legalMetaText}>Sürüm {doc?.version || '1.0.0'} · Son Güncelleme: {doc?.updatedAt || '14 Ekim 2026'}</Text>
    </View>
    <SectionCard title="Belge Metni" icon="document-text-outline">
      <Text style={styles.legalText}>{doc?.content || 'İçerik hazırlanıyor...'}</Text>
    </SectionCard>
  </>;
}

export function DeleteAccountPage({ loading, onDelete, onBack }) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = () => {
    if (!password) {
      setError('Hesabınızı silmek için mevcut şifrenizi girmeniz zorunludur.');
      return;
    }
    if (!confirmed) {
      setError('Devam etmek için silme şartlarını onaylamanız gerekir.');
      return;
    }
    setError('');
    Alert.alert(
      'Hesabınızı Silmek İstediğinize Emin Misiniz?',
      'Bu işlem geri alınamaz. Adınız, telefonunuz ve e-postanız anonimleştirilecek, tüm oturumlarınız kapatılacaktır.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Evet, Hesabımı Sil',
          style: 'destructive',
          onPress: () => onDelete({ password, reason }),
        },
      ]
    );
  };

  return <>
    <AccountBackHeader title="Hesabımı Sil" subtitle="Kişisel veri ve hesap kapatma işlemi" onBack={onBack} />
    <View style={styles.dangerNotice}>
      <View style={styles.dangerNoticeHeader}>
        <Icon name="warning" size={20} color={colors.danger} />
        <Text style={styles.dangerNoticeTitle}>Önemli Güvenlik ve Yasal Bilgilendirme</Text>
      </View>
      <Text style={styles.dangerNoticeItem}>• Devam eden aktif veya atanmış nakliyeniz varsa hesabınız silinemez.</Text>
      <Text style={styles.dangerNoticeItem}>• Ad, soyad, telefon ve e-posta gibi kişisel kimlik verileriniz silinir veya geri döndürülemez biçimde anonimleştirilir.</Text>
      <Text style={styles.dangerNoticeItem}>• Bildirim jetonları iptal edilir ve tüm cihaz oturumlarınız derhal sonlandırılır.</Text>
      <Text style={styles.dangerNoticeItem}>• Türk Ticaret Kanunu ve Vergi Usul Kanunu uyarınca finansal/fatura kayıtları ve uyuşmazlık belgeleri yasal saklama sürelerince kilitli arşivde tutulur.</Text>
      <Text style={styles.dangerNoticeItem}>• Bu işlem tamamlandığında hesabınıza bir daha giriş yapılamaz.</Text>
    </View>

    <SectionCard title="Kimlik Doğrulama" icon="lock-closed-outline">
      <TextField
        required
        label="Mevcut Şifreniz"
        value={password}
        onChangeText={v => { setPassword(v); setError(''); }}
        secureTextEntry
        leftIcon="key-outline"
        placeholder="Mevcut hesap şifrenizi girin"
      />
      <TextField
        label="Silme Nedeni (İsteğe bağlı)"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={300}
        placeholder="Ayrılma nedeninizi belirtebilirsiniz..."
        helper="Hizmetlerimizi geliştirmemiz için geri bildiriminiz önemlidir."
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => { setConfirmed(c => !c); setError(''); }}
        style={styles.confirmRow}
      >
        <View style={[styles.confirmBox, confirmed && styles.confirmBoxChecked]}>
          {confirmed ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
        </View>
        <Text style={styles.confirmText}>
          Hesabımın kalıcı olarak silinmesini, kişisel verilerimin anonimleştirilmesini ve bu işlemin geri alınamaz olduğunu anladım, onaylıyorum.
        </Text>
      </Pressable>
      {error ? <Text style={styles.actionError}>{error}</Text> : null}
      <AppButton
        label="Hesabımı Kalıcı Olarak Sil"
        icon="trash-outline"
        variant="outlineDanger"
        loading={loading}
        onPress={handleDelete}
        style={styles.cardAction}
      />
    </SectionCard>
  </>;
}

export const supportReasonOptions = [
  { value: 'payment_dispute', label: 'Ödeme anlaşmazlığı' },
  { value: 'behavior', label: 'Davranış' },
  { value: 'damage', label: 'Hasar' },
  { value: 'no_show', label: 'Gelmeme' },
  { value: 'incorrect_load_info', label: 'Yanlış yük bilgisi' },
  { value: 'safety', label: 'Güvenlik' },
  { value: 'other', label: 'Diğer' },
];

export const supportStatus = value => ({
  open: { label: 'Açık', tone: 'warning' }, reviewing: { label: 'İnceleniyor', tone: 'info' }, resolved: { label: 'Çözüldü', tone: 'success' }, rejected: { label: 'Reddedildi', tone: 'danger' },
}[value] || { label: value || 'Bilinmiyor', tone: 'neutral' });

export function SupportListPage({ items, loading, error, onRetry, onBack, onNew, onOpen }) {
  return <>
    <AccountBackHeader title="Şikâyet ve Öneri" subtitle="Önceki bildirimlerinizi takip edin" onBack={onBack} />
    <AppButton label="Yeni Bildirim" icon="add-circle-outline" onPress={onNew} style={styles.topAction} />
    {loading && !items.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Bildirimler yüklenemedi" message={error} onRetry={onRetry} /> : !items.length ? <ScreenState title="Henüz bildiriminiz yok" message="Şikâyet veya önerilerinizi yeni bildirim oluşturarak iletebilirsiniz." /> : items.map(item => {
      const complaint = item.complaint || item;
      const status = supportStatus(complaint.status);
      return <Pressable key={complaint.id} accessibilityRole="button" onPress={() => onOpen(item)} style={({ pressed }) => [styles.ticketCard, pressed && styles.pressed]}>
        <View style={styles.ticketHeader}><View style={styles.ticketIcon}><Icon name={complaint.type === 'feedback' ? 'bulb-outline' : 'alert-circle-outline'} size={20} color={colors.primary} /></View><View style={styles.ticketCopy}><Text style={styles.ticketTitle}>{complaint.subject}</Text><Text style={styles.ticketMeta}>{complaint.type === 'feedback' ? 'Öneri / Geri Bildirim' : supportReasonOptions.find(option => option.value === complaint.reason)?.label || 'Şikâyet'} · {new Date(complaint.createdAt).toLocaleDateString('tr-TR')}</Text></View><Badge label={status.label} tone={status.tone} /></View>
      </Pressable>;
    })}
  </>;
}

export function SupportNewPage({ form, setForm, loads, loading, onSubmit, onBack }) {
  const loadOptions = loads.map(load => ({ value: load.id, label: `${load.title || 'Nakliye'} · ${String(load.pickup?.address || '').split(',')[0]} → ${String(load.delivery?.address || '').split(',')[0]}` }));
  return <>
    <AccountBackHeader title="Yeni Bildirim" subtitle="Kaydınız mevcut destek sistemine iletilir" onBack={onBack} />
    <SectionCard title="Bildirim bilgileri" icon="chatbox-ellipses-outline">
      <SegmentedControl label="Bildirim türü" value={form.type} onChange={value => setForm(current => ({ ...current, type: value, reason: value === 'feedback' ? 'other' : current.reason }))} options={[{ value: 'complaint', label: 'Şikâyet' }, { value: 'feedback', label: 'Öneri / Geri Bildirim' }]} />
      <TextField label="Konu" required value={form.subject} onChangeText={value => setForm(current => ({ ...current, subject: value }))} maxLength={120} leftIcon="text-outline" />
      {form.type === 'complaint' ? <SearchableSelect label="Sebep" required value={form.reason} options={supportReasonOptions} onChange={value => setForm(current => ({ ...current, reason: value }))} searchPlaceholder="Sebep ara" /> : null}
      <SearchableSelect label="İlgili nakliye" value={form.loadId} options={loadOptions} onChange={value => setForm(current => ({ ...current, loadId: value || '' }))} placeholder="İsteğe bağlı" searchPlaceholder="Nakliye ara" clearable />
      <TextField label="Açıklama" required value={form.description} onChangeText={value => setForm(current => ({ ...current, description: value }))} multiline maxLength={1000} placeholder="Durumu açık ve net şekilde anlatın." />
      <AppButton label="Bildirimi Gönder" icon="send-outline" loading={loading} onPress={onSubmit} style={styles.cardAction} />
    </SectionCard>
  </>;
}

export function SupportDetailPage({ item, onBack }) {
  const complaint = item?.complaint || item || {};
  const status = supportStatus(complaint.status);
  const load = item?.load;
  return <>
    <AccountBackHeader title="Bildirim Detayı" onBack={onBack} />
    <SectionCard title={complaint.subject || 'Bildirim'} icon={complaint.type === 'feedback' ? 'bulb-outline' : 'alert-circle-outline'} action={<Badge label={status.label} tone={status.tone} />}>
      <DetailRow icon="list-outline" label="Tür" value={complaint.type === 'feedback' ? 'Öneri / Geri Bildirim' : 'Şikâyet'} />
      <DetailRow icon="pricetag-outline" label="Sebep" value={complaint.type === 'feedback' ? 'Genel geri bildirim' : supportReasonOptions.find(option => option.value === complaint.reason)?.label || 'Diğer'} />
      <DetailRow icon="calendar-outline" label="Oluşturulma" value={complaint.createdAt ? new Date(complaint.createdAt).toLocaleString('tr-TR') : '—'} />
      <DetailRow icon="document-text-outline" label="İlgili nakliye" value={load?.title || (complaint.loadId ? `#${String(complaint.loadId).slice(-8).toUpperCase()}` : 'Bağlı nakliye yok')} />
      <Text style={styles.descriptionLabel}>Açıklama</Text><Text style={styles.description}>{complaint.description || '—'}</Text>
    </SectionCard>
  </>;
}

const styles = StyleSheet.create({
  backHeader: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.lg }, backButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', marginRight: spacing.sm, width: 40 }, backCopy: { flex: 1 }, backTitle: { ...typography.h2, color: colors.ink }, backSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  profileCard: { backgroundColor: colors.ink, borderRadius: radius.xl, marginBottom: spacing.xl, overflow: 'hidden', padding: spacing.lg }, profileTop: { alignItems: 'center', flexDirection: 'row' }, avatar: { alignItems: 'center', backgroundColor: colors.primary, borderColor: 'rgba(255,255,255,.18)', borderRadius: 32, borderWidth: 1, height: 64, justifyContent: 'center', marginRight: spacing.md, width: 64 }, avatarText: { ...typography.h2, color: colors.white }, profileCopy: { flex: 1 }, profileName: { ...typography.h2, color: colors.white }, profileContact: { ...typography.caption, color: '#C5D0DB', marginTop: 2 }, profileRole: { ...typography.caption, color: '#8DD0BF', fontWeight: '800', marginTop: spacing.xs, textTransform: 'uppercase' }, profileMeta: { ...typography.small, borderTopColor: 'rgba(255,255,255,.12)', borderTopWidth: 1, color: '#C5D0DB', marginTop: spacing.md, paddingTop: spacing.sm }, stats: { borderTopColor: 'rgba(255,255,255,.12)', borderTopWidth: 1, flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md }, stat: { flex: 1 }, statValue: { ...typography.h3, color: colors.white }, statLabel: { ...typography.caption, color: '#AAB7C4', marginTop: 2 },
  menuSection: { marginBottom: spacing.lg }, menuSectionTitle: { ...typography.caption, color: colors.textMuted, fontWeight: '800', letterSpacing: .8, marginBottom: spacing.xs, paddingHorizontal: spacing.xs, textTransform: 'uppercase' }, menuCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' }, menuItem: { alignItems: 'center', flexDirection: 'row', minHeight: 66, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, menuDivider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }, menuIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginRight: spacing.sm, width: 38 }, menuIconDanger: { backgroundColor: colors.dangerSoft }, menuCopy: { flex: 1, paddingRight: spacing.sm }, menuLabel: { ...typography.bodyMedium, color: colors.ink }, menuLabelDanger: { color: colors.danger }, menuDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  personalHero: { alignItems: 'center', marginBottom: spacing.lg }, personalAvatar: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 38, height: 76, justifyContent: 'center', width: 76 }, personalAvatarText: { ...typography.h1, color: colors.white }, personalName: { ...typography.h2, color: colors.ink, marginTop: spacing.sm }, secondaryAction: { marginTop: spacing.xs }, cardAction: { marginTop: spacing.md }, topAction: { marginBottom: spacing.md }, helper: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }, legalText: { ...typography.body, color: colors.textSecondary, lineHeight: 24 },
  legalMetaBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.sm, flexDirection: 'row', gap: 6, marginBottom: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  legalMetaText: { ...typography.caption, color: colors.primaryDark, fontWeight: '700' },
  dangerNotice: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.lg, padding: spacing.md },
  dangerNoticeHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  dangerNoticeTitle: { ...typography.smallMedium, color: colors.danger, fontWeight: '800' },
  dangerNoticeItem: { ...typography.caption, color: colors.text, lineHeight: 18, marginTop: 4 },
  confirmRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  confirmBox: { alignItems: 'center', borderColor: colors.borderStrong, borderRadius: radius.xs, borderWidth: 1.5, height: 20, justifyContent: 'center', marginTop: 2, width: 20 },
  confirmBoxChecked: { backgroundColor: colors.danger, borderColor: colors.danger },
  confirmText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  actionError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  ticketCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.sm, padding: spacing.md }, ticketHeader: { alignItems: 'center', flexDirection: 'row' }, ticketIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 40, justifyContent: 'center', marginRight: spacing.sm, width: 40 }, ticketCopy: { flex: 1 }, ticketTitle: { ...typography.bodyMedium, color: colors.ink }, ticketMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 }, descriptionLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, textTransform: 'uppercase' }, description: { ...typography.body, color: colors.text, lineHeight: 23, marginTop: spacing.xs }, pressed: { opacity: .72 },
});
