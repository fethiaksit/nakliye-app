import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapAdapter from './maps/MapAdapter';
import MapUnavailable from './maps/MapUnavailable';

const LIST_POLL_MS = 15000;
const CHAT_POLL_MS = 5000;
const PAGE_SIZE = 30;
const ISTANBUL = 'Europe/Istanbul';

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
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{detail}</Text>{retry ? <Pressable style={styles.retry} onPress={retry}><Text style={styles.retryText}>Tekrar Dene</Text></Pressable> : null}</View>;
}

const ConversationCard = memo(function ConversationCard({ item, onPress, loadStatusLabel }) {
  const initials = item.otherParty?.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  return <Pressable style={styles.conversationCard} onPress={() => onPress(item)} accessibilityRole="button">
    <View style={styles.personAvatar}><Text style={styles.personAvatarText}>{initials}</Text></View>
    <View style={styles.conversationBody}>
      <View style={styles.conversationTop}><Text style={styles.personName} numberOfLines={1}>{item.otherParty?.name || 'Karşı taraf'}</Text><Text style={styles.conversationTime}>{item.lastMessageAt ? formatTime(item.lastMessageAt) : ''}</Text></View>
      <Text style={styles.route} numberOfLines={1}>{item.pickupAddress} → {item.deliveryAddress}</Text>
      <View style={styles.previewRow}><Text style={styles.preview} numberOfLines={1}>{item.lastMessage || 'Mesajlaşmayı başlatın'}</Text>{item.unreadCount ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View> : null}</View>
      <Text style={styles.loadState}>{loadStatusLabel(item.loadStatus)}</Text>
    </View>
  </Pressable>;
});

const MessageBubble = memo(function MessageBubble({ item, previous, currentUserID, formatMoney, resolveMediaUrl, onReply, onDelete, onPreviewImage, onOpenLoad }) {
  const mine = item.senderId === currentUserID;
  const showDate = !previous || dateKey(previous.createdAt) !== dateKey(item.createdAt);
  const deleted = Boolean(item.deletedAt);
  const openLocation = async () => {
    if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') return;
    const url = `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;
    try { await Linking.openURL(url); } catch { Alert.alert('Harita açılamadı', 'Konum bağlantısı açılamadı.'); }
  };
  const actions = () => {
    if (item.type === 'system' || deleted) return;
    const choices = [{ text: 'Yanıtla', onPress: () => onReply(item) }];
    if (item.body) choices.push({ text: 'Kopyala', onPress: () => void Clipboard.setStringAsync(item.body) });
    if (mine) choices.push({ text: 'Herkesten sil', style: 'destructive', onPress: () => onDelete(item) });
    choices.push({ text: 'Vazgeç', style: 'cancel' });
    Alert.alert('Mesaj işlemleri', undefined, choices);
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
  if (status === 'failed') return <Text style={styles.failedMark}>!</Text>;
  if (status === 'sending' || status === 'pending') return <Text style={styles.statusMark}>◷</Text>;
  if (status === 'read') return <Text style={styles.readMark}>✓✓</Text>;
  if (status === 'delivered') return <Text style={styles.statusMark}>✓✓</Text>;
  return <Text style={styles.statusMark}>✓</Text>;
}

function MessageContent({ item, mine, formatMoney, resolveMediaUrl, onPreviewImage, onOpenLocation, onOpenLoad }) {
  if (item.type === 'image') {
    const source = resolveMediaUrl(item.attachmentUrl);
    return <Pressable onPress={() => source && onPreviewImage(source)}>{source ? <Image source={{ uri: source, cache: 'force-cache' }} style={styles.messageImage} /> : <View style={styles.imageFallback}><Text>Görsel yüklenemedi</Text></View>}<Text style={styles.imageCaption}>{item.body || 'Fotoğraf'}</Text></Pressable>;
  }
  if (item.type === 'location') return <View style={styles.locationCard}><Text style={styles.locationIcon}>⌖</Text><Text style={styles.locationTitle}>Konum paylaşıldı</Text><Text style={styles.locationAddress}>{item.locationAddress || `${item.latitude?.toFixed(5)}, ${item.longitude?.toFixed(5)}`}</Text><Pressable onPress={onOpenLocation}><Text style={styles.mapLink}>Haritada Aç</Text></Pressable></View>;
  if (item.type === 'offer') return <Pressable style={styles.offerMessage} onPress={onOpenLoad}><Text style={styles.offerEyebrow}>TEKLİF</Text><Text style={styles.offerPrice}>{formatMoney(item.offerAmountTl)}</Text><Text style={styles.offerDifference}>Tahmini fiyat: {formatMoney(item.offerBasePriceTl)}</Text>{item.offerNote ? <Text style={styles.offerNote}>{item.offerNote}</Text> : null}<Text style={styles.offerStatus}>{item.offerStatus === 'accepted' ? 'Kabul edildi' : item.offerStatus || 'Bekliyor'}</Text></Pressable>;
  if (item.type === 'load') return <Pressable style={styles.loadMessage} onPress={onOpenLoad}><Text style={styles.offerEyebrow}>İLAN BİLGİSİ</Text><Text style={styles.textMessage}>{item.body || 'İlan özetini görüntüle'}</Text></Pressable>;
  return <Text style={[styles.textMessage, mine && { color: '#fff' }]}>{item.body}</Text>;
}

export default function ConversationCenter({ currentUser, api, apiError, resolveMediaUrl, formatMoney, loadStatusLabel, onOpenLoad, reverseGeocode, nativeMapsConfigured = true, nativeMapsMessage = 'Google haritası yüklenemedi. Harita anahtarı ve uygulama yapılandırmasını kontrol edin.' }) {
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
  const [previewURI, setPreviewURI] = useState(null);
	const [mapPickerVisible, setMapPickerVisible] = useState(false);
	const [mapCoordinate, setMapCoordinate] = useState(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const [isActiveApp, setIsActiveApp] = useState(AppState.currentState === 'active');
  const listBusy = useRef(false);
  const chatBusy = useRef(false);
	const paginationInitialized = useRef(false);
  const listRef = useRef(null);
  const chatRef = useRef(null);
  const atBottomRef = useRef(true);
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

  const scrollToBottom = useCallback(() => {
    atBottomRef.current = true;
    setUnseenCount(0);
    requestAnimationFrame(() => chatRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const sendPayload = useCallback(async payload => {
    if (!selectedID) return;
    const clientMessageId = payload.clientMessageId || newClientMessageID();
    const optimistic = { id: `local:${clientMessageId}`, loadId: selectedID, senderId: currentUser.id, senderRole: currentUser.role, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'sending', clientMessageId, ...payload };
    setChat(current => mergeByID(current, [optimistic]));
    setDraft(''); setReplyTo(null); scrollToBottom();
    try {
      const { data } = await api.send(selectedID, { ...payload, clientMessageId });
      setChat(current => mergeByID(current.filter(item => item.id !== optimistic.id), [data]));
      void loadConversations(false);
    } catch (error) {
      setChat(current => current.map(item => item.id === optimistic.id ? { ...item, status: 'failed', sendError: apiError(error) } : item));
    }
  }, [api, apiError, currentUser.id, currentUser.role, loadConversations, scrollToBottom, selectedID]);

  const sendText = useCallback(() => {
    const body = draft.trim();
    if (!body || uploading) return;
    void sendPayload({ type: 'text', body, replyToMessageId: replyTo?.id || '' });
  }, [draft, replyTo, sendPayload, uploading]);

  const retryMessage = useCallback(message => {
    if (message.status !== 'failed') return;
    const { id, status, sendError, createdAt, updatedAt, senderId, senderRole, loadId, ...payload } = message;
    setChat(current => current.filter(item => item.id !== message.id));
    void sendPayload(payload);
  }, [sendPayload]);

  const deleteMessage = useCallback(message => {
    Alert.alert('Mesaj silinsin mi?', 'Bu işlem mesajı herkesten siler.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        try {
          const { data } = await api.removeMessage(message.id);
          setChat(current => current.map(item => item.id === data.id ? data : item));
          void loadConversations(false);
        } catch (error) { Alert.alert('Mesaj silinemedi', apiError(error)); }
      } },
    ]);
  }, [api, apiError, loadConversations]);

  const pickPhoto = useCallback(async source => {
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Fotoğraf izni gerekli', 'Fotoğraf göndermek için cihaz ayarlarından izin vermelisiniz.'); return; }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) { Alert.alert('Fotoğraf çok büyük', 'En fazla 10 MB fotoğraf gönderebilirsiniz.'); return; }
    setAttachment(asset);
  }, []);

  const choosePhoto = useCallback(() => Alert.alert('Fotoğraf gönder', 'Göndermeden önce önizleyebilirsiniz.', [
    { text: 'Kamera', onPress: () => void pickPhoto('camera') },
    { text: 'Galeriden seç', onPress: () => void pickPhoto('library') },
    { text: 'Vazgeç', style: 'cancel' },
  ]), [pickPhoto]);

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
      Alert.alert('Fotoğraf gönderilemedi', apiError(error));
    } finally { setUploading(false); setUploadProgress(0); }
  }, [api, apiError, attachment, replyTo, selectedID, sendPayload, uploading]);

  const shareCurrentLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') { Alert.alert('Konum izni gerekli', 'Mevcut konumunuzu paylaşmak için cihaz ayarlarından konum izni vermelisiniz.'); return; }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      const address = (await reverseGeocode?.(latitude, longitude))?.formattedAddress || '';
      Alert.alert('Konum paylaşılsın mı?', address || 'Mevcut konumunuz karşı tarafla paylaşılacak.', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Paylaş', onPress: () => void sendPayload({ type: 'location', latitude, longitude, locationAddress: address, replyToMessageId: replyTo?.id || '' }) },
      ]);
    } catch (error) { Alert.alert('Konum alınamadı', apiError(error)); }
  }, [apiError, replyTo, reverseGeocode, sendPayload]);

	const openMapLocationPicker = useCallback(async () => {
		if (!nativeMapsConfigured) {
			Alert.alert('Google haritası yüklenemedi', nativeMapsMessage);
			return;
		}
		let coordinate = { latitude: 38.4237, longitude: 27.1428 };
		const permission = await Location.requestForegroundPermissionsAsync();
		if (permission.status === 'granted') {
			try {
				const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
				coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
			} catch { /* A manually chosen pin does not require a GPS fix. */ }
		}
		setMapCoordinate(coordinate);
		setMapPickerVisible(true);
	}, [nativeMapsConfigured, nativeMapsMessage]);

	const sharePickedLocation = useCallback(async () => {
		if (!mapCoordinate) return;
		try {
			const address = (await reverseGeocode?.(mapCoordinate.latitude, mapCoordinate.longitude))?.formattedAddress || '';
			setMapPickerVisible(false);
			void sendPayload({ type: 'location', latitude: mapCoordinate.latitude, longitude: mapCoordinate.longitude, locationAddress: address, replyToMessageId: replyTo?.id || '' });
		} catch (error) { Alert.alert('Konum paylaşılamadı', apiError(error)); }
	}, [apiError, mapCoordinate, replyTo, reverseGeocode, sendPayload]);

	const chooseLocation = useCallback(() => Alert.alert('Konum paylaş', 'Mevcut konumunuzu paylaşın veya haritadan bir nokta seçin.', [
		{ text: 'Mevcut konum', onPress: () => void shareCurrentLocation() },
		{ text: 'Haritadan seç', onPress: () => void openMapLocationPicker() },
		{ text: 'Vazgeç', style: 'cancel' },
	]), [openMapLocationPicker, shareCurrentLocation]);

	const shareLoad = useCallback(() => {
		if (!active) return;
		void sendPayload({ type: 'load', body: '', replyToMessageId: replyTo?.id || '' });
	}, [active, replyTo, sendPayload]);

  const renderMessage = useCallback(({ item, index }) => <View>{item.status === 'failed' ? <Pressable style={styles.failedRetry} onPress={() => retryMessage(item)}><Text style={styles.failedRetryText}>Mesaj gönderilemedi · Tekrar Gönder</Text></Pressable> : null}<MessageBubble item={item} previous={chat[index - 1]} currentUserID={currentUser.id} formatMoney={formatMoney} resolveMediaUrl={resolveMediaUrl} onReply={setReplyTo} onDelete={deleteMessage} onPreviewImage={setPreviewURI} onOpenLoad={() => onOpenLoad?.(selectedID)} /></View>, [chat, currentUser.id, deleteMessage, formatMoney, onOpenLoad, resolveMediaUrl, retryMessage, selectedID]);
  const filterOptions = useMemo(() => [['all', 'Tümü'], ['unread', 'Okunmamış'], ['active', 'Aktif Nakliyeler'], ['completed', 'Tamamlananlar']], []);

  if (!active) return <View style={styles.root}>
    <FlatList data={items} keyExtractor={item => item.id || item.loadId} renderItem={({ item }) => <ConversationCard item={item} onPress={openConversation} loadStatusLabel={loadStatusLabel} />} refreshControl={<RefreshControl refreshing={listLoading} onRefresh={() => void loadConversations(true)} tintColor="#3657c8" />} contentContainerStyle={styles.listContent} ListHeaderComponent={<><View style={{ alignItems: 'center', flexDirection: 'row' }}><Text style={[styles.pageTitle, { flex: 1 }]}>Mesajlar</Text>{totalUnread ? <View style={{ alignItems: 'center', backgroundColor: '#3657c8', borderRadius: 14, justifyContent: 'center', minWidth: 26, paddingHorizontal: 7, paddingVertical: 4 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{totalUnread > 99 ? '99+' : totalUnread}</Text></View> : null}</View><Text style={styles.pageSub}>Kabul edilen nakliyeleriniz için güvenli iletişim</Text><TextInput value={query} onChangeText={setQuery} placeholder="Kişi veya rota ara" placeholderTextColor="#8e99ad" style={styles.search} returnKeyType="search" /><View style={styles.filters}>{filterOptions.map(([value, label]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</View></>} ListEmptyComponent={!listLoading ? <EmptyState title="Henüz mesajınız yok" detail="Bir teklif kabul edildiğinde veya aktif bir nakliye için iletişim başladığında konuşmalarınız burada görünecek." retry={() => void loadConversations(true)} /> : <ActivityIndicator style={styles.loader} color="#3657c8" />} />
    {listError ? <View style={styles.errorBar}><Text style={styles.errorText}>{listError}</Text><Pressable onPress={() => void loadConversations(true)}><Text style={styles.errorAction}>Tekrar Dene</Text></Pressable></View> : null}
  </View>;

  const routeSummary = `${active.pickupAddress || ''} → ${active.deliveryAddress || ''}`;
  const initials = active.otherParty?.name?.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.select({ ios: 'padding', android: undefined })} keyboardVerticalOffset={0}>
    <View style={styles.chatHeader}><Pressable onPress={() => { setActive(null); setChat([]); setAttachment(null); }} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable><View style={styles.personAvatar}><Text style={styles.personAvatarText}>{initials}</Text></View><View style={styles.chatPerson}><Text style={styles.chatName}>{active.otherParty?.name || 'Karşı taraf'}</Text><Text style={styles.lastSeen}>{active.otherParty?.role === 'driver' ? 'Şoför · ' : 'Müşteri · '}{lastSeenLabel(active.otherParty?.lastSeenAt)}</Text></View><Pressable onPress={() => onOpenLoad?.(selectedID)}><Text style={styles.loadOpen}>İlanı aç</Text></Pressable></View>
    <Pressable style={styles.loadSummary} onPress={() => onOpenLoad?.(selectedID)}><Text style={styles.loadSummaryRoute} numberOfLines={1}>{routeSummary}</Text><Text style={styles.loadSummaryMeta}>{Number(active.estimatedKm || 0).toFixed(1)} km · Tahmini fiyat: {formatMoney(active.estimatedPriceTl)}</Text></Pressable>
    {chatError ? <View style={styles.chatError}><Text style={styles.errorText}>{chatError}</Text><Pressable onPress={() => void loadMessages(false)}><Text style={styles.errorAction}>Tekrar Dene</Text></Pressable></View> : null}
    <FlatList ref={chatRef} data={chat} keyExtractor={item => item.id} renderItem={renderMessage} contentContainerStyle={styles.chatContent} refreshing={chatLoading} onRefresh={() => void loadMessages(false)} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 72; if (contentOffset.y < 32) void loadMessages(true); }} scrollEventThrottle={80} ListHeaderComponent={hasMore ? <Pressable style={styles.loadOlder} onPress={() => void loadMessages(true)}><Text style={styles.loadOlderText}>Eski mesajları yükle</Text></Pressable> : null} ListEmptyComponent={chatLoading ? <ActivityIndicator style={styles.loader} color="#3657c8" /> : <EmptyState title="İlk mesajınızı gönderin" detail="Nakliye ayrıntıları ve mesajlar bu güvenli konuşmada kalır." />} />
    {unseenCount ? <Pressable style={styles.newMessages} onPress={scrollToBottom}><Text style={styles.newMessagesText}>{unseenCount} yeni mesaj · En alta git</Text></Pressable> : null}
    {replyTo ? <View style={styles.replyComposer}><Text style={styles.replyComposerTitle}>Yanıtlanıyor</Text><Text style={styles.replyComposerText} numberOfLines={1}>{replyTo.deletedAt ? 'Bu mesaj silindi.' : messagePreview(replyTo)}</Text><Pressable onPress={() => setReplyTo(null)}><Text style={styles.replyClose}>×</Text></Pressable></View> : null}
    {attachment ? <View style={styles.attachmentPreview}><Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} /><Text style={styles.attachmentText}>{uploading ? `Yükleniyor${uploadProgress ? ` %${uploadProgress}` : '…'}` : 'Göndermeye hazır'}</Text><Pressable onPress={() => setAttachment(null)} disabled={uploading}><Text style={styles.attachmentRemove}>×</Text></Pressable></View> : null}
    <View style={styles.composer}><Pressable style={styles.composerIcon} onPress={choosePhoto} disabled={uploading}><Text style={styles.composerIconText}>＋</Text></Pressable><Pressable style={styles.composerIcon} onPress={chooseLocation} disabled={uploading}><Text style={styles.composerIconText}>⌖</Text></Pressable><Pressable style={styles.composerIcon} onPress={shareLoad} disabled={uploading}><Text style={styles.composerIconText}>▤</Text></Pressable><TextInput value={draft} onChangeText={setDraft} placeholder="Mesaj yazın" placeholderTextColor="#8e99ad" style={styles.input} multiline maxLength={2000} textAlignVertical="top" /><Pressable style={[styles.send, (!draft.trim() && !attachment || uploading) && styles.sendDisabled]} disabled={(!draft.trim() && !attachment) || uploading} onPress={attachment ? () => void sendAttachment() : sendText}><Text style={styles.sendText}>{uploading ? '…' : '↑'}</Text></Pressable></View>
    <Modal visible={mapPickerVisible} animationType="slide" onRequestClose={() => setMapPickerVisible(false)}><View style={styles.mapModal}><View style={styles.mapHeader}><Pressable onPress={() => setMapPickerVisible(false)}><Text style={styles.mapCancel}>Vazgeç</Text></Pressable><Text style={styles.mapTitle}>Konum seç</Text><Pressable onPress={() => void sharePickedLocation()}><Text style={styles.mapShare}>Paylaş</Text></Pressable></View>{nativeMapsConfigured && mapCoordinate ? <MapAdapter style={styles.map} initialRegion={{ ...mapCoordinate, latitudeDelta: 0.035, longitudeDelta: 0.035 }} onPress={event => setMapCoordinate(event.nativeEvent.coordinate)} markers={[{ id: 'selected-location', coordinate: mapCoordinate, draggable: true, onDragEnd: event => setMapCoordinate(event.nativeEvent.coordinate) }]} fallback={<MapUnavailable />} /> : <MapUnavailable />}<Text style={styles.mapHint}>İğneyi sürükleyin veya haritada bir noktaya dokunun.</Text></View></Modal>
    <Modal visible={Boolean(previewURI)} transparent animationType="fade" onRequestClose={() => setPreviewURI(null)}><View style={styles.modal}><Pressable style={styles.modalClose} onPress={() => setPreviewURI(null)}><Text style={styles.modalCloseText}>×</Text></Pressable>{previewURI ? <Image source={{ uri: previewURI }} resizeMode="contain" style={styles.fullImage} /> : null}</View></Modal>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f8fc' }, listContent: { flexGrow: 1, padding: 18, paddingBottom: 96 }, pageTitle: { color: '#25314b', fontSize: 25, fontWeight: '800', marginTop: 5 }, pageSub: { color: '#728097', fontSize: 12, marginTop: 5, marginBottom: 15 }, search: { backgroundColor: '#fff', borderColor: '#e1e6ef', borderRadius: 13, borderWidth: 1, color: '#26334b', minHeight: 46, paddingHorizontal: 14 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11, marginBottom: 4 }, filter: { backgroundColor: '#e9edf5', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8 }, filterActive: { backgroundColor: '#3657c8' }, filterText: { color: '#66728a', fontSize: 11, fontWeight: '700' }, filterTextActive: { color: '#fff' }, conversationCard: { backgroundColor: '#fff', borderRadius: 17, flexDirection: 'row', marginTop: 11, padding: 13, shadowColor: '#28334b', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 7, elevation: 1 }, personAvatar: { alignItems: 'center', backgroundColor: '#e4eaff', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 }, personAvatarText: { color: '#314eae', fontSize: 13, fontWeight: '800' }, conversationBody: { flex: 1, marginLeft: 11, minWidth: 0 }, conversationTop: { alignItems: 'center', flexDirection: 'row' }, personName: { color: '#26334b', flex: 1, fontSize: 15, fontWeight: '800' }, conversationTime: { color: '#8994a6', fontSize: 10 }, route: { color: '#60708a', fontSize: 11, marginTop: 3 }, previewRow: { alignItems: 'center', flexDirection: 'row', marginTop: 5 }, preview: { color: '#758197', flex: 1, fontSize: 12 }, unread: { alignItems: 'center', backgroundColor: '#3657c8', borderRadius: 11, justifyContent: 'center', marginLeft: 8, minWidth: 21, paddingHorizontal: 5, paddingVertical: 2 }, unreadText: { color: '#fff', fontSize: 10, fontWeight: '800' }, loadState: { alignSelf: 'flex-start', backgroundColor: '#e8f7ee', borderRadius: 5, color: '#238152', fontSize: 9, fontWeight: '800', marginTop: 7, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3 }, loader: { marginTop: 36 }, empty: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 17, marginTop: 22, padding: 27 }, emptyTitle: { color: '#28354c', fontSize: 16, fontWeight: '800', textAlign: 'center' }, emptyText: { color: '#748096', fontSize: 12, lineHeight: 18, marginTop: 7, textAlign: 'center' }, retry: { backgroundColor: '#edf1ff', borderRadius: 10, marginTop: 15, paddingHorizontal: 14, paddingVertical: 10 }, retryText: { color: '#3657c8', fontSize: 12, fontWeight: '800' }, errorBar: { alignItems: 'center', backgroundColor: '#fff4f3', borderColor: '#f2c7c2', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 17, paddingVertical: 10 }, chatError: { alignItems: 'center', backgroundColor: '#fff4f3', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }, errorText: { color: '#aa4139', flex: 1, fontSize: 11 }, errorAction: { color: '#3657c8', fontSize: 11, fontWeight: '800', marginLeft: 12 }, chatHeader: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: '#e8ebf2', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12 }, back: { color: '#3657c8', fontSize: 34, fontWeight: '300', lineHeight: 36, marginRight: 11 }, chatPerson: { flex: 1, marginLeft: 9, minWidth: 0 }, chatName: { color: '#26334b', fontSize: 15, fontWeight: '800' }, lastSeen: { color: '#748096', fontSize: 10, marginTop: 2 }, loadOpen: { color: '#3657c8', fontSize: 11, fontWeight: '800', marginLeft: 6 }, loadSummary: { backgroundColor: '#eaf0ff', borderBottomColor: '#dce4f8', borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 10 }, loadSummaryRoute: { color: '#314eae', fontSize: 12, fontWeight: '800' }, loadSummaryMeta: { color: '#68799d', fontSize: 10, marginTop: 3 }, chatContent: { flexGrow: 1, paddingHorizontal: 13, paddingTop: 6, paddingBottom: 12 }, loadOlder: { alignSelf: 'center', backgroundColor: '#edf1ff', borderRadius: 14, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 7 }, loadOlderText: { color: '#3657c8', fontSize: 11, fontWeight: '800' }, dateSeparator: { alignItems: 'center', marginBottom: 9, marginTop: 7 }, dateText: { backgroundColor: '#e6eaf1', borderRadius: 10, color: '#66738b', fontSize: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4 }, system: { alignSelf: 'center', backgroundColor: '#eef0f4', borderRadius: 12, marginBottom: 9, marginTop: 2, maxWidth: '88%', paddingHorizontal: 11, paddingVertical: 7 }, systemText: { color: '#66738b', fontSize: 11, textAlign: 'center' }, messageRow: { alignItems: 'flex-start', flexDirection: 'row', marginBottom: 8 }, messageRowMine: { justifyContent: 'flex-end' }, bubble: { borderRadius: 16, maxWidth: '84%', padding: 10 }, bubbleMine: { backgroundColor: '#3d63d7', borderBottomRightRadius: 4 }, bubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 4, shadowColor: '#28334b', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 }, bubbleDeleted: { backgroundColor: '#f0f2f6' }, textMessage: { color: '#28354d', fontSize: 14, lineHeight: 20 }, bubbleMineText: { color: '#fff' }, deletedText: { color: '#7f8999', fontSize: 13, fontStyle: 'italic' }, meta: { alignItems: 'center', alignSelf: 'flex-end', flexDirection: 'row', gap: 4, marginTop: 4 }, messageTime: { color: '#8290a4', fontSize: 9 }, messageTimeMine: { color: '#dce5ff' }, statusMark: { color: '#dce5ff', fontSize: 10, fontWeight: '800' }, readMark: { color: '#8ed8ff', fontSize: 10, fontWeight: '800' }, failedMark: { color: '#d5322b', fontSize: 12, fontWeight: '900' }, failedRetry: { alignSelf: 'flex-end', marginBottom: 4, marginRight: 4 }, failedRetryText: { color: '#c53a33', fontSize: 10, fontWeight: '800' }, replyQuote: { borderLeftColor: '#aebff8', borderLeftWidth: 3, marginBottom: 7, paddingLeft: 7 }, replyAuthor: { color: '#566ea6', fontSize: 10, fontWeight: '800' }, replyText: { color: '#69778e', fontSize: 11, marginTop: 1 }, messageImage: { backgroundColor: '#e7ebf3', borderRadius: 10, height: 180, width: 220 }, imageFallback: { alignItems: 'center', backgroundColor: '#e7ebf3', borderRadius: 10, height: 100, justifyContent: 'center', width: 180 }, imageCaption: { color: '#eef2ff', fontSize: 11, marginTop: 5 }, locationCard: { minWidth: 190 }, locationIcon: { color: '#3657c8', fontSize: 20 }, locationTitle: { color: '#28354d', fontSize: 13, fontWeight: '800', marginTop: 2 }, locationAddress: { color: '#68758b', fontSize: 11, lineHeight: 16, marginTop: 3 }, mapLink: { color: '#3657c8', fontSize: 11, fontWeight: '800', marginTop: 8 }, offerMessage: { backgroundColor: '#fff4e5', borderColor: '#f4c67c', borderRadius: 11, borderWidth: 1, minWidth: 205, padding: 10 }, loadMessage: { backgroundColor: '#edf1ff', borderRadius: 11, padding: 10 }, offerEyebrow: { color: '#a06408', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }, offerPrice: { color: '#934c00', fontSize: 20, fontWeight: '900', marginTop: 3 }, offerDifference: { color: '#916931', fontSize: 10, marginTop: 3 }, offerNote: { color: '#6d5940', fontSize: 11, marginTop: 7 }, offerStatus: { color: '#9a670d', fontSize: 10, fontWeight: '800', marginTop: 8 }, newMessages: { alignSelf: 'center', backgroundColor: '#3657c8', borderRadius: 16, bottom: 72, elevation: 4, paddingHorizontal: 13, paddingVertical: 8, position: 'absolute', shadowColor: '#1d2b58', shadowOpacity: 0.25, shadowRadius: 6 }, newMessagesText: { color: '#fff', fontSize: 11, fontWeight: '800' }, replyComposer: { alignItems: 'center', backgroundColor: '#eef2fb', borderTopColor: '#dce2f0', borderTopWidth: 1, flexDirection: 'row', paddingHorizontal: 15, paddingVertical: 7 }, replyComposerTitle: { color: '#3657c8', fontSize: 10, fontWeight: '800', marginRight: 6 }, replyComposerText: { color: '#65738a', flex: 1, fontSize: 11 }, replyClose: { color: '#526077', fontSize: 22, lineHeight: 22, marginLeft: 10 }, attachmentPreview: { alignItems: 'center', backgroundColor: '#eef2fb', borderTopColor: '#dce2f0', borderTopWidth: 1, flexDirection: 'row', paddingHorizontal: 15, paddingVertical: 7 }, attachmentThumb: { borderRadius: 6, height: 38, width: 38 }, attachmentText: { color: '#526077', flex: 1, fontSize: 11, marginLeft: 9 }, attachmentRemove: { color: '#526077', fontSize: 22, lineHeight: 22 }, composer: { alignItems: 'flex-end', backgroundColor: '#fff', borderTopColor: '#e0e5ee', borderTopWidth: 1, flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 9 }, composerIcon: { alignItems: 'center', height: 40, justifyContent: 'center', width: 34 }, composerIconText: { color: '#3657c8', fontSize: 22 }, input: { backgroundColor: '#f4f6fa', borderRadius: 16, color: '#26334b', flex: 1, fontSize: 14, maxHeight: 104, minHeight: 40, paddingHorizontal: 12, paddingTop: 10 }, send: { alignItems: 'center', backgroundColor: '#3657c8', borderRadius: 20, height: 40, justifyContent: 'center', marginLeft: 8, width: 40 }, sendDisabled: { backgroundColor: '#b8c2d8' }, sendText: { color: '#fff', fontSize: 21, fontWeight: '700', marginTop: -2 }, modal: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,.92)', flex: 1, justifyContent: 'center' }, fullImage: { height: '88%', width: '100%' }, modalClose: { position: 'absolute', right: 20, top: 55, zIndex: 2 }, modalCloseText: { color: '#fff', fontSize: 36, fontWeight: '200' }, mapModal: { flex: 1, backgroundColor: '#fff' }, mapHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16 }, mapCancel: { color: '#66738b', fontSize: 14, fontWeight: '700' }, mapTitle: { color: '#26334b', fontSize: 16, fontWeight: '800' }, mapShare: { color: '#3657c8', fontSize: 14, fontWeight: '800' }, map: { flex: 1 }, mapHint: { color: '#63718a', fontSize: 12, paddingHorizontal: 18, paddingVertical: 14, textAlign: 'center' },
});
