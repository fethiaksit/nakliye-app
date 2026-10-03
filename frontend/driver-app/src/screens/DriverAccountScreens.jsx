import DriverWalletScreen from './DriverWalletScreen';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import {
  AccountBackHeader,
  AccountJobsPage,
  AccountMenuItem,
  AccountMenuSection,
  AccountProfileCard,
  DeviceNotificationsPage,
  LegalPage,
  PasswordPage,
  PersonalInfoPage,
  ProfileEditPage,
  SupportDetailPage,
  SupportListPage,
  SupportNewPage,
  useAccountBack,
} from '../../../shared/ui/account';
import { VEHICLE_TYPE_OPTIONS, vehicleTypeLabel } from '../../../shared/loadMetadata';
import Icon from '../../../shared/ui/Icon';
import SearchableSelect from '../../../shared/ui/SearchableSelect';
import { DetailRow } from '../../../shared/ui/listing';
import { ActionSheet, useToast } from '../../../shared/ui/feedback';
import { AppButton, Badge, ListSkeleton, ScreenState, SectionCard, TextField } from '../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';
import { apiError, documents, loads, media, support, vehicles } from '../services/api';
import { formatMoney, loadStatusLabel, resolveMediaUrl, toFiniteNumber } from '../utils/presentation';

const backPage = page => ({
  'profile-edit': 'personal', 'document-detail': 'documents', 'vehicle-detail': 'vehicles', 'vehicle-edit': 'vehicle-detail', 'vehicle-add': 'vehicles', 'support-new': 'support', 'support-detail': 'support',
}[page] || 'home');
const initialSupportForm = () => ({ type: 'complaint', subject: '', reason: '', description: '', loadId: '' });
const emptyVehicleForm = () => ({ vehicleType: '', brand: '', model: '', licensePlate: '', capacityKg: '', lengthCm: '', widthCm: '', heightCm: '', photoUrl: '', photoAsset: null });
const verification = value => ({ pending: { label: 'Bekliyor', tone: 'warning' }, verified: { label: 'Onaylandı', tone: 'success' }, rejected: { label: 'Reddedildi', tone: 'danger' } }[value] || { label: 'Bekliyor', tone: 'warning' });

export const DOCUMENT_DEFINITIONS = [
  { kind: 'driver_license', title: 'Ehliyet', subtitle: 'Sürücü belgesi (Ön / Arka yüz)', icon: 'card-outline' },
  { kind: 'vehicle_registration', title: 'Ruhsat', subtitle: 'Araç tescil belgesi', icon: 'car-sport-outline' },
  { kind: 'src', title: 'SRC Belgesi', subtitle: 'Mesleki yeterlilik belgesi (SRC 1/2/3/4/5)', icon: 'ribbon-outline' },
  { kind: 'psychotechnic', title: 'Psikoteknik Belgesi', subtitle: 'Psikoteknik değerlendirme raporu', icon: 'fitness-outline' },
  { kind: 'identity', title: 'Kimlik', subtitle: 'T.C. Kimlik kartı / Nüfus cüzdanı', icon: 'person-outline' },
  { kind: 'other', title: 'Diğer Belge', subtitle: 'İsteğe bağlı ek evrak veya yetki belgesi', icon: 'document-text-outline' },
];

export const matchDocument = (items, kind) => {
  return (items || []).find(d => {
    if (d.kind === kind) return true;
    if (kind === 'src' && d.kind === 'src_document') return true;
    if (kind === 'psychotechnic' && d.kind === 'psychotechnical') return true;
    if (kind === 'driver_license' && (d.kind === 'license' || d.kind === 'driver_license')) return true;
    return false;
  });
};

export const docStatusMeta = doc => {
  if (!doc) return { label: 'Yüklenmedi', tone: 'neutral' };
  switch (doc.status) {
    case 'verified':
      return { label: 'Onaylandı', tone: 'success' };
    case 'rejected':
      return { label: 'Reddedildi', tone: 'danger' };
    case 'pending':
    default:
      return { label: 'İnceleniyor', tone: 'warning' };
  }
};

function DriverInfoPage({ account, onBack }) {
  const driver = account.driverProfile || {};
  const status = verification(driver.verificationStatus || driver.licenseStatus);
  return <>
    <AccountBackHeader title="Şoför Bilgileri" subtitle="Doğrulama ve operasyon profiliniz" onBack={onBack} />
    <SectionCard title="Şoför profili" icon="shield-checkmark-outline" action={<Badge label={status.label} tone={status.tone} />}>
      <DetailRow icon="star-outline" label="Puan" value={driver.rating > 0 ? Number(driver.rating).toFixed(1) : 'Henüz puan yok'} />
      <DetailRow icon="checkmark-done-outline" label="Tamamlanan iş" value={String(driver.completedJobs || 0)} />
      <DetailRow icon="map-outline" label="Hizmet bölgesi" value={driver.serviceArea || 'Belirtilmedi'} />
      <DetailRow icon="card-outline" label="Ehliyet durumu" value={verification(driver.licenseStatus).label} />
      <DetailRow icon="person-circle-outline" label="Hesap durumu" value={account.accountStatus === 'blocked' ? 'Engellendi' : 'Aktif'} />
    </SectionCard>
  </>;
}

function DocumentsPage({ items, loading, error, retry, onBack, onOpen, onUpload, uploadingKind }) {
  return <>
    <AccountBackHeader title="Belgelerim" subtitle="Şoför doğrulama ve operasyon belgeleri" onBack={onBack} />
    <View style={styles.docNotice}>
      <Icon name="information-circle" size={20} color={colors.primary} />
      <Text style={styles.docNoticeText}>Şoför hesabınızın onaylanması ve iş alabilmeniz için aşağıdaki belgeleri eksiksiz ve okunaklı yükleyin.</Text>
    </View>
    {loading && !items.length ? <ListSkeleton count={4} /> : error && !items.length ? <ScreenState type="error" title="Belgeler yüklenemedi" message={error} onRetry={retry} /> : (
      DOCUMENT_DEFINITIONS.map(def => {
        const doc = matchDocument(items, def.kind);
        const meta = docStatusMeta(doc);
        const isUploading = uploadingKind === def.kind;
        return (
          <View key={def.kind} style={[styles.docCard, doc?.status === 'rejected' && styles.docCardRejected, doc?.status === 'verified' && styles.docCardVerified]}>
            <View style={styles.docCardHeader}>
              <View style={[styles.listIcon, doc?.status === 'verified' && styles.activeIcon, doc?.status === 'rejected' && styles.rejectedIcon]}>
                <Icon name={def.icon} size={22} color={doc?.status === 'verified' ? colors.white : doc?.status === 'rejected' ? colors.danger : colors.primary} />
              </View>
              <View style={styles.listCopy}>
                <Text style={styles.docTitle}>{def.title}</Text>
                <Text style={styles.docSubtitle}>{def.subtitle}</Text>
                {doc?.createdAt ? <Text style={styles.docDate}>Son yükleme: {new Date(doc.updatedAt || doc.createdAt).toLocaleDateString('tr-TR')}</Text> : null}
              </View>
              <Badge label={meta.label} tone={meta.tone} />
            </View>

            {doc?.status === 'rejected' ? (
              <View style={styles.rejectionBox}>
                <View style={styles.rejectionHeader}>
                  <Icon name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.rejectionTitle}>Red Gerekçesi</Text>
                </View>
                <Text style={styles.rejectionText}>{doc.reviewNote || 'Belgeniz onaylanmadı. Lütfen geçerli ve net bir fotoğraf yükleyin.'}</Text>
              </View>
            ) : null}

            <View style={styles.docActions}>
              {!doc ? (
                <AppButton
                  label="Belge Yükle"
                  icon="cloud-upload-outline"
                  variant="primary"
                  loading={isUploading}
                  onPress={() => onUpload(def, null)}
                />
              ) : doc.status === 'rejected' ? (
                <AppButton
                  label="Tekrar Yükle"
                  icon="reload-outline"
                  variant="danger"
                  loading={isUploading}
                  onPress={() => onUpload(def, doc)}
                />
              ) : (
                <View style={styles.docButtonRow}>
                  <AppButton
                    label="Görüntüle"
                    icon="eye-outline"
                    variant="outline"
                    compact
                    fullWidth={false}
                    style={styles.docHalfBtn}
                    onPress={() => onOpen(doc, def)}
                  />
                  <AppButton
                    label="Değiştir"
                    icon="camera-outline"
                    variant="secondary"
                    compact
                    fullWidth={false}
                    loading={isUploading}
                    style={styles.docHalfBtn}
                    onPress={() => onUpload(def, doc)}
                  />
                </View>
              )}
            </View>
          </View>
        );
      })
    )}
  </>;
}

function DocumentDetailPage({ document, docDef, onBack, onUpload, isUploading }) {
  if (!document) return <ScreenState type="error" title="Belge bulunamadı" message="Belge detayına ulaşılamadı." onRetry={onBack} />;
  const meta = docStatusMeta(document);
  const photo = resolveMediaUrl(document.fileUrl);
  return <>
    <AccountBackHeader title={document.title || docDef?.title || 'Belge Detayı'} subtitle={docDef?.subtitle || 'Yüklenen belge ve onay durumu'} onBack={onBack} />
    <SectionCard title={document.title || docDef?.title || 'Belge'} icon={docDef?.icon || 'document-text-outline'} action={<Badge label={meta.label} tone={meta.tone} />}>
      {photo ? (
        <View style={styles.imagePreviewContainer}>
          <Image source={{ uri: photo }} style={styles.documentImageLarge} resizeMode="contain" />
        </View>
      ) : (
        <View style={styles.imagePlaceholder}>
          <Icon name="image-outline" size={44} color={colors.textMuted} />
          <Text style={styles.imagePlaceholderText}>Belge görseli bulunamadı</Text>
        </View>
      )}

      {document.status === 'rejected' ? (
        <View style={styles.rejectionBoxDetail}>
          <View style={styles.rejectionHeader}>
            <Icon name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.rejectionTitle}>Admin Ret Gerekçesi</Text>
          </View>
          <Text style={styles.rejectionText}>{document.reviewNote || 'Belgeniz onaylanmadı. Lütfen geçerli ve okunaklı bir fotoğraf yükleyin.'}</Text>
        </View>
      ) : null}

      <DetailRow icon="albums-outline" label="Belge türü" value={docDef?.title || document.title || document.kind} />
      <DetailRow icon="calendar-outline" label="İlk yükleme" value={document.createdAt ? new Date(document.createdAt).toLocaleString('tr-TR') : '—'} />
      {document.updatedAt && document.updatedAt !== document.createdAt ? (
        <DetailRow icon="time-outline" label="Son güncelleme" value={new Date(document.updatedAt).toLocaleString('tr-TR')} />
      ) : null}
      <DetailRow icon="shield-checkmark-outline" label="Onay durumu" value={meta.label} />
      {document.reviewedAt ? (
        <DetailRow icon="person-outline" label="İnceleme tarihi" value={new Date(document.reviewedAt).toLocaleString('tr-TR')} />
      ) : null}

      <AppButton
        label={document.status === 'rejected' ? 'Tekrar Yükle' : 'Belgeyi Değiştir / Yeniden Yükle'}
        variant={document.status === 'rejected' ? 'danger' : 'primary'}
        icon="cloud-upload-outline"
        loading={isUploading}
        onPress={() => onUpload(docDef || { kind: document.kind, title: document.title }, document)}
        style={styles.cardAction}
      />
    </SectionCard>
  </>;
}

function VehicleFormPage({ title, form, setForm, loading, onSave, onBack }) {
  const { showToast } = useToast();
  const choosePhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('Araç fotoğrafı seçmek için galeri izni verin.', { type: 'error' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      const asset = result.assets?.[0];
      if (result.canceled) return;
      if (!asset?.uri || (asset.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType))) {
        showToast('Yalnızca JPEG, PNG veya WEBP fotoğraf seçilebilir.', { type: 'error' });
        return;
      }
      setForm(current => ({ ...current, photoAsset: asset }));
    } catch {
      showToast('Araç fotoğrafı seçilemedi.', { type: 'error' });
    }
  };
  const preview = form.photoAsset?.uri || resolveMediaUrl(form.photoUrl);
  return <>
    <AccountBackHeader title={title} subtitle="Araç bilgileri mevcut araç sistemine kaydedilir" onBack={onBack} />
    <SectionCard title="Araç bilgileri" icon="car-sport-outline">
      <SearchableSelect label="Araç tipi" required value={form.vehicleType} options={VEHICLE_TYPE_OPTIONS.filter(option => option.value !== 'farketmez')} onChange={value => setForm(current => ({ ...current, vehicleType: value }))} searchPlaceholder="Araç tipi ara" />
      <TextField label="Marka" required value={form.brand} onChangeText={value => setForm(current => ({ ...current, brand: value }))} leftIcon="car-outline" />
      <TextField label="Model" required value={form.model} onChangeText={value => setForm(current => ({ ...current, model: value }))} leftIcon="car-outline" />
      <TextField label="Plaka" required value={form.licensePlate} onChangeText={value => setForm(current => ({ ...current, licensePlate: value.toLocaleUpperCase('tr-TR') }))} leftIcon="card-outline" autoCapitalize="characters" />
      <TextField label="Kapasite (kg)" required value={form.capacityKg} onChangeText={value => setForm(current => ({ ...current, capacityKg: value }))} keyboardType="decimal-pad" leftIcon="scale-outline" />
      <View style={styles.fieldRow}><TextField containerStyle={styles.flexField} label="Uzunluk (cm)" value={form.lengthCm} onChangeText={value => setForm(current => ({ ...current, lengthCm: value }))} keyboardType="decimal-pad" /><TextField containerStyle={styles.flexField} label="Genişlik (cm)" value={form.widthCm} onChangeText={value => setForm(current => ({ ...current, widthCm: value }))} keyboardType="decimal-pad" /></View>
      <TextField label="Yükseklik (cm)" value={form.heightCm} onChangeText={value => setForm(current => ({ ...current, heightCm: value }))} keyboardType="decimal-pad" />
      <AppButton label="Araç fotoğrafı seç" variant="secondary" icon="images-outline" onPress={choosePhoto} style={styles.cardAction} />
      {preview ? <Image source={{ uri: preview }} style={styles.vehiclePreview} /> : null}
      <AppButton label="Kaydet" icon="save-outline" loading={loading} onPress={onSave} style={styles.cardAction} />
    </SectionCard>
  </>;
}

function VehiclesPage({ items, loading, error, retry, onBack, onOpen, onAdd }) {
  return <>
    <AccountBackHeader title="Araçlarım" subtitle="Kayıtlı araçlar ve aktif araç seçimi" onBack={onBack} />
    <AppButton label="Araç Ekle" icon="add-circle-outline" onPress={onAdd} style={styles.topAction} />
    {loading && !items.length ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Araçlar yüklenemedi" message={error} onRetry={retry} /> : !items.length ? <ScreenState title="Kayıtlı araç yok" message="Yeni araç ekleyerek şoför profilinizi tamamlayın." /> : items.map(vehicle => <Pressable key={vehicle.id} accessibilityRole="button" onPress={() => onOpen(vehicle)} style={({ pressed }) => [styles.vehicleCard, vehicle.isActive && styles.vehicleCardActive, pressed && styles.pressed]}>
      <View style={styles.vehicleCardTop}><View style={[styles.listIcon, vehicle.isActive && styles.activeIcon]}><Icon name="car-sport-outline" size={22} color={vehicle.isActive ? colors.white : colors.primary} /></View><View style={styles.listCopy}><Text style={styles.listTitle}>{vehicle.brand} {vehicle.model}</Text><Text style={styles.listMeta}>{vehicleTypeLabel(vehicle.vehicleType)} · {vehicle.licensePlate}</Text></View>{vehicle.isActive ? <Badge label="Aktif araç" tone="success" /> : null}<Icon name="chevron-forward" size={18} color={colors.textMuted} /></View>
    </Pressable>)}
  </>;
}

function VehicleDetailPage({ vehicle, loading, onBack, onEdit, onActivate }) {
  if (!vehicle) return <ScreenState type="error" title="Araç bulunamadı" message="Araç detayına ulaşılamadı." onRetry={onBack} />;
  const status = verification(vehicle.verificationStatus);
  const photo = resolveMediaUrl(vehicle.photoUrl);
  return <>
    <AccountBackHeader title="Araç Detayı" onBack={onBack} />
    <SectionCard title={`${vehicle.brand} ${vehicle.model}`} icon="car-sport-outline" action={vehicle.isActive ? <Badge label="Aktif araç" tone="success" /> : <Badge label={status.label} tone={status.tone} />}>
      {photo ? <Image source={{ uri: photo }} style={styles.vehicleDetailImage} /> : null}
      <DetailRow icon="car-outline" label="Araç tipi" value={vehicleTypeLabel(vehicle.vehicleType)} />
      <DetailRow icon="card-outline" label="Plaka" value={vehicle.licensePlate} />
      <DetailRow icon="scale-outline" label="Kapasite" value={`${vehicle.capacityKg || 0} kg`} />
      <DetailRow icon="cube-outline" label="Kasa ölçüleri" value={`${vehicle.lengthCm || 0} × ${vehicle.widthCm || 0} × ${vehicle.heightCm || 0} cm`} />
      <DetailRow icon="shield-checkmark-outline" label="Doğrulama" value={status.label} />
      <AppButton label="Düzenle" variant="secondary" icon="create-outline" onPress={onEdit} style={styles.cardAction} />
      {!vehicle.isActive ? <AppButton label="Aktif Araç Yap" icon="checkmark-circle-outline" loading={loading} onPress={onActivate} style={styles.cardAction} /> : null}
    </SectionCard>
  </>;
}

export default function DriverAccountScreens({ page, onPageChange, loading, error, account, form, setForm, save, saveLoading, changePassword, passwordLoading, logout, retry, onOpenLoad, onPermissionGranted, notificationSaving, onNotificationChange }) {
  const { showToast } = useToast();
  const [documentsState, setDocumentsState] = useState({ items: [], loading: false, error: '' });
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [selectedDocDef, setSelectedDocDef] = useState(null);
  const [pickerTarget, setPickerTarget] = useState(null);
  const [uploadingKind, setUploadingKind] = useState(null);
  const [vehiclesState, setVehiclesState] = useState({ items: [], loading: false, error: '' });
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleActivating, setVehicleActivating] = useState(false);
  const [accountJobs, setAccountJobs] = useState([]);
  const [jobsState, setJobsState] = useState({ loading: false, error: '' });
  const [tickets, setTickets] = useState([]);
  const [ticketsState, setTicketsState] = useState({ loading: false, error: '' });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [supportForm, setSupportForm] = useState(initialSupportForm);
  const [supportSaving, setSupportSaving] = useState(false);

  useAccountBack(page, onPageChange, backPage);

  const fetchDocuments = useCallback(async () => {
    setDocumentsState(current => ({ ...current, loading: true, error: '' }));
    try {
      const { data } = await documents.list();
      const items = data.items || [];
      setDocumentsState({ items, loading: false, error: '' });
      return items;
    } catch (documentError) {
      setDocumentsState(current => ({ ...current, loading: false, error: apiError(documentError) }));
      return [];
    }
  }, []);
  const fetchVehicles = useCallback(async () => {
    setVehiclesState(current => ({ ...current, loading: true, error: '' }));
    try { const { data } = await vehicles.list(); setVehiclesState({ items: data.items || [], loading: false, error: '' }); }
    catch (vehicleError) { setVehiclesState(current => ({ ...current, loading: false, error: apiError(vehicleError) })); }
  }, []);
  const fetchJobs = useCallback(async () => {
    setJobsState({ loading: true, error: '' });
    try { const { data } = await loads.list({ limit: 100 }); setAccountJobs((data.items || []).filter(load => load.assignedDriverId === account?.id)); setJobsState({ loading: false, error: '' }); }
    catch (jobError) { setJobsState({ loading: false, error: apiError(jobError) }); }
  }, [account?.id]);
  const fetchTickets = useCallback(async () => {
    setTicketsState({ loading: true, error: '' });
    try { const { data } = await support.list(); setTickets(data.items || []); setTicketsState({ loading: false, error: '' }); }
    catch (ticketError) { setTicketsState({ loading: false, error: apiError(ticketError) }); }
  }, []);

  useEffect(() => {
    if (page === 'documents') void fetchDocuments();
    if (page === 'vehicles') void fetchVehicles();
    if (['active-jobs', 'completed-jobs', 'support-new'].includes(page)) void fetchJobs();
    if (page === 'support') void fetchTickets();
  }, [fetchDocuments, fetchJobs, fetchTickets, fetchVehicles, page]);
  useEffect(() => {
    if (page !== 'password') setForm(current => current.currentPassword || current.newPassword || current.newPasswordConfirm ? { ...current, currentPassword: '', newPassword: '', newPasswordConfirm: '' } : current);
  }, [page, setForm]);

  if (loading && !account) return <ListSkeleton count={3} />;
  if (error || !account) return <ScreenState type="error" title="Hesap yüklenemedi" message={error || 'Profil bulunamadı.'} onRetry={retry} />;

  const openDocument = async (document, docDef) => {
    setSelectedDocument(document);
    setSelectedDocDef(docDef || DOCUMENT_DEFINITIONS.find(d => d.kind === document.kind) || null);
    onPageChange('document-detail');
    try {
      const { data } = await documents.get(document.id);
      setSelectedDocument(data);
    } catch (documentError) {
      showToast(apiError(documentError), { type: 'error', title: 'Belge açılamadı' });
    }
  };

  const startDocumentUpload = (docDef, existingDoc) => {
    setPickerTarget({ def: docDef, existingDoc });
  };

  const handleDocumentPick = async mode => {
    const target = pickerTarget;
    setPickerTarget(null);
    if (!target?.def) return;
    const def = target.def;
    try {
      let result;
      if (mode === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          showToast('Belge fotoğrafı çekmek için kamera izni vermeniz gerekir.', { type: 'error' });
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsEditing: true,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          showToast('Belge fotoğrafı seçmek için galeri izni vermeniz gerekir.', { type: 'error' });
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsEditing: true,
        });
      }

      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      if (asset.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)) {
        showToast('Yalnızca JPEG, PNG veya WEBP fotoğraf yüklenebilir.', { type: 'error' });
        return;
      }

      setUploadingKind(def.kind);
      const uploadRes = await media.photo(asset);
      const fileUrl = uploadRes.data?.url;
      if (!fileUrl) throw new Error('Dosya sunucuya yüklenemedi.');

      const { data: savedDoc } = await documents.create({
        kind: def.kind,
        title: def.title,
        fileUrl,
      });

      const updatedItems = await fetchDocuments();
      if (selectedDocument && (selectedDocument.kind === def.kind || selectedDocument.id === savedDoc.id)) {
        const fresh = updatedItems.find(d => d.id === savedDoc.id || d.kind === def.kind) || savedDoc;
        setSelectedDocument(fresh);
      }
      showToast(`${def.title} belgeniz başarıyla yüklendi ve onaya gönderildi.`, { type: 'success', title: 'Belge Yüklendi' });
    } catch (uploadError) {
      showToast(apiError(uploadError), { type: 'error', title: 'Belge yüklenemedi' });
    } finally {
      setUploadingKind(null);
    }
  };

  const openVehicle = vehicle => { setSelectedVehicle(vehicle); onPageChange('vehicle-detail'); };
  const startVehicleForm = vehicle => {
    setVehicleForm(vehicle ? { vehicleType: vehicle.vehicleType || '', brand: vehicle.brand || '', model: vehicle.model || '', licensePlate: vehicle.licensePlate || '', capacityKg: String(vehicle.capacityKg || ''), lengthCm: String(vehicle.lengthCm || ''), widthCm: String(vehicle.widthCm || ''), heightCm: String(vehicle.heightCm || ''), photoUrl: vehicle.photoUrl || '', photoAsset: null } : emptyVehicleForm());
    onPageChange(vehicle ? 'vehicle-edit' : 'vehicle-add');
  };
  const saveVehicle = async () => {
    if (!vehicleForm.vehicleType || !vehicleForm.brand.trim() || !vehicleForm.model.trim() || !vehicleForm.licensePlate.trim() || toFiniteNumber(vehicleForm.capacityKg) <= 0) {
      showToast('Araç tipi, marka, model, plaka ve kapasite zorunludur.', { type: 'error', title: 'Eksik araç bilgisi' });
      return;
    }
    setVehicleSaving(true);
    try {
      let photoUrl = vehicleForm.photoUrl;
      if (vehicleForm.photoAsset) photoUrl = (await media.photo(vehicleForm.photoAsset)).data.url;
      const payload = { vehicleType: vehicleForm.vehicleType, brand: vehicleForm.brand.trim(), model: vehicleForm.model.trim(), licensePlate: vehicleForm.licensePlate.trim(), capacityKg: toFiniteNumber(vehicleForm.capacityKg), lengthCm: toFiniteNumber(vehicleForm.lengthCm), widthCm: toFiniteNumber(vehicleForm.widthCm), heightCm: toFiniteNumber(vehicleForm.heightCm), photoUrl };
      const { data } = page === 'vehicle-edit' ? await vehicles.update(selectedVehicle.id, payload) : await vehicles.create(payload);
      await fetchVehicles();
      setSelectedVehicle(data);
      onPageChange(page === 'vehicle-edit' ? 'vehicle-detail' : 'vehicles');
      showToast('Araç bilgileri kaydedildi.', { type: 'success' });
    } catch (vehicleError) { showToast(apiError(vehicleError), { type: 'error', title: 'Araç kaydedilemedi' }); }
    finally { setVehicleSaving(false); }
  };
  const activateVehicle = async () => {
    setVehicleActivating(true);
    try { const { data } = await vehicles.activate(selectedVehicle.id); setSelectedVehicle(data); await fetchVehicles(); showToast('Aktif araç güncellendi.', { type: 'success' }); }
    catch (vehicleError) { showToast(apiError(vehicleError), { type: 'error', title: 'Araç etkinleştirilemedi' }); }
    finally { setVehicleActivating(false); }
  };
  const submitSupport = async () => {
    if (!supportForm.subject.trim() || !supportForm.description.trim() || (supportForm.type === 'complaint' && !supportForm.reason)) {
      showToast('Konu, açıklama ve şikâyet sebebini kontrol edin.', { type: 'error', title: 'Eksik bilgi' }); return;
    }
    setSupportSaving(true);
    try { await support.create({ ...supportForm, subject: supportForm.subject.trim(), description: supportForm.description.trim() }); setSupportForm(initialSupportForm()); await fetchTickets(); onPageChange('support'); showToast('Bildiriminiz destek ekibine iletildi.', { type: 'success' }); }
    catch (ticketError) { showToast(apiError(ticketError), { type: 'error', title: 'Bildirim gönderilemedi' }); }
    finally { setSupportSaving(false); }
  };
  const openTicket = async item => {
    setSelectedTicket(item); onPageChange('support-detail');
    try { const { data } = await support.get((item.complaint || item).id); setSelectedTicket(data); }
    catch (ticketError) { showToast(apiError(ticketError), { type: 'error', title: 'Bildirim açılamadı' }); }
  };

  const renderCurrentPage = () => {
    if (page === 'wallet') return <DriverWalletScreen onBack={() => onPageChange('home')} />;
    if (page === 'personal') return <PersonalInfoPage account={account} onBack={() => onPageChange('home')} onEdit={() => { setForm(current => ({ ...current, name: account.name || '', email: account.email || '', phone: account.phone || '' })); onPageChange('profile-edit'); }} />;
    if (page === 'profile-edit') return <ProfileEditPage form={form} setForm={setForm} loading={saveLoading} onSave={async () => { if (await save()) onPageChange('personal'); }} onCancel={() => onPageChange('personal')} />;
    if (page === 'password') return <PasswordPage form={form} setForm={setForm} loading={passwordLoading} onSubmit={changePassword} onBack={() => onPageChange('home')} />;
    if (page === 'driver-info') return <DriverInfoPage account={account} onBack={() => onPageChange('home')} />;
    if (page === 'documents') return <DocumentsPage items={documentsState.items} loading={documentsState.loading} error={documentsState.error} retry={fetchDocuments} onBack={() => onPageChange('home')} onOpen={openDocument} onUpload={startDocumentUpload} uploadingKind={uploadingKind} />;
    if (page === 'document-detail') return <DocumentDetailPage document={selectedDocument} docDef={selectedDocDef} onBack={() => onPageChange('documents')} onUpload={startDocumentUpload} isUploading={uploadingKind === selectedDocDef?.kind} />;
    if (page === 'vehicles') return <VehiclesPage items={vehiclesState.items} loading={vehiclesState.loading} error={vehiclesState.error} retry={fetchVehicles} onBack={() => onPageChange('home')} onOpen={openVehicle} onAdd={() => startVehicleForm(null)} />;
    if (page === 'vehicle-detail') return <VehicleDetailPage vehicle={selectedVehicle} loading={vehicleActivating} onBack={() => onPageChange('vehicles')} onEdit={() => startVehicleForm(selectedVehicle)} onActivate={activateVehicle} />;
    if (page === 'vehicle-edit') return <VehicleFormPage title="Araç Düzenle" form={vehicleForm} setForm={setVehicleForm} loading={vehicleSaving} onSave={saveVehicle} onBack={() => onPageChange('vehicle-detail')} />;
    if (page === 'vehicle-add') return <VehicleFormPage title="Araç Ekle" form={vehicleForm} setForm={setVehicleForm} loading={vehicleSaving} onSave={saveVehicle} onBack={() => onPageChange('vehicles')} />;
    if (page === 'active-jobs') return <AccountJobsPage title="Aktif İşlerim" subtitle="Size atanmış devam eden nakliyeler" items={accountJobs.filter(load => !['completed', 'cancelled'].includes(load.status))} loading={jobsState.loading} error={jobsState.error} onRetry={fetchJobs} onBack={() => onPageChange('home')} onOpen={onOpenLoad} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} emptyMessage="Aktif işiniz bulunmuyor." />;
    if (page === 'completed-jobs') return <AccountJobsPage title="Tamamlanan İşler" subtitle="Başarıyla tamamladığınız nakliyeler" items={accountJobs.filter(load => load.status === 'completed')} loading={jobsState.loading} error={jobsState.error} onRetry={fetchJobs} onBack={() => onPageChange('home')} onOpen={onOpenLoad} statusLabel={loadStatusLabel} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} emptyMessage="Tamamlanan işiniz bulunmuyor." />;
    if (page === 'support') return <SupportListPage items={tickets} loading={ticketsState.loading} error={ticketsState.error} onRetry={fetchTickets} onBack={() => onPageChange('home')} onNew={() => { setSupportForm(initialSupportForm()); onPageChange('support-new'); }} onOpen={openTicket} />;
    if (page === 'support-new') return <SupportNewPage form={supportForm} setForm={setSupportForm} loads={accountJobs} loading={supportSaving} onSubmit={submitSupport} onBack={() => onPageChange('support')} />;
    if (page === 'support-detail') return <SupportDetailPage item={selectedTicket} onBack={() => onPageChange('support')} />;
    if (page === 'notifications') return <DeviceNotificationsPage onBack={() => onPageChange('home')} onPermissionGranted={onPermissionGranted}><SectionCard title="Yakındaki iş bildirimleri" icon="navigate-outline"><View style={styles.notificationRow}><View style={styles.notificationCopy}><Text style={styles.notificationTitle}>Yeni uygun ilanlar</Text><Text style={styles.notificationText}>Yakınınızdaki uygun işler yayınlandığında bildirim alın.</Text></View><Switch disabled={notificationSaving} value={Boolean(account.driverProfile?.nearbyLoadNotifications)} onValueChange={onNotificationChange} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={account.driverProfile?.nearbyLoadNotifications ? colors.primary : colors.textMuted} /></View></SectionCard></DeviceNotificationsPage>;
    if (page === 'privacy') return <LegalPage type="privacy" onBack={() => onPageChange('home')} />;
    if (page === 'terms') return <LegalPage type="terms" onBack={() => onPageChange('home')} />;

    const driver = account.driverProfile || {};
    const status = verification(driver.verificationStatus || driver.licenseStatus);
    return <>
      <AccountProfileCard account={account} roleLabel="Şoför hesabı" meta={`Doğrulama: ${status.label}`} stats={[{ label: 'Puan', value: driver.rating > 0 ? Number(driver.rating).toFixed(1) : '—' }, { label: 'Tamamlanan iş', value: String(driver.completedJobs || 0) }]} />
      <AccountMenuSection title="Profil">
        <AccountMenuItem icon="person-outline" label="Kişisel Bilgiler" onPress={() => onPageChange('personal')} />
        <AccountMenuItem icon="shield-checkmark-outline" label="Şoför Bilgileri" badge={status} onPress={() => onPageChange('driver-info')} />
        <AccountMenuItem icon="documents-outline" label="Belgelerim" onPress={() => onPageChange('documents')} />
        <AccountMenuItem icon="lock-closed-outline" label="Şifre Değiştir" last onPress={() => onPageChange('password')} />
      </AccountMenuSection>
      <AccountMenuSection title="Araç">
        <AccountMenuItem icon="car-sport-outline" label="Araçlarım" onPress={() => onPageChange('vehicles')} />
        <AccountMenuItem icon="add-circle-outline" label="Araç Ekle" last onPress={() => startVehicleForm(null)} />
      </AccountMenuSection>
      <AccountMenuSection title="Cüzdan"><AccountMenuItem icon="wallet-outline" label="Cüzdanım" last onPress={() => onPageChange('wallet')} /></AccountMenuSection>
      <AccountMenuSection title="İşler">
        <AccountMenuItem icon="navigate-outline" label="Aktif İşlerim" onPress={() => onPageChange('active-jobs')} />
        <AccountMenuItem icon="checkmark-done-outline" label="Tamamlanan İşler" last onPress={() => onPageChange('completed-jobs')} />
      </AccountMenuSection>
      <AccountMenuSection title="Destek"><AccountMenuItem icon="chatbox-ellipses-outline" label="Şikâyet ve Öneri" last onPress={() => onPageChange('support')} /></AccountMenuSection>
      <AccountMenuSection title="Uygulama">
        <AccountMenuItem icon="notifications-outline" label="Bildirim Ayarları" onPress={() => onPageChange('notifications')} />
        <AccountMenuItem icon="shield-checkmark-outline" label="Gizlilik Politikası" onPress={() => onPageChange('privacy')} />
        <AccountMenuItem icon="document-text-outline" label="Kullanım Koşulları" last onPress={() => onPageChange('terms')} />
      </AccountMenuSection>
      <AccountMenuSection title="Oturum"><AccountMenuItem icon="log-out-outline" label="Çıkış Yap" danger last onPress={logout} /></AccountMenuSection>
    </>;
  };

  return <>
    {renderCurrentPage()}
    <ActionSheet
      visible={Boolean(pickerTarget)}
      title={`${pickerTarget?.def?.title || 'Belge'} Yükle`}
      message="Belgenin tüm köşelerinin net ve yazıların okunaklı olduğundan emin olun."
      options={[
        {
          label: 'Fotoğraf Çek',
          description: 'Kamera ile belgenin fotoğrafını çekin',
          icon: 'camera-outline',
          onPress: () => handleDocumentPick('camera'),
        },
        {
          label: 'Galeriden Seç',
          description: 'Cihazınızdaki fotoğraflardan seçin',
          icon: 'images-outline',
          onPress: () => handleDocumentPick('gallery'),
        },
      ]}
      onClose={() => setPickerTarget(null)}
    />
  </>;
}

const styles = StyleSheet.create({
  listCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.md },
  listIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 42, justifyContent: 'center', width: 42 },
  activeIcon: { backgroundColor: colors.primary },
  rejectedIcon: { backgroundColor: colors.dangerSoft },
  listCopy: { flex: 1 },
  listTitle: { ...typography.bodyMedium, color: colors.ink },
  listMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  docNotice: { alignItems: 'center', backgroundColor: colors.primarySoft, borderColor: colors.primary, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, padding: spacing.md },
  docNoticeText: { ...typography.small, color: colors.primaryDark, flex: 1 },
  docCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.md },
  docCardRejected: { backgroundColor: '#FFFBFB', borderColor: colors.danger },
  docCardVerified: { backgroundColor: colors.surface, borderColor: colors.success },
  docCardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  docTitle: { ...typography.bodyMedium, color: colors.ink, fontWeight: '700' },
  docSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  docDate: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  rejectionBox: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, padding: spacing.sm },
  rejectionBoxDetail: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.md, padding: spacing.md },
  rejectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginBottom: 3 },
  rejectionTitle: { ...typography.smallMedium, color: colors.danger, fontWeight: '700' },
  rejectionText: { ...typography.small, color: colors.dangerDark || colors.danger },
  docActions: { marginTop: spacing.sm },
  docButtonRow: { flexDirection: 'row', gap: spacing.sm },
  docHalfBtn: { flex: 1 },
  documentImage: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, height: 220, marginBottom: spacing.md, width: '100%' },
  imagePreviewContainer: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, justifyContent: 'center', marginBottom: spacing.md, overflow: 'hidden' },
  documentImageLarge: { backgroundColor: colors.surfaceMuted, height: 250, width: '100%' },
  imagePlaceholder: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, height: 160, justifyContent: 'center', marginBottom: spacing.md, width: '100%' },
  imagePlaceholderText: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },
  flexField: { flex: 1 },
  cardAction: { marginTop: spacing.md },
  topAction: { marginBottom: spacing.md },
  vehiclePreview: { borderRadius: radius.md, height: 160, marginTop: spacing.md, width: '100%' },
  vehicleCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.sm, padding: spacing.md },
  vehicleCardActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  vehicleCardTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  vehicleDetailImage: { borderRadius: radius.md, height: 190, marginBottom: spacing.md, width: '100%' },
  notificationRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  notificationCopy: { flex: 1 },
  notificationTitle: { ...typography.bodyMedium, color: colors.text },
  notificationText: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  pressed: { opacity: .72 },
});
