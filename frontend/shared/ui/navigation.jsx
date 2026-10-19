import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import Icon from './Icon';
import { colors, control, radius, shadows, spacing, typography } from './theme';

const {
  captureListScrollAnchor,
  pruneItemLayouts,
  resolveRestoredScrollOffset,
  shouldCaptureEdgeSwipe,
  shouldCompleteEdgeSwipe,
  shouldRejectEdgeSwipe,
} = require('../navigationState.cjs');

export function AppHeader({ title, subtitle, initials, action, topInset = 0 }) {
  return <View style={[styles.header, { paddingTop: topInset + spacing.sm }]}><View style={styles.brandMark}><Icon name="cube" size={23} color={colors.white} /></View><View style={styles.headerCopy}><Text style={styles.headerTitle}>{title}</Text>{subtitle ? <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text> : null}</View>{action || <View style={styles.avatar}><Text style={styles.avatarText}>{initials || '?'}</Text></View>}</View>;
}

export function BottomNav({ items, value, onChange, bottomInset = 0 }) {
  return <View style={[styles.nav, { height: control.bottomNavHeight + bottomInset, paddingBottom: bottomInset }]}>{items.map(item => {
    const active = item.value === value;
    return <Pressable key={item.value} accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(item.value)} style={styles.navItem}><View style={[styles.navIcon, active && styles.navIconActive]}><Icon name={active ? item.activeIcon || item.icon : item.icon} size={23} color={active ? colors.primary : colors.textMuted} />{item.badge ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{item.badge > 99 ? '99+' : item.badge}</Text></View> : null}</View><Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text></Pressable>;
  })}</View>;
}

export function PageHeading({ eyebrow, title, subtitle, action }) {
  return <View style={styles.pageHeading}><View style={styles.pageHeadingCopy}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.pageTitle}>{title}</Text>{subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}</View>{action}</View>;
}

export function useAndroidBackHandler(enabled, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (typeof onBackRef.current === 'function') {
        onBackRef.current();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [enabled]);
}

export function EdgeSwipeBack({
  enabled = false,
  modalOpen = false,
  onBack,
  style,
  children,
}) {
  const { width } = useWindowDimensions();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const rejectedRef = useRef(false);
  const stateRef = useRef({ enabled, modalOpen, keyboardVisible, onBack, width });
  stateRef.current = { enabled, modalOpen, keyboardVisible, onBack, width };

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      translateX.setValue(0);
    }
  }, [enabled, translateX]);

  const resetPosition = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 24,
    }).start();
  }, [translateX]);

  const evaluateMove = useCallback((event, gestureState) => {
    if (rejectedRef.current) return false;
    const current = stateRef.current;
    const touchCount = event?.nativeEvent?.touches?.length || 1;
    const startX = startXRef.current || gestureState.x0 || 0;
    const dx = gestureState.dx;
    const dy = gestureState.dy;

    if (shouldRejectEdgeSwipe({ dx, dy })) {
      rejectedRef.current = true;
      return false;
    }

    return shouldCaptureEdgeSwipe({
      platform: Platform.OS,
      enabled: current.enabled && typeof current.onBack === 'function',
      modalOpen: current.modalOpen,
      keyboardVisible: current.keyboardVisible,
      touchCount,
      startX,
      dx,
      dy,
    });
  }, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: event => {
      const touches = event?.nativeEvent?.touches;
      if (!touches || touches.length === 1) {
        startXRef.current = event?.nativeEvent?.pageX ?? 0;
        startYRef.current = event?.nativeEvent?.pageY ?? 0;
        rejectedRef.current = false;
      } else {
        rejectedRef.current = true;
      }
      return false;
    },
    onMoveShouldSetPanResponder: evaluateMove,
    onMoveShouldSetPanResponderCapture: evaluateMove,
    onPanResponderMove: (_, gestureState) => {
      const dx = Math.max(0, Math.min(stateRef.current.width || 390, gestureState.dx));
      translateX.setValue(dx);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gestureState) => {
      const current = stateRef.current;
      if (
        current.enabled &&
        !current.modalOpen &&
        !current.keyboardVisible &&
        typeof current.onBack === 'function' &&
        shouldCompleteEdgeSwipe({
          dx: gestureState.dx,
          dy: gestureState.dy,
          vx: gestureState.vx,
          screenWidth: current.width,
        })
      ) {
        translateX.setValue(0);
        current.onBack();
        return;
      }
      resetPosition();
    },
    onPanResponderTerminate: () => {
      resetPosition();
    },
  }), [evaluateMove, resetPosition, translateX]);

  if (Platform.OS !== 'ios') {
    return <View style={style}>{children}</View>;
  }

  return (
    <Animated.View
      style={[style, enabled ? { transform: [{ translateX }] } : null]}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

export function useListScrollPreservation({
  activeTab,
  isDetailOpen = false,
  accountPage = 'home',
  itemsByTab = {},
}) {
  const scrollRef = useRef(null);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const bucketsRef = useRef({});
  const activeTabRef = useRef(activeTab);
  const isDetailOpenRef = useRef(isDetailOpen);
  const accountPageRef = useRef(accountPage);
  const prevDetailOpenRef = useRef(isDetailOpen);
  const prevTabRef = useRef(activeTab);
  const prevAccountPageRef = useRef(accountPage);

  activeTabRef.current = activeTab;
  isDetailOpenRef.current = isDetailOpen;
  accountPageRef.current = accountPage;

  const getBucket = useCallback(tabKey => {
    const key = String(tabKey || 'default');
    if (!bucketsRef.current[key]) {
      bucketsRef.current[key] = {
        scrollOffset: 0,
        itemLayouts: {},
        anchor: null,
        pendingRestore: false,
        subpageOffsets: {},
      };
    }
    return bucketsRef.current[key];
  }, []);

  const applyRestore = useCallback((tabKey = activeTabRef.current) => {
    if (isDetailOpenRef.current || activeTabRef.current !== tabKey) return;
    const bucket = getBucket(tabKey);
    const resolved = bucket.anchor
      ? resolveRestoredScrollOffset({
          anchor: bucket.anchor,
          itemLayouts: bucket.itemLayouts,
          viewportHeight: viewportHeightRef.current,
          contentHeight: contentHeightRef.current,
        })
      : bucket.scrollOffset;
    if (resolved === null || !Number.isFinite(resolved)) return;
    bucket.scrollOffset = resolved;
    scrollRef.current?.scrollTo({ y: resolved, animated: false });
  }, [getBucket]);

  const onScroll = useCallback(event => {
    const y = Math.max(0, Number(event?.nativeEvent?.contentOffset?.y) || 0);
    const tabKey = activeTabRef.current;
    const bucket = getBucket(tabKey);
    bucket.scrollOffset = y;
    if (tabKey === 'account') {
      bucket.subpageOffsets[accountPageRef.current || 'home'] = y;
    }
  }, [getBucket]);

  const onScrollBeginDrag = useCallback(() => {
    const bucket = getBucket(activeTabRef.current);
    bucket.pendingRestore = false;
  }, [getBucket]);

  const onViewportLayout = useCallback(event => {
    const height = Number(event?.nativeEvent?.layout?.height) || 0;
    if (height > 0) viewportHeightRef.current = height;
  }, []);

  const onContentSizeChange = useCallback((_, height) => {
    const nextHeight = Number(height) || 0;
    if (nextHeight > 0) contentHeightRef.current = nextHeight;
    const tabKey = activeTabRef.current;
    const bucket = getBucket(tabKey);
    if (!isDetailOpenRef.current && bucket.pendingRestore && bucket.anchor) {
      applyRestore(tabKey);
    }
  }, [applyRestore, getBucket]);

  const onItemLayout = useCallback((tabKey, loadId, layout) => {
    if (loadId === undefined || loadId === null || !layout) return;
    const bucket = getBucket(tabKey);
    const key = String(loadId);
    const prev = bucket.itemLayouts[key];
    const nextY = Number(layout.y) || 0;
    const nextHeight = Number(layout.height) || 0;
    bucket.itemLayouts[key] = { y: nextY, height: nextHeight };
    if (
      bucket.pendingRestore &&
      bucket.anchor?.loadId === key &&
      !isDetailOpenRef.current &&
      activeTabRef.current === tabKey &&
      (!prev || Math.abs(prev.y - nextY) > 1)
    ) {
      requestAnimationFrame(() => applyRestore(tabKey));
    }
  }, [applyRestore, getBucket]);

  const rememberItem = useCallback((loadId, tabKey = activeTabRef.current) => {
    const bucket = getBucket(tabKey);
    bucket.anchor = captureListScrollAnchor({
      loadId,
      scrollOffset: bucket.scrollOffset,
      itemLayouts: bucket.itemLayouts,
    });
    bucket.pendingRestore = true;
  }, [getBucket]);

  const clearAnchor = useCallback((tabKey = activeTabRef.current) => {
    const bucket = getBucket(tabKey);
    bucket.anchor = null;
    bucket.pendingRestore = false;
  }, [getBucket]);

  useEffect(() => {
    for (const [tabKey, listItems] of Object.entries(itemsByTab || {})) {
      if (Array.isArray(listItems)) {
        const bucket = getBucket(tabKey);
        bucket.itemLayouts = pruneItemLayouts(bucket.itemLayouts, listItems);
        if (!isDetailOpen && activeTab === tabKey && bucket.pendingRestore && bucket.anchor) {
          requestAnimationFrame(() => applyRestore(tabKey));
        }
      }
    }
  }, [activeTab, applyRestore, getBucket, isDetailOpen, itemsByTab]);

  useEffect(() => {
    const wasDetailOpen = prevDetailOpenRef.current;
    prevDetailOpenRef.current = isDetailOpen;
    if (wasDetailOpen && !isDetailOpen) {
      const bucket = getBucket(activeTab);
      bucket.pendingRestore = true;
      applyRestore(activeTab);
      const frame = requestAnimationFrame(() => applyRestore(activeTab));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [activeTab, applyRestore, getBucket, isDetailOpen]);

  useEffect(() => {
    if (prevTabRef.current === activeTab) return undefined;
    prevTabRef.current = activeTab;
    if (isDetailOpen) return undefined;
    const bucket = getBucket(activeTab);
    if (activeTab === 'account') {
      const targetY = Math.max(0, Number(bucket.subpageOffsets[accountPage || 'home']) || 0);
      bucket.scrollOffset = targetY;
      const frame = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: targetY, animated: false });
      });
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => applyRestore(activeTab));
    return () => cancelAnimationFrame(frame);
  }, [accountPage, activeTab, applyRestore, getBucket, isDetailOpen]);

  useEffect(() => {
    if (prevAccountPageRef.current === accountPage) return undefined;
    prevAccountPageRef.current = accountPage;
    if (activeTab !== 'account') return undefined;
    const bucket = getBucket('account');
    const targetY = accountPage === 'home' ? Math.max(0, Number(bucket.subpageOffsets.home) || 0) : 0;
    bucket.scrollOffset = targetY;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: targetY, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [accountPage, activeTab, getBucket]);

  return {
    scrollRef,
    onScroll,
    onScrollBeginDrag,
    onViewportLayout,
    onContentSizeChange,
    onItemLayout,
    rememberItem,
    clearAnchor,
  };
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', backgroundColor: colors.ink, flexDirection: 'row', minHeight: 78, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg }, brandMark: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.sm, height: 42, justifyContent: 'center', marginRight: spacing.sm, width: 42 }, headerCopy: { flex: 1 }, headerTitle: { ...typography.h3, color: colors.white }, headerSubtitle: { ...typography.caption, color: '#B9C5D2', marginTop: 2 }, avatar: { alignItems: 'center', backgroundColor: '#E8F0EE', borderColor: 'rgba(255,255,255,.15)', borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 }, avatarText: { ...typography.smallMedium, color: colors.primaryDark },
  nav: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, flexDirection: 'row', left: 0, position: 'absolute', right: 0, ...shadows.card }, navItem: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: spacing.xs }, navIcon: { alignItems: 'center', borderRadius: radius.pill, height: 31, justifyContent: 'center', position: 'relative', width: 48 }, navIconActive: { backgroundColor: colors.primarySoft }, navBadge: { alignItems: 'center', backgroundColor: colors.danger, borderColor: colors.surface, borderRadius: 9, borderWidth: 2, justifyContent: 'center', minHeight: 18, minWidth: 18, paddingHorizontal: 3, position: 'absolute', right: 2, top: -3 }, navBadgeText: { color: colors.white, fontSize: 8, fontWeight: '800' }, navLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 }, navLabelActive: { color: colors.primaryDark, fontWeight: '800' },
  pageHeading: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg }, pageHeadingCopy: { flex: 1 }, eyebrow: { ...typography.caption, color: colors.primary, letterSpacing: .8, marginBottom: spacing.xxs, textTransform: 'uppercase' }, pageTitle: { ...typography.h1, color: colors.ink }, pageSubtitle: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
});

