'use strict';

function normalizeMessageDraft(value) {
  return String(value || '').trim();
}

function canSendMessage(value) {
  return normalizeMessageDraft(value).length > 0;
}

function draftAfterSendAttempt(currentDraft, sentBody, succeeded) {
  if (!succeeded) return currentDraft;
  return normalizeMessageDraft(currentDraft) === normalizeMessageDraft(sentBody) ? '' : currentDraft;
}

function mergeByID(current = [], incoming = []) {
  const map = new Map((current || []).map(item => [item.id, item]));
  const clientIDs = new Map((current || []).filter(item => item.clientMessageId).map(item => [item.clientMessageId, item.id]));
  (incoming || []).forEach(item => {
    const optimisticID = item.clientMessageId && clientIDs.get(item.clientMessageId);
    if (optimisticID && optimisticID !== item.id) map.delete(optimisticID);
    map.set(item.id, { ...map.get(item.id), ...item });
  });
  return [...map.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function calculateKeyboardVerticalOffset({ platform = 'ios', topInset = 0, headerHeight = 78 } = {}) {
  if (platform !== 'ios') return 0;
  return Math.max(0, (Number(topInset) || 0) + (Number(headerHeight) || 78));
}

function isStaleResponse(requestId, currentRequestId) {
  return requestId !== currentRequestId;
}

function shouldSilentPoll({ isActiveApp = true, hasUser = true } = {}) {
  return Boolean(isActiveApp && hasUser);
}

module.exports = {
  canSendMessage,
  draftAfterSendAttempt,
  normalizeMessageDraft,
  mergeByID,
  calculateKeyboardVerticalOffset,
  isStaleResponse,
  shouldSilentPoll,
};

