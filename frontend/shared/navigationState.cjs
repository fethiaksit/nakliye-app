'use strict';

const EDGE_SWIPE_WIDTH = 28;
const SWIPE_ACTIVATE_DX = 12;
const SWIPE_DIRECTION_RATIO = 1.35;
const SWIPE_COMPLETE_RATIO = 0.25;
const SWIPE_VELOCITY_THRESHOLD = 0.35;

const CUSTOMER_ACCOUNT_BACK_MAP = {
  'profile-edit': 'personal',
  'support-new': 'support',
  'support-detail': 'support',
  'legal-doc': 'legal-index',
  'legal-index': 'home',
  'delete-account': 'home',
};

const CORPORATE_ACCOUNT_BACK_MAP = {
  'company-edit': 'company',
  'support-new': 'support',
  'support-detail': 'support',
  'legal-doc': 'legal-index',
  'legal-index': 'home',
  'delete-account': 'home',
};

const DRIVER_ACCOUNT_BACK_MAP = {
  'profile-edit': 'personal',
  'document-detail': 'documents',
  'vehicle-detail': 'vehicles',
  'vehicle-edit': 'vehicle-detail',
  'vehicle-add': 'vehicles',
  'support-new': 'support',
  'support-detail': 'support',
  'legal-doc': 'legal-index',
  'legal-index': 'home',
  'delete-account': 'home',
};

function resolveCustomerAccountBackPage(page, isCorporate = false) {
  if (!page || page === 'home') return 'home';
  const map = isCorporate ? CORPORATE_ACCOUNT_BACK_MAP : CUSTOMER_ACCOUNT_BACK_MAP;
  return map[page] || 'home';
}

function resolveDriverAccountBackPage(page) {
  if (!page || page === 'home') return 'home';
  return DRIVER_ACCOUNT_BACK_MAP[page] || 'home';
}

function shouldRejectEdgeSwipe({ dy = 0, dx = 0 }) {
  return Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx);
}

function shouldCaptureEdgeSwipe({
  platform = 'ios',
  enabled = true,
  modalOpen = false,
  keyboardVisible = false,
  touchCount = 1,
  startX = 0,
  dx = 0,
  dy = 0,
} = {}) {
  if (platform !== 'ios') return false;
  if (!enabled || modalOpen || keyboardVisible) return false;
  if (touchCount !== 1) return false;
  if (!(Number.isFinite(startX) && startX >= 0 && startX <= EDGE_SWIPE_WIDTH)) return false;
  if (dx < SWIPE_ACTIVATE_DX) return false;
  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_DIRECTION_RATIO) return false;
  return true;
}

function shouldCompleteEdgeSwipe({
  dx = 0,
  dy = 0,
  vx = 0,
  screenWidth = 390,
} = {}) {
  if (dx <= 0) return false;
  if (Math.abs(dy) > Math.abs(dx) * 1.2) return false;
  const safeWidth = Number.isFinite(screenWidth) && screenWidth > 0 ? screenWidth : 390;
  const threshold = Math.min(104, Math.max(64, safeWidth * SWIPE_COMPLETE_RATIO));
  if (dx >= threshold) return true;
  if (dx >= 44 && vx >= SWIPE_VELOCITY_THRESHOLD) return true;
  return false;
}

function captureListScrollAnchor({
  loadId,
  scrollOffset = 0,
  itemLayouts = {},
} = {}) {
  const normalizedId = loadId !== undefined && loadId !== null ? String(loadId) : '';
  const safeOffset = Math.max(0, Number.isFinite(Number(scrollOffset)) ? Number(scrollOffset) : 0);
  const layout = normalizedId && itemLayouts ? itemLayouts[normalizedId] : null;
  const hasLayout = Boolean(layout && Number.isFinite(layout.y));
  const itemY = hasLayout ? layout.y : null;
  const itemHeight = hasLayout && Number.isFinite(layout.height) ? layout.height : 0;
  const viewportRelativeY = itemY !== null ? itemY - safeOffset : null;

  return {
    loadId: normalizedId,
    scrollOffset: safeOffset,
    itemY,
    itemHeight,
    viewportRelativeY,
  };
}

function resolveRestoredScrollOffset({
  anchor,
  itemLayouts = {},
  viewportHeight = 0,
  contentHeight = 0,
} = {}) {
  if (!anchor || typeof anchor !== 'object') return null;

  const fallbackOffset = Math.max(0, Number.isFinite(Number(anchor.scrollOffset)) ? Number(anchor.scrollOffset) : 0);
  const layout = anchor.loadId && itemLayouts ? itemLayouts[String(anchor.loadId)] : null;
  let target = fallbackOffset;

  if (layout && Number.isFinite(layout.y)) {
    const itemHeight = Number.isFinite(layout.height) && layout.height > 0 ? layout.height : 0;
    const hasRelative = Number.isFinite(anchor.viewportRelativeY);
    const withinViewport =
      !viewportHeight ||
      viewportHeight <= 0 ||
      (hasRelative && anchor.viewportRelativeY >= -itemHeight && anchor.viewportRelativeY <= viewportHeight);

    if (hasRelative && withinViewport) {
      target = Math.max(0, layout.y - anchor.viewportRelativeY);
    } else if (viewportHeight > 0) {
      const visibleTop = fallbackOffset;
      const visibleBottom = fallbackOffset + viewportHeight;
      const itemBottom = layout.y + itemHeight;
      if (layout.y >= visibleTop && itemBottom <= visibleBottom) {
        target = fallbackOffset;
      } else {
        target = Math.max(0, layout.y - 16);
      }
    } else {
      target = Math.max(0, layout.y - 16);
    }
  }

  if (Number.isFinite(contentHeight) && Number.isFinite(viewportHeight) && contentHeight > 0 && viewportHeight > 0) {
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    target = Math.min(target, maxScroll);
  }

  return Math.max(0, target);
}

function pruneItemLayouts(itemLayouts = {}, items = [], getId = item => item?.id) {
  if (!itemLayouts || typeof itemLayouts !== 'object') return {};
  const validIds = new Set();
  if (Array.isArray(items)) {
    for (const item of items) {
      const id = getId(item);
      if (id !== undefined && id !== null && id !== '') validIds.add(String(id));
    }
  }
  const next = {};
  for (const [key, value] of Object.entries(itemLayouts)) {
    if (validIds.has(key)) next[key] = value;
  }
  return next;
}

module.exports = {
  EDGE_SWIPE_WIDTH,
  SWIPE_ACTIVATE_DX,
  SWIPE_DIRECTION_RATIO,
  SWIPE_COMPLETE_RATIO,
  SWIPE_VELOCITY_THRESHOLD,
  resolveCustomerAccountBackPage,
  resolveDriverAccountBackPage,
  shouldRejectEdgeSwipe,
  shouldCaptureEdgeSwipe,
  shouldCompleteEdgeSwipe,
  captureListScrollAnchor,
  resolveRestoredScrollOffset,
  pruneItemLayouts,
};
