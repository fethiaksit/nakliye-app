import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '../../../shared/ui/Icon';
import { colors, radius, spacing, typography } from '../../../shared/ui/theme';
import { normalizeLoadPhotos } from '../utils/presentation';

const MAX_ZOOM = 3;

function PhotoFallback({ compact, onRetry, label = 'Yük fotoğrafı bulunmuyor' }) {
  return <Pressable style={[styles.fallback, compact && styles.compactFallback]} onPress={onRetry} disabled={!onRetry} accessibilityRole={onRetry ? 'button' : 'image'} accessibilityLabel={label}>
    <Icon name="images-outline" size={25} color={colors.textMuted} />
    <Text style={styles.fallbackText}>{label}</Text>
    {onRetry ? <Text style={styles.retryText}>Tekrar dene</Text> : null}
  </Pressable>;
}

const CachedLoadPhoto = memo(function CachedLoadPhoto({ photo, style, contentFit = 'cover', compact = false }) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => { setFailed(false); }, [photo?.url]);
  if (!photo?.url || failed) return <PhotoFallback compact={compact} label={failed ? 'Fotoğraf yüklenemedi' : 'Yük fotoğrafı bulunmuyor'} onRetry={failed ? () => { setFailed(false); setRetryKey(current => current + 1); } : undefined} />;
  return <Image key={`${photo.id}-${retryKey}`} source={photo.url} style={style} contentFit={contentFit} cachePolicy="memory-disk" transition={160} onError={() => setFailed(true)} accessibilityLabel="İlan yük fotoğrafı" />;
});

function FullScreenPhoto({ photo, active, onZoomChange }) {
  const { width, height } = useWindowDimensions();
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(1);
  const baseScale = useRef(1);
  const startDistance = useRef(0);
  const panStart = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);

  const setZoom = useCallback((next, animate = false) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
    scaleValue.current = clamped;
    onZoomChange(clamped);
    const apply = animate ? Animated.spring(scale, { toValue: clamped, useNativeDriver: true, bounciness: 0 }) : null;
    if (apply) apply.start(); else scale.setValue(clamped);
    if (clamped === 1) Animated.parallel([
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }),
    ]).start();
  }, [onZoomChange, scale, translateX, translateY]);

  useEffect(() => {
    if (!active) setZoom(1);
  }, [active, setZoom]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: event => event.nativeEvent.touches.length >= 2 || scaleValue.current > 1,
    onPanResponderGrant: event => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const [first, second] = touches;
        startDistance.current = Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
        baseScale.current = scaleValue.current;
      } else {
        panStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      }
    },
    onPanResponderMove: event => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const [first, second] = touches;
        const distance = Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
        if (startDistance.current > 0) setZoom(baseScale.current * distance / startDistance.current);
        return;
      }
      if (scaleValue.current > 1) {
        const maxX = Math.max(0, (scaleValue.current - 1) * width * 0.42);
        const maxY = Math.max(0, (scaleValue.current - 1) * height * 0.32);
        const x = Math.max(-maxX, Math.min(maxX, event.nativeEvent.pageX - panStart.current.x));
        const y = Math.max(-maxY, Math.min(maxY, event.nativeEvent.pageY - panStart.current.y));
        translateX.setValue(x);
        translateY.setValue(y);
      }
    },
    onPanResponderRelease: () => setZoom(scaleValue.current, true),
    onPanResponderTerminate: () => setZoom(scaleValue.current, true),
  }), [height, setZoom, translateX, translateY, width]);

  const handleTouchEnd = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 260) setZoom(scaleValue.current > 1 ? 1 : 2, true);
    lastTap.current = now;
  }, [setZoom]);

  return <View style={[styles.fullScreenPage, { width }]} onTouchEnd={handleTouchEnd} {...responder.panHandlers}>
    <Animated.View style={{ transform: [{ translateX }, { translateY }, { scale }] }}>
      <CachedLoadPhoto photo={photo} style={{ width, height: height * 0.78 }} contentFit="contain" />
    </Animated.View>
  </View>;
}

export function FullScreenLoadGallery({ photos: rawPhotos, initialIndex = 0, visible, onClose }) {
  const photos = useMemo(() => normalizeLoadPhotos(rawPhotos), [rawPhotos]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!visible) return;
    const next = Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0));
    setIndex(next);
    setZoom(1);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: next * width, animated: false }));
  }, [initialIndex, photos.length, visible, width]);
  useEffect(() => {
    if (!visible || !photos[index]?.url) return;
    [index - 1, index, index + 1].forEach(candidate => {
      if (photos[candidate]?.url) void Image.prefetch(photos[candidate].url);
    });
  }, [index, photos, visible]);
  if (!visible) return null;
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.viewer}>
      <View style={[styles.viewerHeader, { paddingTop: Math.max(insets.top, 12) }]}>
        <Text style={styles.viewerCounter}>{photos.length ? `${index + 1} / ${photos.length}` : '0 / 0'}</Text>
        <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Tam ekran galeriyi kapat" hitSlop={8}><Icon name="close" size={24} color={colors.white} /></Pressable>
      </View>
      {photos.length ? <FlatList ref={listRef} data={photos} horizontal pagingEnabled scrollEnabled={zoom <= 1} showsHorizontalScrollIndicator={false} keyExtractor={item => item.id} renderItem={({ item, index: itemIndex }) => <FullScreenPhoto photo={item} active={itemIndex === index} onZoomChange={itemIndex === index ? setZoom : () => {}} />} getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })} initialNumToRender={1} windowSize={3} onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))} /> : <PhotoFallback label="Yük fotoğrafı bulunmuyor" />}
      <Text style={[styles.viewerHint, { paddingBottom: Math.max(insets.bottom, 16) }]}>Çift dokunarak yakınlaştırın · Yakınlaştırınca sürükleyin</Text>
    </View>
  </Modal>;
}

export function LoadPhotoThumbnail({ photos: rawPhotos }) {
  const photos = useMemo(() => normalizeLoadPhotos(rawPhotos), [rawPhotos]);
  const [visible, setVisible] = useState(false);
  if (!photos.length) return <PhotoFallback compact />;
  return <>
    <Pressable style={styles.thumbnail} onPress={() => setVisible(true)} accessibilityRole="button" accessibilityLabel={`${photos.length} yük fotoğrafını aç`}>
      <CachedLoadPhoto photo={photos[0]} style={styles.thumbnailImage} />
      {photos.length > 1 ? <View style={styles.countChip}><Text style={styles.countText}>1 / {photos.length}</Text></View> : null}
    </Pressable>
    <FullScreenLoadGallery photos={photos} visible={visible} onClose={() => setVisible(false)} />
  </>;
}

export default function LoadPhotoGallery({ photos: rawPhotos }) {
  const photos = useMemo(() => normalizeLoadPhotos(rawPhotos), [rawPhotos]);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (photos[index]?.url) void Image.prefetch(photos[index].url);
    if (photos[index + 1]?.url) void Image.prefetch(photos[index + 1].url);
  }, [index, photos]);
  if (!photos.length) return <PhotoFallback />;
  const cardWidth = Math.max(1, width - 36);
  return <View style={styles.inlineRoot}>
    <FlatList data={photos} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={item => item.id} renderItem={({ item, index: itemIndex }) => <Pressable style={[styles.inlinePage, { width: cardWidth }]} onPress={() => { setIndex(itemIndex); setVisible(true); }} accessibilityRole="button" accessibilityLabel={`${itemIndex + 1}. yük fotoğrafını tam ekranda aç`}><CachedLoadPhoto photo={item} style={styles.inlineImage} /></Pressable>} getItemLayout={(_, itemIndex) => ({ length: cardWidth, offset: cardWidth * itemIndex, index: itemIndex })} initialNumToRender={1} windowSize={3} onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth))} />
    <View style={styles.inlineFooter}><View style={styles.dots}>{photos.map((photo, dotIndex) => <View key={photo.id} style={[styles.dot, index === dotIndex && styles.activeDot]} />)}</View><Text style={styles.inlineCounter}>{index + 1} / {photos.length}</Text></View>
    <FullScreenLoadGallery photos={photos} initialIndex={index} visible={visible} onClose={() => setVisible(false)} />
  </View>;
}

const styles = StyleSheet.create({
  thumbnail: { borderRadius: radius.sm, height: 76, overflow: 'hidden', position: 'relative', width: 76 }, thumbnailImage: { height: '100%', width: '100%' }, compactFallback: { height: 76, minHeight: 76, width: 76 }, fallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.sm, borderStyle: 'dashed', borderWidth: 1, justifyContent: 'center', minHeight: 130, padding: spacing.sm }, fallbackText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, retryText: { ...typography.caption, color: colors.primary, marginTop: spacing.xs }, countChip: { backgroundColor: 'rgba(17,24,39,.78)', borderRadius: radius.pill, paddingHorizontal: spacing.xs, paddingVertical: 3, position: 'absolute', right: 5, top: 5 }, countText: { color: colors.white, fontSize: 9, fontWeight: '800' }, inlineRoot: { marginTop: spacing.md }, inlinePage: { height: 218 }, inlineImage: { borderRadius: radius.md, height: '100%', width: '100%' }, inlineFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xs }, dots: { flexDirection: 'row', gap: 5 }, dot: { backgroundColor: colors.borderStrong, borderRadius: 4, height: 6, width: 6 }, activeDot: { backgroundColor: colors.primary, width: 17 }, inlineCounter: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.sm }, viewer: { backgroundColor: '#05070C', flex: 1 }, viewerHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', left: 0, paddingHorizontal: spacing.md, position: 'absolute', right: 0, zIndex: 4 }, viewerCounter: { ...typography.bodyMedium, color: colors.white, textShadowColor: 'rgba(0,0,0,.45)', textShadowRadius: 5 }, closeButton: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,.16)', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 }, fullScreenPage: { alignItems: 'center', flex: 1, justifyContent: 'center' }, viewerHint: { ...typography.caption, color: '#C7CEDB', paddingHorizontal: spacing.lg, textAlign: 'center' },
});
