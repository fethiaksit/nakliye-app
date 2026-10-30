// Layout-driven bottom following shared by both mobile apps.
function createConversationScroll({ schedule, cancel, scrollToEnd }) {
  let height = 0;
  let contentHeight = 0;
  let atBottom = true;
  let frame = null;
  const stop = () => {
    if (frame !== null) cancel(frame);
    frame = null;
  };
  const follow = (animated = false) => {
    if (!atBottom || height <= 0 || contentHeight <= 0) return;
    stop();
    frame = schedule(() => {
      frame = null;
      if (atBottom) scrollToEnd({ animated });
    });
  };
  return {
    isAtBottom: () => atBottom,
    layout(value) { height = value; follow(); },
    content(value) { contentHeight = value; follow(); },
    follow,
    toBottom(animated = true) { atBottom = true; follow(animated); },
    onScroll({ offset, height: viewport, contentHeight: content, interacting }) {
      // Native scroll events also fire while the keyboard changes the viewport.
      // Only a user's scroll should change their intent to follow new messages.
      if (!interacting) return;
      atBottom = offset + viewport >= content - 72;
      if (!atBottom) stop();
    },
    reset() { stop(); height = 0; contentHeight = 0; atBottom = true; },
    dispose: stop,
  };
}

module.exports = { createConversationScroll };
