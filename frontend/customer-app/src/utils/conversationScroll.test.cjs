const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationScroll } = require('../../../shared/conversationScroll.cjs');

function setup() {
  const frames = new Map();
  const calls = [];
  let id = 0;
  const scroll = createConversationScroll({
    schedule: callback => { frames.set(++id, callback); return id; },
    cancel: key => frames.delete(key),
    scrollToEnd: options => calls.push(options),
  });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  return { scroll, calls, flush };
}

test('initial messages wait for both viewport and content measurement', () => {
  const { scroll, calls, flush } = setup();
  scroll.content(1200);
  flush();
  assert.equal(calls.length, 0);
  scroll.layout(600);
  flush();
  assert.deepEqual(calls, [{ animated: false }]);
});

test('keyboard and growing composer follow the last message after viewport shrinks', () => {
  const { scroll, calls, flush } = setup();
  scroll.layout(600); scroll.content(1200); flush();
  scroll.layout(300); flush();
  scroll.layout(250); flush();
  scroll.layout(600); flush();
  assert.equal(calls.length, 4);
  assert.equal(scroll.isAtBottom(), true);
});

test('new messages follow bottom but history readers keep their position', () => {
  const { scroll, calls, flush } = setup();
  scroll.layout(600); scroll.content(1200); flush();
  scroll.content(1300); flush();
  assert.equal(calls.length, 2);
  scroll.onScroll({ offset: 100, height: 600, contentHeight: 1300, interacting: true });
  scroll.content(1400); scroll.layout(300); scroll.follow(); flush();
  assert.equal(calls.length, 2);
  assert.equal(scroll.isAtBottom(), false);
  scroll.toBottom(); flush();
  assert.equal(calls.length, 3);
  assert.equal(scroll.isAtBottom(), true);
});

test('resize scroll events do not cancel bottom following; user drag cancels queued scroll', () => {
  const { scroll, calls, flush } = setup();
  scroll.layout(600); scroll.content(1200); flush();
  scroll.layout(300);
  scroll.onScroll({ offset: 600, height: 300, contentHeight: 1200, interacting: false });
  flush();
  assert.equal(calls.length, 2);
  scroll.content(1400);
  scroll.onScroll({ offset: 100, height: 300, contentHeight: 1400, interacting: true });
  flush();
  assert.equal(calls.length, 2);
});

test('switching conversations cancels old scroll and restores initial bottom following', () => {
  const { scroll, calls, flush } = setup();
  scroll.layout(600); scroll.content(1200);
  scroll.reset(); flush();
  assert.equal(calls.length, 0);
  scroll.content(1600); flush();
  assert.equal(calls.length, 0);
  scroll.layout(500); flush();
  assert.equal(calls.length, 1);
});
