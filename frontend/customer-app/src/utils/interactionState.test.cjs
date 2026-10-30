'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { asValidDate, clampToMinimum, formatPickerValue, pickerValueForOpen } = require('../../../shared/ui/datePicker.cjs');
const {
  canSendMessage,
  draftAfterSendAttempt,
  normalizeMessageDraft,
  calculateKeyboardVerticalOffset,
  mergeByID,
  isStaleResponse,
  shouldSilentPoll,
} = require('../../../shared/conversationComposer.cjs');
const {
  captureListScrollAnchor,
  pruneItemLayouts,
  resolveCustomerAccountBackPage,
  resolveDriverAccountBackPage,
  resolveRestoredScrollOffset,
  shouldCaptureEdgeSwipe,
  shouldCompleteEdgeSwipe,
} = require('../../../shared/navigationState.cjs');

test('date picker displays a Turkish readable calendar date', () => {
  const value = new Date(2026, 7, 17, 12, 0, 0, 0);
  assert.equal(formatPickerValue('date', value), '17 Ağustos 2026');
});

test('date picker keeps a valid selected value and clamps past values', () => {
  const minimum = new Date(2026, 7, 17, 0, 0, 0, 0);
  const past = new Date(2026, 7, 16, 12, 0, 0, 0);
  const selected = new Date(2026, 7, 19, 12, 0, 0, 0);
  assert.equal(clampToMinimum(selected, minimum).getTime(), selected.getTime());
  assert.equal(clampToMinimum(past, minimum).getTime(), minimum.getTime());
  assert.equal(asValidDate('2026-08-17T09:00:00.000Z').toISOString(), '2026-08-17T09:00:00.000Z');
});

test('date picker accepts today and representative future calendar dates', () => {
  const minimum = new Date(2026, 7, 26, 0, 0, 0, 0);
  const dates = [
    new Date(2026, 7, 26, 12, 0, 0, 0),
    new Date(2026, 7, 27, 12, 0, 0, 0),
    new Date(2026, 8, 2, 12, 0, 0, 0),
    new Date(2026, 8, 15, 12, 0, 0, 0),
    new Date(2027, 0, 1, 12, 0, 0, 0),
  ];
  for (const date of dates) {
    assert.equal(pickerValueForOpen('date', date, minimum).getTime(), date.getTime());
  }

  const yearEndMinimum = new Date(2026, 11, 31, 0, 0, 0, 0);
  const nextYear = new Date(2027, 0, 1, 12, 0, 0, 0);
  assert.equal(pickerValueForOpen('date', nextYear, yearEndMinimum).getTime(), nextYear.getTime());
});

test('date picker opens at local noon and reopens on the existing selected date', () => {
  const minimum = new Date(2026, 7, 26, 0, 0, 0, 0);
  const now = new Date(2026, 7, 26, 23, 30, 0, 0);
  const firstOpen = pickerValueForOpen('date', null, minimum, now);
  assert.equal(firstOpen.getFullYear(), 2026);
  assert.equal(firstOpen.getMonth(), 7);
  assert.equal(firstOpen.getDate(), 26);
  assert.equal(firstOpen.getHours(), 12);

  const selected = new Date(2026, 8, 15, 12, 0, 0, 0);
  const reopened = pickerValueForOpen('date', selected, minimum, now);
  assert.equal(reopened.getTime(), selected.getTime());
});

test('time picker opens one hour ahead and reopens on the selected time', () => {
  const now = new Date(2026, 7, 26, 10, 15, 30, 0);
  const minimum = new Date(2026, 7, 26, 10, 30, 0, 0);
  const firstOpen = pickerValueForOpen('time', null, minimum, now);
  assert.equal(firstOpen.getHours(), 11);
  assert.equal(firstOpen.getMinutes(), 15);
  assert.equal(firstOpen.getSeconds(), 0);

  const selected = new Date(2026, 7, 26, 14, 45, 0, 0);
  const reopened = pickerValueForOpen('time', selected, minimum, now);
  assert.equal(reopened.getTime(), selected.getTime());
});

test('blank chat messages cannot be sent', () => {
  assert.equal(canSendMessage('   \n '), false);
  assert.equal(canSendMessage(' Merhaba '), true);
  assert.equal(normalizeMessageDraft(' Merhaba '), 'Merhaba');
});

test('chat draft is cleared only after success and only if unchanged', () => {
  assert.equal(draftAfterSendAttempt('Merhaba', 'Merhaba', true), '');
  assert.equal(draftAfterSendAttempt('Merhaba', 'Merhaba', false), 'Merhaba');
  assert.equal(draftAfterSendAttempt('Yeni metin', 'Merhaba', true), 'Yeni metin');
});

test('iOS edge swipe-back only captures left-edge horizontal rightward drags without modal or keyboard conflict', () => {
  assert.equal(
    shouldCaptureEdgeSwipe({
      platform: 'ios',
      enabled: true,
      modalOpen: false,
      keyboardVisible: false,
      startX: 16,
      dx: 24,
      dy: 4,
      numberActiveTouches: 1,
    }),
    true,
  );
  // Rejects Android (preserves hardware back behavior)
  assert.equal(
    shouldCaptureEdgeSwipe({
      platform: 'android',
      enabled: true,
      modalOpen: false,
      keyboardVisible: false,
      startX: 16,
      dx: 24,
      dy: 4,
      numberActiveTouches: 1,
    }),
    false,
  );
  // Rejects middle-screen horizontal drags (map pan / photo strip / filter chips)
  assert.equal(
    shouldCaptureEdgeSwipe({
      platform: 'ios',
      enabled: true,
      modalOpen: false,
      keyboardVisible: false,
      startX: 64,
      dx: 40,
      dy: 2,
      numberActiveTouches: 1,
    }),
    false,
  );
  // Rejects open modals and visible keyboard
  assert.equal(
    shouldCaptureEdgeSwipe({
      platform: 'ios',
      enabled: true,
      modalOpen: true,
      keyboardVisible: false,
      startX: 12,
      dx: 30,
      dy: 2,
      numberActiveTouches: 1,
    }),
    false,
  );
  assert.equal(
    shouldCaptureEdgeSwipe({
      platform: 'ios',
      enabled: true,
      modalOpen: false,
      keyboardVisible: true,
      startX: 12,
      dx: 30,
      dy: 2,
      numberActiveTouches: 1,
    }),
    false,
  );
  // Rejects predominantly vertical scrolls
  assert.equal(
    shouldCaptureEdgeSwipe({
      platform: 'ios',
      enabled: true,
      modalOpen: false,
      keyboardVisible: false,
      startX: 14,
      dx: 15,
      dy: 22,
      numberActiveTouches: 1,
    }),
    false,
  );
});

test('edge swipe-back completion checks distance threshold and fast fling velocity', () => {
  assert.equal(shouldCompleteEdgeSwipe({ dx: 110, vx: 0.1, screenWidth: 390 }), true);
  assert.equal(shouldCompleteEdgeSwipe({ dx: 48, vx: 0.55, screenWidth: 390 }), true);
  assert.equal(shouldCompleteEdgeSwipe({ dx: 35, vx: 0.12, screenWidth: 390 }), false);
});

test('list scroll preservation restores exact item position even after list data refreshes', () => {
  const initialLayouts = {
    'load-1': { y: 120, height: 180 },
    'load-2': { y: 316, height: 180 },
    'load-3': { y: 512, height: 180 },
  };
  const anchor = captureListScrollAnchor({
    loadId: 'load-3',
    scrollOffset: 420,
    itemLayouts: initialLayouts,
  });
  assert.deepEqual(anchor, {
    loadId: 'load-3',
    scrollOffset: 420,
    itemY: 512,
    itemHeight: 180,
    viewportRelativeY: 92,
  });

  // Same layouts on return -> exact same scrollOffset (420)
  assert.equal(
    resolveRestoredScrollOffset({
      anchor,
      itemLayouts: initialLayouts,
      viewportHeight: 680,
      contentHeight: 1600,
    }),
    420,
  );

  // List refreshed and a new load was prepended above load-3 (shifting load-3 down by 196px)
  const refreshedLayouts = {
    'load-new': { y: 120, height: 180 },
    'load-1': { y: 316, height: 180 },
    'load-2': { y: 512, height: 180 },
    'load-3': { y: 708, height: 180 },
  };
  assert.equal(
    resolveRestoredScrollOffset({
      anchor,
      itemLayouts: refreshedLayouts,
      viewportHeight: 680,
      contentHeight: 1796,
    }),
    616,
  );

  const pruned = pruneItemLayouts(refreshedLayouts, [{ id: 'load-1' }, { id: 'load-3' }]);
  assert.deepEqual(Object.keys(pruned), ['load-1', 'load-3']);
});

test('account subpage back resolvers match customer, corporate, and driver hierarchies', () => {
  assert.equal(resolveCustomerAccountBackPage('profile-edit', false), 'personal');
  assert.equal(resolveCustomerAccountBackPage('support-detail', false), 'support');
  assert.equal(resolveCustomerAccountBackPage('legal-doc', false), 'legal-index');
  assert.equal(resolveCustomerAccountBackPage('personal', false), 'home');
  assert.equal(resolveCustomerAccountBackPage('company-edit', true), 'company');
  assert.equal(resolveCustomerAccountBackPage('company', true), 'home');
  assert.equal(resolveDriverAccountBackPage('profile-edit'), 'personal');
  assert.equal(resolveDriverAccountBackPage('vehicle-edit'), 'vehicle-detail');
  assert.equal(resolveDriverAccountBackPage('vehicle-detail'), 'vehicles');
  assert.equal(resolveDriverAccountBackPage('vehicles'), 'home');
});

test('calculateKeyboardVerticalOffset offsets header only on iOS and keeps 0 on Android', () => {
  // iOS with iPhone Dynamic Island / notch top inset (e.g. 47) + standard header (78)
  assert.equal(calculateKeyboardVerticalOffset({ platform: 'ios', topInset: 47, headerHeight: 78 }), 125);
  // iOS without safe inset (e.g. older devices)
  assert.equal(calculateKeyboardVerticalOffset({ platform: 'ios', topInset: 0, headerHeight: 78 }), 78);
  // iOS default fallback
  assert.equal(calculateKeyboardVerticalOffset({ platform: 'ios' }), 78);
  // Android leaves offset at 0 so windowSoftInputMode: adjustResize handles layout natively
  assert.equal(calculateKeyboardVerticalOffset({ platform: 'android', topInset: 24, headerHeight: 78 }), 0);
  assert.equal(calculateKeyboardVerticalOffset({ platform: 'android' }), 0);
});

test('mergeByID merges, replaces optimistic messages, and sorts chronologically', () => {
  const current = [
    { id: 'msg-1', body: 'İlk mesaj', createdAt: '2026-10-23T10:00:00.000Z' },
    { id: 'temp-123', clientMessageId: 'cli-abc', body: 'Gönderiliyor...', createdAt: '2026-10-23T10:02:00.000Z' },
  ];
  const incoming = [
    { id: 'msg-1', body: 'İlk mesaj', read: true, createdAt: '2026-10-23T10:00:00.000Z' },
    { id: 'server-999', clientMessageId: 'cli-abc', body: 'Gönderildi!', createdAt: '2026-10-23T10:02:00.000Z' },
    { id: 'msg-2', body: 'Cevap', createdAt: '2026-10-23T10:05:00.000Z' },
  ];

  const merged = mergeByID(current, incoming);
  assert.equal(merged.length, 3);
  // Temporary client message replaced by server id
  assert.equal(merged.find(m => m.id === 'temp-123'), undefined);
  assert.equal(merged.find(m => m.id === 'server-999')?.body, 'Gönderildi!');
  // Read status updated on msg-1
  assert.equal(merged.find(m => m.id === 'msg-1')?.read, true);
  // Chronological order maintained
  assert.equal(merged[0].id, 'msg-1');
  assert.equal(merged[1].id, 'server-999');
  assert.equal(merged[2].id, 'msg-2');

  // Handles empty inputs safely
  assert.deepEqual(mergeByID([], []), []);
  assert.deepEqual(mergeByID(null, null), []);
});

test('isStaleResponse prevents race conditions when older requests resolve out-of-order', () => {
  const currentRequestId = 5;
  assert.equal(isStaleResponse(4, currentRequestId), true);
  assert.equal(isStaleResponse(3, currentRequestId), true);
  assert.equal(isStaleResponse(5, currentRequestId), false);
});

test('shouldSilentPoll respects app state and user presence', () => {
  assert.equal(shouldSilentPoll({ isActiveApp: true, hasUser: true }), true);
  assert.equal(shouldSilentPoll({ isActiveApp: false, hasUser: true }), false);
  assert.equal(shouldSilentPoll({ isActiveApp: true, hasUser: false }), false);
  assert.equal(shouldSilentPoll({ isActiveApp: false, hasUser: false }), false);
});

test('bottom nav visibility rule hides bottom navigation exclusively during active chat', () => {
  const isBottomNavVisible = (tab, isChatActive) => !(tab === 'messages' && isChatActive);
  assert.equal(isBottomNavVisible('home', false), true);
  assert.equal(isBottomNavVisible('loads', false), true);
  assert.equal(isBottomNavVisible('messages', false), true); // conversation list visible -> show bottom nav
  assert.equal(isBottomNavVisible('messages', true), false); // inside an open chat -> hide bottom nav
});

