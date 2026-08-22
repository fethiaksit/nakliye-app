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

module.exports = { canSendMessage, draftAfterSendAttempt, normalizeMessageDraft };
