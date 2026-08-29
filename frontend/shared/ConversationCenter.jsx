import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapAdapter from './maps/MapAdapter';
import MapUnavailable from './maps/MapUnavailable';
import Icon from './ui/Icon';
import { ActionSheet, ConfirmationModal, useToast } from './ui/feedback';
import { Badge, ScreenState } from './ui/primitives';
import { colors, radius, shadows, spacing, typography } from './ui/theme';

const { canSendMessage, draftAfterSendAttempt, normalizeMessageDraft } = require('./conversationComposer.cjs');

const LIST_POLL_MS = 15000;
const CHAT_POLL_MS = 5000;
const PAGE_SIZE = 30;
const ISTANBUL = 'Europe/Istanbul';
const COMPLAINT_REASONS = [
  ['payment_dispute', 'Ödeme anlaşmazlığı'], ['behavior', 'Davranış'], ['damage', 'Hasar'],
  ['no_show', 'Gelmeme'], ['incorrect_load_info', 'Yanlış yük bilgisi'], ['safety', 'Güvenlik'], ['other', 'Diğer'],
];

const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: ISTANBUL }).format(new Date(value));
const formatTime = value => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: ISTANBUL }).format(new Date(value));
const formatDate = value => {
  const date = new Date(value);
  const today = dateKey(new Date());
  const yesterday = dateKey(Date.now() - 86400000);
  if (dateKey(date) === today) return 'Bugün';
  if (dateKey(date) === yesterday) return 'Dün';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ISTANBUL }).format(date);
};
const messagePreview = message => ({ image: 'Fotoğraf gönderdi', location: 'Konum paylaştı', offer: 'Teklif gönderdi', load: 'İlan bilgisi paylaştı' }[message.type] || message.body || 'Mesaj');
const mergeByID = (current, incoming) => {
  const map = new Map(current.map(item => [item.id, item]));
  const clientIDs = new Map(current.filter(item => item.clientMessageId).map(item => [item.clientMessageId, item.id]));
  incoming.forEach(item => {
    const optimisticID = item.clientMessageId && clientIDs.get(item.clientMessageId);
    if (optimisticID && optimisticID !== item.id) map.delete(optimisticID);
    map.set(item.id, { ...map.get(item.id), ...item });
  });
  return [...map.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};
const newClientMessageID = () => `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const lastSeenLabel = value => {
  if (!value) return 'Son görülme bilgisi yok';
  const date = new Date(value);
  return `Son görülme ${formatDate(date)} ${formatTime(date)}`;
};

function EmptyState({ title, detail, retry }) {
  return <ScreenState title={title} message={detail} onRetry={retry} />;
}

const ConversationCard = memo(function ConversationCard({ item, onPress, loadStatusLabel }) {
  const initials = item.otherParty?.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  return <Pressable accessibilityLabel={`${item.otherParty?.name || 'Karşı taraf'}, ${item.pickupAddress || ''} - ${item.deliveryAddress || ''}`} style={styles.conversationCard} onPress={() => onPress(item)} accessibilityRole="button">
    <View style={styles.personAvatar}><Text style={styles.personAvatarText}>{initials}</Text></View>
    <View style={styles.conversationBody}>
      <View style={styles.conversationTop}><Text style={styles.personName} numberOfLines={1}>{item.otherParty?.name || 'Karşı taraf'}</Text><Text style={styles.conversationTime}>{item.lastMessageAt ? formatTime(item.lastMessageAt) : ''}</Text></View>
      <View style={styles.routeRow}><Icon name="navigate-outline" size={14} color={colors.textMuted} /><Text style={styles.route} numberOfLines={1}>{item.pickupAddress} → {item.deliveryAddress}</Text></View>
      <View style={styles.previewRow}><Text style={styles.preview} numberOfLines={1}>{item.lastMessage || 'Mesajlaşmayı başlatın'}</Text>{item.unreadCount ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View> : null}</View>
      <Badge label={loadStatusLabel(item.loadStatus)} tone={item.loadStatus === 'completed' ? 'success' : item.loadStatus === 'cancelled' ? 'danger' : 'primary'} />
    </View>
  </Pressable>;
});

const MessageBubble = memo(function MessageBubble({ item, previous, currentUserID, formatMoney, resolveMediaUrl, onActions, onFeedback, onPreviewImage, onOpenLoad }) {
  const mine = item.senderId === currentUserID;
  const showDate = !previous || dateKey(previous.createdAt) !== dateKey(item.createdAt);
  const deleted = Boolean(item.deletedAt);
  const openLocation = async () => {
    if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') return;
    const url = `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;
    try { await Linking.openURL(url); } catch { onFeedback('Konum bağlantısı açılamadı.', 'error'); }
  };
  const actions = () => {
    if (item.type === 'system' || deleted) return;
    onActions(item, mine);
  };
  if (item.type === 'system') return <>{showDate ? <DateSeparator value={item.createdAt} /> : null}<View style={styles.system}><Text style={styles.systemText}>{item.body}</Text></View></>;
  return <>
    {showDate ? <DateSeparator value={item.createdAt} /> : null}
    <Pressable onLongPress={actions} delayLongPress={350} style={[styles.messageRow, mine && styles.messageRowMine]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, deleted && styles.bubbleDeleted]}>
        {item.replyTo ? <View style={styles.replyQuote}><Text style={styles.replyAuthor}>{item.replyTo.senderId === currentUserID ? 'Siz' : item.replyTo.senderRole === 'driver' ? 'Şoför' : 'Müşteri'}</Text><Text style={styles.replyText} numberOfLines={1}>{item.replyTo.deletedAt ? 'Bu mesaj silindi.' : messagePreview(item.replyTo)}</Text></View> : null}
        {deleted ? <Text style={styles.deletedText}>Bu mesaj silindi.</Text> : <MessageContent item={item} mine={mine} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} onPreviewImage={onPreviewImage} onOpenLocation={openLocation} onOpenLoad={onOpenLoad} />}
        <View style={styles.meta}><Text style={[styles.messageTime, mine && styles.messageTimeMine]}>{formatTime(item.createdAt)}</Text>{mine ? <DeliveryState status={item.status} /> : null}</View>
      </View>
    </Pressable>
  </>;
});

function DateSeparator({ value }) { return <View style={styles.dateSeparator}><Text style={styles.dateText}>{formatDate(value)}</Text></View>; }
function DeliveryState({ status }) {
  if (status === 'failed') return <Icon name="alert-circle" size={13} color={colors.danger} />;
  if (status === 'sending' || status === 'pending') return <Icon name="time-outline" size={12} color="#D7EEE9" />;
  if (status === 'read') return <Icon name="checkmark-done" size={14} color="#9EDBCF" />;
  if (status === 'delivered') return <Icon name="checkmark-done" size={14} color="#D7EEE9" />;
  return <Icon name="checkmark" size={13} color="#D7EEE9" />;
}

function MessageContent({ item, mine, formatMoney, resolveMediaUrl, onPreviewImage, onOpenLocation, onOpenLoad }) {
  if (item.type === 'image') {
    const source = resolveMediaUrl(item.attachmentUrl);
    return <Pressable onPress={() => source && onPreviewImage(source)}>{source ? <Image source={{ uri: source, cache: 'force-cache' }} style={styles.messageImage} /> : <View style={styles.imageFallback}><Text>Görsel yüklenemedi</Text></View>}<Text style={styles.imageCaption}>{item.body || 'Fotoğraf'}</Text></Pressable>;
  }
  if (item.type === 'location') return <View style={styles.locationCard}><View style={styles.locationIcon}><Icon name="location" size={20} color={colors.primary} /></View><Text style={styles.locationTitle}>Konum paylaşıldı</Text><Text style={styles.locationAddress}>{item.locationAddress || `${item.latitude?.toFixed(5)}, ${item.longitude?.toFixed(5)}`}</Text><Pressable style={styles.mapLinkRow} onPress={onOpenLocation}><Text style={styles.mapLink}>Haritada aç</Text><Icon name="open-outline" size={15} color={colors.primary} /></Pressable></View>;
  if (item.type === 'offer') return <Pressable style={styles.offerMessage} onPress={onOpenLoad}><Text style={styles.offerEyebrow}>TEKLİF</Text><Text style={styles.offerPrice}>{formatMoney(item.offerAmountTl)}</Text><Text style={styles.offerDifference}>Tahmini fiyat: {formatMoney(item.offerBasePriceTl)}</Text>{item.offerNote ? <Text style={styles.offerNote}>{item.offerNote}</Text> : null}<Text style={styles.offerStatus}>{item.offerStatus === 'accepted' ? 'Kabul edildi' : item.offerStatus || 'Bekliyor'}</Text></Pressable>;
  if (item.type === 'load') return <Pressable style={styles.loadMessage} onPress={onOpenLoad}><Text style={styles.offerEyebrow}>İLAN BİLGİSİ</Text><Text style={styles.textMessage}>{item.body || 'İlan özetini görüntüle'}</Text></Pressable>;
  return <Text style={[styles.textMessage, mine && { color: colors.white }]}>{item.body}</Text>;
}

export default function ConversationCenter({ currentUser, api, apiError, resolveMediaUrl, formatMoney, loadStatusLabel, onOpenLoad, initialConversationId, onInitialConversationHandled, reverseGeocode, nativeMapsConfigured = true, nativeMapsMessage = 'Google haritası yüklenemedi. Harita anahtarı ve uygulama yapılandırmasını kontrol edin.', bottomInset = 0 }) {
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
	const [totalUnread, setTotalUnread] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [active, setActive] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewURI, setPreviewURI] = useState(null);
	const [mapPickerVisible, setMapPickerVisible] = useState(false);
	const [mapCoordinate, setMapCoordinate] = useState(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const [isActiveApp, setIsActiveApp] = useState(AppState.currentState === 'active');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [actionSheet, setActionSheet] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [complaint, setComplaint] = useState(null);
  const [complaintReason, setComplaintReason] = useState('');
  const [complaintDescription, setComplaintDescription] = useState('');
  const [complaintSending, setComplaintSending] = useState(false);
  const listBusy = useRef(false);
  const chatBusy = useRef(false);
	const sendBusy = useRef(false);
	const paginationInitialized = useRef(false);
  const listRef = useRef(null);
  const chatRef = useRef(null);
  const composerInputRef = useRef(null);
  const atBottomRef = useRef(true);
  const openedInitialConversation = useRef('');
  const selectedID = active?.id || active?.loadId;

  const loadConversations = useCallback(async (showSpinner = false, searchOverride = query) => {
    if (listBusy.current) return;
    listBusy.current = true;
    if (showSpinner) setListLoading(true);
    try {
      const { data } = await api.list({ q: searchOverride.trim(), filter: filter === 'all' ? '' : filter });
      setItems(data.items || []);
		setTotalUnread(Number(data.unreadCount || 0));
      setListError('');
    } catch (error) {
      setListError(apiError(error));
    } finally {
      listBusy.current = false;
      if (showSpinner) setListLoading(false);
    }
  }, [api, apiError, filter, query]);

  const loadMessages = useCallback(async (older = false) => {
    if (!selectedID || chatBusy.current || (older && !hasMore)) return;
    chatBusy.current = true;
    if (!older) setChatLoading(true);
    try {
      const { data } = await api.messages(selectedID, { limit: PAGE_SIZE, cursor: older ? nextCursor : undefined });
      const incoming = data.items || [];
      setChat(current => {
        const newIncoming = incoming.filter(message => !current.some(existing => existing.id === message.id) && message.senderId !== currentUser.id);
        if (!older && newIncoming.length && !atBottomRef.current) setUnseenCount(count => count + newIncoming.length);
        return mergeByID(current, incoming);
      });
		if (older || !paginationInitialized.current) {
			setNextCursor(data.nextCursor || '');
			setHasMore(Boolean(data.hasMore));
			paginationInitialized.current = true;
		}
      setChatError('');
      // Mark only the batch that has reached the device, never unseen history.
      if (!older && incoming.length) await api.read(selectedID, incoming.map(message => message.id));
      if (!older) void loadConversations(false);
    } catch (error) {
      if (!older) setChatError(apiError(error));
    } finally {
      chatBusy.current = false;
      if (!older) setChatLoading(false);
    }
  }, [api, apiError, currentUser.id, hasMore, loadConversations, nextCursor, selectedID]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setIsActiveApp(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSubscription.remove(); hideSubscription.remove(); };
  }, []);

  useEffect(() => { void loadConversations(true); }, [filter]);
  useEffect(() => {
    const timeout = setTimeout(() => void loadConversations(false, query), 350);
    return () => clearTimeout(timeout);
  }, [loadConversations, query]);
  useEffect(() => {
    if (active || !isActiveApp) return undefined;
    const interval = setInterval(() => void loadConversations(false), LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [active, isActiveApp, loadConversations]);
  useEffect(() => {
    if (!selectedID || !isActiveApp) return undefined;
    setChat([]); setNextCursor(''); setHasMore(false); setUnseenCount(0); paginationInitialized.current = false;
    void loadMessages(false);
    const interval = setInterval(() => void loadMessages(false), CHAT_POLL_MS);
    return () => clearInterval(interval);
  }, [isActiveApp, loadMessages, selectedID]);

  const openConversation = useCallback(async item => {
    setActive(item);
    setChatError('');
    try {
      const { data } = await api.get(item.id || item.loadId);
      if (data.conversation) setActive(data.conversation);
    } catch (error) {
      setChatError(apiError(error));
    }
  }, [api, apiError]);

  useEffect(() => {
    if (!initialConversationId || openedInitialConversation.current === initialConversationId) return;
    openedInitialConversation.current = initialConversationId;
    void openConversation({ id: initialConversationId, loadId: initialConversationId }).finally(() => onInitialConversationHandled?.());
  }, [initialConversationId, onInitialConversationHandled, openConversation]);

  const scrollToBottom = useCallback(() => {
    atBottomRef.current = true;
    setUnseenCount(0);
    requestAnimationFrame(() => chatRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const sendPayload = useCallback(async payload => {
    if (!selectedID || sendBusy.current) return { ok: false, skipped: true };
    sendBusy.current = true;
    setSending(true);
    const clientMessageId = payload.clientMessageId || newClientMessageID();
    const optimistic = { id: `local:${clientMessageId}`, loadId: selectedID, senderId: currentUser.id, senderRole: currentUser.role, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'sending', clientMessageId, ...payload };
    setChat(current => mergeByID(current, [optimistic]));
    scrollToBottom();
    try {
      const { data } = await api.send(selectedID, { ...payload, clientMessageId });
      setChat(current => mergeByID(current.filter(item => item.id !== optimistic.id), [data]));
      setReplyTo(current => current?.id && current.id === payload.replyToMessageId ? null : current);
      void loadConversations(false);
      return { ok: true, data };
    } catch (error) {
      setChat(current => current.map(item => item.id === optimistic.id ? { ...item, status: 'failed', sendError: apiError(error) } : item));
      return { ok: false, error };
    } finally {
      sendBusy.current = false;
      setSending(false);
    }
  }, [api, apiError, currentUser.id, currentUser.role, loadConversations, scrollToBottom, selectedID]);

  const sendText = useCallback(async () => {
    const body = normalizeMessageDraft(draft);
    if (!canSendMessage(body) || uploading || sending) return;
    const result = await sendPayload({ type: 'text', body, replyToMessageId: replyTo?.id || '' });
    setDraft(current => draftAfterSendAttempt(current, body, Boolean(result?.ok)));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [draft, replyTo, sendPayload, uploading, sending]);

  const retryMessage = useCallback(message => {
    if (message.status !== 'failed') return;
    const { id, status, sendError, createdAt, updatedAt, senderId, senderRole, loadId, ...payload } = message;
    setChat(current => current.filter(item => item.id !== message.id));
    void sendPayload(payload);
  }, [sendPayload]);

  const deleteMessage = useCallback(async message => {
    setConfirmationLoading(true);
    try {
      const { data } = await api.removeMessage(message.id);
      setChat(current => current.map(item => item.id === data.id ? data : item));
      setConfirmation(null);
      void loadConversations(false);
      showToast('Mesaj herkesten silindi.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Mesaj silinemedi' });
    } finally {
      setConfirmationLoading(false);
    }
  }, [api, apiError, loadConversations, showToast]);

  const pickPhoto = useCallback(async source => {
    try {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showToast('Fotoğraf göndermek için cihaz ayarlarından izin vermelisiniz.', { type: 'warning', title: 'Fotoğraf izni gerekli' }); return; }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) { showToast('En fazla 10 MB fotoğraf gönderebilirsiniz.', { type: 'warning', title: 'Fotoğraf çok büyük' }); return; }
      setAttachment(asset);
    } catch (error) {
      showToast('Fotoğraf seçilirken beklenmeyen bir hata oluştu.', { type: 'error' });
    }
  }, [showToast]);

  const choosePhoto = useCallback(() => setActionSheet({ type: 'photo' }), []);

  const sendAttachment = useCallback(async () => {
    if (!attachment || !selectedID || uploading) return;
    setUploading(true); setUploadProgress(0);
    try {
      const { data } = await api.attachment(selectedID, attachment, event => {
        if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      });
      setAttachment(null);
      await sendPayload({ type: 'image', attachmentUrl: data.url, attachmentMimeType: data.mimeType, body: '', replyToMessageId: replyTo?.id || '' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Fotoğraf gönderilemedi' });
    } finally { setUploading(false); setUploadProgress(0); }
  }, [api, apiError, attachment, replyTo, selectedID, sendPayload, showToast, uploading]);

  const shareCurrentLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') { showToast('Mevcut konumunuzu paylaşmak için cihaz ayarlarından konum izni vermelisiniz.', { type: 'warning', title: 'Konum izni gerekli' }); return; }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      const address = (await reverseGeocode?.(latitude, longitude))?.formattedAddress || '';
      setConfirmation({ type: 'location', message: address || 'Mevcut konumunuz karşı tarafla paylaşılacak.', payload: { type: 'location', latitude, longitude, locationAddress: address, replyToMessageId: replyTo?.id || '' } });
    } catch (error) { showToast(apiError(error), { type: 'error', title: 'Konum alınamadı' }); }
  }, [apiError, replyTo, reverseGeocode, showToast]);

	const openMapLocationPicker = useCallback(async () => {
		if (!nativeMapsConfigured) {
			showToast(nativeMapsMessage, { type: 'error', title: 'Google haritası yüklenemedi' });
			return;
		}
		let coordinate = null;
		const permission = await Location.requestForegroundPermissionsAsync();
		if (permission.status === 'granted') {
			try {
				const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
				coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
				} catch (error) {
					if (__DEV__) console.warn('[LOCATION PICKER] GPS fix unavailable.', { code: error?.code, message: error?.message });
				}
		}
		if (!coordinate) {
				showToast('Haritadan seçim yapabilmek için konum izni verin ve konum servislerini açın.', { type: 'warning', title: 'Konum alınamadı' });
			return;
		}
		setMapCoordinate(coordinate);
		setMapPickerVisible(true);
	}, [nativeMapsConfigured, nativeMapsMessage, showToast]);

	const sharePickedLocation = useCallback(async () => {
		if (!mapCoordinate) return;
		try {
			const address = (await reverseGeocode?.(mapCoordinate.latitude, mapCoordinate.longitude))?.formattedAddress || '';
			setMapPickerVisible(false);
			void sendPayload({ type: 'location', latitude: mapCoordinate.latitude, longitude: mapCoordinate.longitude, locationAddress: address, replyToMessageId: replyTo?.id || '' });
		} catch (error) { showToast(apiError(error), { type: 'error', title: 'Konum paylaşılamadı' }); }
	}, [apiError, mapCoordinate, replyTo, reverseGeocode, sendPayload, showToast]);

	const chooseLocation = useCallback(() => setActionSheet({ type: 'location' }), []);

  const openMessageActions = useCallback((message, mine) => setActionSheet({ type: 'message', message, mine }), []);
  const showMessageFeedback = useCallback((message, type = 'info') => showToast(message, { type }), [showToast]);
  const openComplaint = useCallback(message => {
    setComplaint(message || {});
    setComplaintReason('');
    setComplaintDescription('');
  }, []);
  const submitComplaint = useCallback(async () => {
    const description = complaintDescription.trim();
    if (!complaintReason || !description || !selectedID || complaintSending) return;
    setComplaintSending(true);
    try {
      const payload = { reason: complaintReason, description };
      if (complaint?.id) await api.complainMessage(complaint.id, payload);
      else await api.complainLoad(selectedID, payload);
      setComplaint(null);
      showToast('Şikâyetiniz inceleme için gönderildi.', { type: 'success' });
    } catch (error) {
      showToast(apiError(error), { type: 'error', title: 'Şikâyet gönderilemedi' });
    } finally { setComplaintSending(false); }
  }, [api, apiError, complaint, complaintDescription, complaintReason, complaintSending, selectedID, showToast]);
  const actionOptions = actionSheet?.type === 'photo' ? [
    { label: 'Kamera', description: 'Yeni bir fotoğraf çekin.', icon: 'camera-outline', onPress: () => void pickPhoto('camera') },
    { label: 'Galeriden seç', description: 'Cihazınızdaki bir fotoğrafı seçin.', icon: 'images-outline', onPress: () => void pickPhoto('library') },
  ] : actionSheet?.type === 'location' ? [
    { label: 'Mevcut konum', description: 'GPS ile bulunduğunuz noktayı paylaşın.', icon: 'locate-outline', onPress: () => void shareCurrentLocation() },
    { label: 'Haritadan seç', description: 'Haritada farklı bir nokta işaretleyin.', icon: 'map-outline', onPress: () => void openMapLocationPicker() },
  ] : actionSheet?.type === 'message' ? [
    { label: 'Yanıtla', icon: 'return-down-back-outline', onPress: () => setReplyTo(actionSheet.message) },
    ...(actionSheet.message?.body ? [{ label: 'Kopyala', icon: 'copy-outline', onPress: async () => { await Clipboard.setStringAsync(actionSheet.message.body); showToast('Mesaj panoya kopyalandı.', { type: 'success' }); } }] : []),
    ...(actionSheet.mine ? [{ label: 'Herkesten sil', icon: 'trash-outline', destructive: true, onPress: () => setConfirmation({ type: 'delete', message: actionSheet.message }) }] : []),
    ...(!actionSheet.mine ? [{ label: 'Şikâyet Et', icon: 'alert-circle-outline', destructive: true, onPress: () => openComplaint(actionSheet.message) }] : []),
  ] : [];

	const shareLoad = useCallback(() => {
		if (!active) return;
		void sendPayload({ type: 'load', body: '', replyToMessageId: replyTo?.id || '' });
	}, [active, replyTo, sendPayload]);

  const confirmAction = useCallback(() => {
    if (confirmation?.type === 'delete') {
      void deleteMessage(confirmation.message);
      return;
    }
    if (confirmation?.type === 'location') {
      const payload = confirmation.payload;
      setConfirmation(null);
      void sendPayload(payload);
    }
  }, [confirmation, deleteMessage, sendPayload]);

  const renderMessage = useCallback(({ item, index }) => <View>{item.status === 'failed' ? <Pressable style={styles.failedRetry} onPress={() => retryMessage(item)}><Icon name="refresh-circle-outline" size={15} color={colors.danger} /><Text style={styles.failedRetryText}>Mesaj gönderilemedi · Tekrar gönder</Text></Pressable> : null}<MessageBubble item={item} previous={chat[index - 1]} currentUserID={currentUser.id} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} onActions={openMessageActions} onFeedback={showMessageFeedback} onPreviewImage={setPreviewURI} onOpenLoad={() => onOpenLoad?.(selectedID)} /></View>, [chat, currentUser.id, formatMoney, onOpenLoad, openMessageActions, resolveMediaUrl, retryMessage, selectedID, showMessageFeedback]);
  const filterOptions = useMemo(() => [['all', 'Tümü'], ['unread', 'Okunmamış'], ['active', 'Aktif Nakliyeler'], ['completed', 'Tamamlananlar']], []);

  if (!active) return <View style={styles.root}>
    <FlatList data={items} keyExtractor={item => item.id || item.loadId} renderItem={({ item }) => <ConversationCard item={item} onPress={openConversation} loadStatusLabel={loadStatusLabel} />} refreshControl={<RefreshControl refreshing={listLoading} onRefresh={() => void loadConversations(true)} tintColor={colors.primary} />} contentContainerStyle={styles.listContent} ListHeaderComponent={<><View style={styles.pageTitleRow}><View style={styles.pageIcon}><Icon name="chatbubbles-outline" size={23} color={colors.primary} /></View><View style={styles.pageCopy}><Text style={styles.pageTitle}>Mesajlar</Text><Text style={styles.pageSub}>Aktif nakliyeleriniz için güvenli iletişim</Text></View>{totalUnread ? <View style={styles.totalUnread}><Text style={styles.totalUnreadText}>{totalUnread > 99 ? '99+' : totalUnread}</Text></View> : null}</View><View style={styles.searchFrame}><Icon name="search-outline" size={19} color={colors.textMuted} /><TextInput value={query} onChangeText={setQuery} placeholder="Kişi veya rota ara" placeholderTextColor={colors.textMuted} style={styles.search} returnKeyType="search" />{query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Icon name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}</View><View style={styles.filters}>{filterOptions.map(([value, label]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</View></>} ListEmptyComponent={!listLoading ? <EmptyState title="Henüz mesajınız yok" detail="Bir teklif kabul edildiğinde veya aktif bir nakliye için iletişim başladığında konuşmalarınız burada görünecek." retry={() => void loadConversations(true)} /> : <ActivityIndicator style={styles.loader} color={colors.primary} />} />
    {listError ? <View style={styles.errorBar}><Text style={styles.errorText}>{listError}</Text><Pressable onPress={() => void loadConversations(true)}><Text style={styles.errorAction}>Tekrar Dene</Text></Pressable></View> : null}
  </View>;

  const routeSummary = `${active.pickupAddress || ''} → ${active.deliveryAddress || ''}`;
  const initials = active.otherParty?.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  return <KeyboardAvoidingView style={[styles.root, { paddingBottom: keyboardVisible ? 0 : bottomInset }]} behavior={Platform.select({ ios: 'padding', android: undefined })} keyboardVerticalOffset={0}>
    <View style={styles.chatHeader}><Pressable style={styles.backButton} onPress={() => { setActive(null); setChat([]); setAttachment(null); }} hitSlop={10}><Icon name="arrow-back" size={22} color={colors.text} /></Pressable><View style={styles.personAvatar}><Text style={styles.personAvatarText}>{initials}</Text></View><View style={styles.chatPerson}><Text style={styles.chatName}>{active.otherParty?.name || 'Karşı taraf'}</Text><Text style={styles.lastSeen}>{active.otherParty?.role === 'driver' ? 'Şoför · ' : 'Müşteri · '}{lastSeenLabel(active.otherParty?.lastSeenAt)}</Text></View><Pressable accessibilityLabel="Konuşmayı şikâyet et" style={styles.complaintButton} onPress={() => openComplaint(null)}><Icon name="alert-circle-outline" size={19} color={colors.danger} /></Pressable><Pressable style={styles.loadOpenButton} onPress={() => onOpenLoad?.(selectedID)}><Icon name="document-text-outline" size={17} color={colors.primary} /><Text style={styles.loadOpen}>İlan</Text></Pressable></View>
    <Pressable style={styles.loadSummary} onPress={() => onOpenLoad?.(selectedID)}><View style={styles.loadSummaryIcon}><Icon name="navigate-outline" size={19} color={colors.primary} /></View><View style={styles.loadSummaryCopy}><Text style={styles.loadSummaryRoute} numberOfLines={1}>{routeSummary}</Text><Text style={styles.loadSummaryMeta}>{Number(active.estimatedKm || 0).toFixed(1)} km · Tahmini fiyat: {formatMoney(active.estimatedPriceTl)}</Text></View><Icon name="chevron-forward" size={18} color={colors.textMuted} /></Pressable>
    {chatError ? <View style={styles.chatError}><Text style={styles.errorText}>{chatError}</Text><Pressable onPress={() => void loadMessages(false)}><Text style={styles.errorAction}>Tekrar Dene</Text></Pressable></View> : null}
    <FlatList ref={chatRef} data={chat} keyExtractor={item => item.id} renderItem={renderMessage} contentContainerStyle={styles.chatContent} refreshing={chatLoading} onRefresh={() => void loadMessages(false)} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 72; if (contentOffset.y < 32) void loadMessages(true); }} scrollEventThrottle={80} ListHeaderComponent={hasMore ? <Pressable style={styles.loadOlder} onPress={() => void loadMessages(true)}><Icon name="time-outline" size={15} color={colors.primary} /><Text style={styles.loadOlderText}>Eski mesajları yükle</Text></Pressable> : null} ListEmptyComponent={chatLoading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : <EmptyState title="İlk mesajınızı gönderin" detail="Nakliye ayrıntıları ve mesajlar bu güvenli konuşmada kalır." />} />
    {unseenCount ? <Pressable style={styles.newMessages} onPress={scrollToBottom}><Icon name="arrow-down" size={15} color={colors.white} /><Text style={styles.newMessagesText}>{unseenCount} yeni mesaj</Text></Pressable> : null}
    {replyTo ? <View style={styles.replyComposer}><Icon name="return-down-back-outline" size={18} color={colors.primary} /><View style={styles.replyComposerCopy}><Text style={styles.replyComposerTitle}>Yanıtlanıyor</Text><Text style={styles.replyComposerText} numberOfLines={1}>{replyTo.deletedAt ? 'Bu mesaj silindi.' : messagePreview(replyTo)}</Text></View><Pressable onPress={() => setReplyTo(null)}><Icon name="close-circle" size={21} color={colors.textSecondary} /></Pressable></View> : null}
    {attachment ? <View style={styles.attachmentPreview}><Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} /><Text style={styles.attachmentText}>{uploading ? `Yükleniyor${uploadProgress ? ` %${uploadProgress}` : '…'}` : 'Göndermeye hazır'}</Text><Pressable onPress={() => setAttachment(null)} disabled={uploading}><Icon name="close-circle" size={22} color={colors.textSecondary} /></Pressable></View> : null}
    <View style={styles.composer}><Pressable accessibilityLabel="Fotoğraf ekle" style={styles.composerIcon} onPress={choosePhoto} disabled={uploading || sending}><Icon name="camera-outline" size={21} color={colors.primary} /></Pressable><Pressable accessibilityLabel="Konum paylaş" style={styles.composerIcon} onPress={chooseLocation} disabled={uploading || sending}><Icon name="location-outline" size={21} color={colors.primary} /></Pressable><Pressable accessibilityLabel="İlanı paylaş" style={styles.composerIcon} onPress={shareLoad} disabled={uploading || sending}><Icon name="document-text-outline" size={21} color={colors.primary} /></Pressable><TextInput ref={composerInputRef} testID="conversation-message-input" accessibilityLabel="Mesaj" value={draft} onChangeText={setDraft} onFocus={scrollToBottom} editable={!uploading} placeholder="Mesaj yazın" placeholderTextColor={colors.textMuted} selectionColor={colors.primary} style={styles.input} multiline maxLength={2000} textAlignVertical="top" blurOnSubmit={false} /><Pressable testID="conversation-send-button" accessibilityLabel="Mesajı gönder" style={[styles.send, ((!canSendMessage(draft) && !attachment) || uploading || sending) && styles.sendDisabled]} disabled={(!canSendMessage(draft) && !attachment) || uploading || sending} onPress={attachment ? () => void sendAttachment() : () => void sendText()}>{uploading || sending ? <ActivityIndicator color={colors.white} size="small" /> : <Icon name="send" size={19} color={colors.white} />}</Pressable></View>
    <Modal visible={mapPickerVisible} animationType="slide" onRequestClose={() => setMapPickerVisible(false)}><View style={styles.mapModal}><View style={styles.mapHeader}><Pressable onPress={() => setMapPickerVisible(false)}><Text style={styles.mapCancel}>Vazgeç</Text></Pressable><Text style={styles.mapTitle}>Konum seç</Text><Pressable onPress={() => void sharePickedLocation()}><Text style={styles.mapShare}>Paylaş</Text></Pressable></View>{mapCoordinate ? <MapAdapter style={styles.map} initialRegion={{ ...mapCoordinate, latitudeDelta: 0.035, longitudeDelta: 0.035 }} onPress={event => setMapCoordinate(event.nativeEvent.coordinate)} markers={[{ id: 'selected-location', coordinate: mapCoordinate, draggable: true, onDragEnd: event => setMapCoordinate(event.nativeEvent.coordinate) }]} fallback={<MapUnavailable message={nativeMapsMessage} />} /> : <MapUnavailable message={nativeMapsMessage} />}<Text style={styles.mapHint}>İğneyi sürükleyin veya haritada bir noktaya dokunun.</Text></View></Modal>
    <Modal visible={Boolean(previewURI)} transparent animationType="fade" onRequestClose={() => setPreviewURI(null)}><View style={styles.modal}><Pressable style={styles.modalClose} onPress={() => setPreviewURI(null)}><Icon name="close" size={25} color={colors.white} /></Pressable>{previewURI ? <Image source={{ uri: previewURI }} resizeMode="contain" style={styles.fullImage} /> : null}</View></Modal>
    <ActionSheet visible={Boolean(actionSheet)} title={actionSheet?.type === 'photo' ? 'Fotoğraf gönder' : actionSheet?.type === 'location' ? 'Konum paylaş' : 'Mesaj işlemleri'} message={actionSheet?.type === 'photo' ? 'Göndermeden önce fotoğrafı önizleyebilirsiniz.' : actionSheet?.type === 'location' ? 'Paylaşmak istediğiniz konumu seçin.' : undefined} options={actionOptions} onClose={() => setActionSheet(null)} />
    <ConfirmationModal visible={Boolean(confirmation)} title={confirmation?.type === 'delete' ? 'Mesaj silinsin mi?' : 'Konum paylaşılsın mı?'} message={confirmation?.type === 'delete' ? 'Bu işlem mesajı herkesten siler.' : confirmation?.message || ''} confirmLabel={confirmation?.type === 'delete' ? 'Sil' : 'Paylaş'} destructive={confirmation?.type === 'delete'} loading={confirmationLoading} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />
    <Modal visible={Boolean(complaint)} transparent animationType="slide" onRequestClose={() => !complaintSending && setComplaint(null)}><View style={styles.complaintOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => !complaintSending && setComplaint(null)} /><View style={styles.complaintSheet}><View style={styles.complaintHeader}><Text style={styles.complaintTitle}>Şikâyet Et</Text><Pressable onPress={() => setComplaint(null)} disabled={complaintSending}><Icon name="close" size={24} color={colors.textSecondary} /></Pressable></View><Text style={styles.complaintLabel}>Sebep</Text><View style={styles.complaintReasons}>{COMPLAINT_REASONS.map(([value, title]) => <Pressable key={value} onPress={() => setComplaintReason(value)} style={[styles.complaintReason, complaintReason === value && styles.complaintReasonActive]}><Text style={[styles.complaintReasonText, complaintReason === value && styles.complaintReasonTextActive]}>{title}</Text></Pressable>)}</View><Text style={styles.complaintLabel}>Kısa açıklama</Text><TextInput value={complaintDescription} onChangeText={setComplaintDescription} placeholder="Şikâyetinizi kısaca açıklayın" placeholderTextColor={colors.textMuted} maxLength={1000} multiline style={styles.complaintInput} /><View style={styles.complaintActions}><Pressable style={styles.complaintCancel} onPress={() => setComplaint(null)} disabled={complaintSending}><Text style={styles.complaintCancelText}>Vazgeç</Text></Pressable><Pressable style={[styles.complaintSubmit, (!complaintReason || !complaintDescription.trim() || complaintSending) && styles.sendDisabled]} onPress={() => void submitComplaint()} disabled={!complaintReason || !complaintDescription.trim() || complaintSending}>{complaintSending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.complaintSubmitText}>Gönder</Text>}</Pressable></View></View></View></Modal>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 }, listContent: { flexGrow: 1, padding: spacing.md, paddingBottom: 96 }, pageTitleRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.md }, pageIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.md, height: 46, justifyContent: 'center', marginRight: spacing.sm, width: 46 }, pageCopy: { flex: 1 }, pageTitle: { ...typography.h1, color: colors.ink }, pageSub: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xxs }, totalUnread: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, justifyContent: 'center', minWidth: 28, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs }, totalUnreadText: { ...typography.caption, color: colors.white }, searchFrame: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 50, paddingHorizontal: spacing.sm }, search: { ...typography.body, color: colors.ink, flex: 1, paddingHorizontal: spacing.xs }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs, marginTop: spacing.sm }, filter: { backgroundColor: colors.surfaceStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, filterActive: { backgroundColor: colors.primary }, filterText: { ...typography.caption, color: colors.textSecondary }, filterTextActive: { color: colors.white },
  conversationCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginTop: spacing.sm, padding: spacing.md, ...shadows.card }, personAvatar: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 23, height: 46, justifyContent: 'center', width: 46 }, personAvatarText: { ...typography.smallMedium, color: colors.primaryDark }, conversationBody: { flex: 1, marginLeft: spacing.sm, minWidth: 0 }, conversationTop: { alignItems: 'center', flexDirection: 'row' }, personName: { ...typography.bodyMedium, color: colors.ink, flex: 1 }, conversationTime: { ...typography.caption, color: colors.textMuted }, routeRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xxs }, route: { ...typography.caption, color: colors.textSecondary, flex: 1 }, previewRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.xs, marginTop: spacing.xs }, preview: { ...typography.small, color: colors.textSecondary, flex: 1 }, unread: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, justifyContent: 'center', marginLeft: spacing.xs, minWidth: 22, paddingHorizontal: 5, paddingVertical: 2 }, unreadText: { ...typography.caption, color: colors.white }, loader: { marginTop: spacing.xxl },
  errorBar: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderTopColor: '#E7B6B2', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, chatError: { alignItems: 'center', backgroundColor: colors.dangerSoft, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.xs }, errorText: { ...typography.caption, color: colors.danger, flex: 1 }, errorAction: { ...typography.caption, color: colors.primary, marginLeft: spacing.sm },
  chatHeader: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }, backButton: { alignItems: 'center', height: 42, justifyContent: 'center', marginRight: spacing.xs, width: 38 }, chatPerson: { flex: 1, marginLeft: spacing.sm, minWidth: 0 }, chatName: { ...typography.bodyMedium, color: colors.ink }, lastSeen: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, complaintButton: { alignItems: 'center', height: 38, justifyContent: 'center', marginRight: spacing.xxs, width: 38 }, loadOpenButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.xxs, minHeight: 38, paddingHorizontal: spacing.sm }, loadOpen: { ...typography.caption, color: colors.primaryDark }, loadSummary: { alignItems: 'center', backgroundColor: colors.primarySoft, borderBottomColor: '#C9E1DB', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, loadSummaryIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginRight: spacing.sm, width: 38 }, loadSummaryCopy: { flex: 1 }, loadSummaryRoute: { ...typography.smallMedium, color: colors.primaryDark }, loadSummaryMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  chatContent: { flexGrow: 1, paddingBottom: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.xs }, loadOlder: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.pill, flexDirection: 'row', gap: spacing.xxs, marginBottom: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, loadOlderText: { ...typography.caption, color: colors.primaryDark }, dateSeparator: { alignItems: 'center', marginBottom: spacing.xs, marginTop: spacing.xs }, dateText: { ...typography.caption, backgroundColor: colors.surfaceStrong, borderRadius: radius.pill, color: colors.textSecondary, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs }, system: { alignSelf: 'center', backgroundColor: colors.surfaceStrong, borderRadius: radius.sm, marginBottom: spacing.xs, maxWidth: '88%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, systemText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' }, messageRow: { alignItems: 'flex-start', flexDirection: 'row', marginBottom: spacing.xs }, messageRowMine: { justifyContent: 'flex-end' }, bubble: { borderRadius: radius.md, maxWidth: '84%', padding: spacing.sm }, bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: radius.xs }, bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: radius.xs, ...shadows.card }, bubbleDeleted: { backgroundColor: colors.surfaceStrong }, textMessage: { ...typography.body, color: colors.text }, deletedText: { ...typography.small, color: colors.textMuted, fontStyle: 'italic' },
  meta: { alignItems: 'center', alignSelf: 'flex-end', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xxs }, messageTime: { fontSize: 9, color: colors.textMuted }, messageTimeMine: { color: '#D7EEE9' }, failedRetry: { alignItems: 'center', alignSelf: 'flex-end', flexDirection: 'row', gap: spacing.xxs, marginBottom: spacing.xxs, marginRight: spacing.xxs }, failedRetryText: { ...typography.caption, color: colors.danger }, replyQuote: { borderLeftColor: '#9EDBCF', borderLeftWidth: 3, marginBottom: spacing.xs, paddingLeft: spacing.xs }, replyAuthor: { ...typography.caption, color: colors.primaryDark }, replyText: { ...typography.caption, color: colors.textSecondary, marginTop: 1 }, messageImage: { backgroundColor: colors.surfaceStrong, borderRadius: radius.sm, height: 180, width: 220 }, imageFallback: { alignItems: 'center', backgroundColor: colors.surfaceStrong, borderRadius: radius.sm, height: 100, justifyContent: 'center', width: 180 }, imageCaption: { ...typography.caption, color: '#E9F5F2', marginTop: spacing.xxs }, locationCard: { minWidth: 190 }, locationIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, height: 38, justifyContent: 'center', marginBottom: spacing.xs, width: 38 }, locationTitle: { ...typography.smallMedium, color: colors.text }, locationAddress: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs }, mapLinkRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.xs }, mapLink: { ...typography.caption, color: colors.primary },
  offerMessage: { backgroundColor: colors.warningSoft, borderColor: '#E8C98C', borderRadius: radius.sm, borderWidth: 1, minWidth: 205, padding: spacing.sm }, loadMessage: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm }, offerEyebrow: { ...typography.caption, color: colors.warning, letterSpacing: .5 }, offerPrice: { ...typography.h2, color: colors.warning, marginTop: spacing.xxs }, offerDifference: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs }, offerNote: { ...typography.caption, color: colors.text, marginTop: spacing.xs }, offerStatus: { ...typography.caption, color: colors.warning, marginTop: spacing.xs },
  newMessages: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, bottom: 72, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, position: 'absolute', ...shadows.floating }, newMessagesText: { ...typography.caption, color: colors.white }, replyComposer: { alignItems: 'center', backgroundColor: colors.primarySoft, borderTopColor: '#C9E1DB', borderTopWidth: 1, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }, replyComposerCopy: { flex: 1 }, replyComposerTitle: { ...typography.caption, color: colors.primaryDark }, replyComposerText: { ...typography.caption, color: colors.textSecondary }, attachmentPreview: { alignItems: 'center', backgroundColor: colors.primarySoft, borderTopColor: '#C9E1DB', borderTopWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.xs }, attachmentThumb: { borderRadius: radius.xs, height: 40, width: 40 }, attachmentText: { ...typography.caption, color: colors.text, flex: 1, marginLeft: spacing.sm }, composer: { alignItems: 'flex-end', backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, position: 'relative', zIndex: 2 }, composerIcon: { alignItems: 'center', height: 42, justifyContent: 'center', width: 34 }, input: { ...typography.body, backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.ink, flex: 1, maxHeight: 104, minHeight: 42, paddingHorizontal: spacing.sm, paddingTop: 10 }, send: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 21, height: 42, justifyContent: 'center', marginLeft: spacing.xs, width: 42 }, sendDisabled: { backgroundColor: colors.borderStrong },
  modal: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,.94)', flex: 1, justifyContent: 'center' }, fullImage: { height: '88%', width: '100%' }, modalClose: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,.16)', borderRadius: 22, height: 44, justifyContent: 'center', position: 'absolute', right: spacing.lg, top: 55, width: 44, zIndex: 2 }, mapModal: { backgroundColor: colors.surface, flex: 1 }, mapHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, mapCancel: { ...typography.bodyMedium, color: colors.textSecondary }, mapTitle: { ...typography.h3, color: colors.ink }, mapShare: { ...typography.bodyMedium, color: colors.primary }, map: { flex: 1 }, mapHint: { ...typography.small, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, textAlign: 'center' }, complaintOverlay: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' }, complaintSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg }, complaintHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, complaintTitle: { ...typography.h2, color: colors.ink }, complaintLabel: { ...typography.smallMedium, color: colors.text, marginTop: spacing.md }, complaintReasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }, complaintReason: { backgroundColor: colors.surfaceStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, complaintReasonActive: { backgroundColor: colors.primary }, complaintReasonText: { ...typography.caption, color: colors.textSecondary }, complaintReasonTextActive: { color: colors.white }, complaintInput: { ...typography.body, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, color: colors.ink, marginTop: spacing.xs, minHeight: 88, padding: spacing.sm, textAlignVertical: 'top' }, complaintActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }, complaintCancel: { alignItems: 'center', borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46 }, complaintCancelText: { ...typography.bodyMedium, color: colors.textSecondary }, complaintSubmit: { alignItems: 'center', backgroundColor: colors.danger, borderRadius: radius.sm, flex: 1, justifyContent: 'center', minHeight: 46 }, complaintSubmitText: { ...typography.bodyMedium, color: colors.white },
});
