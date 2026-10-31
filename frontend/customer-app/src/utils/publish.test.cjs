const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const generate = require('@babel/generator').default;
const { buildPricingFields, validateLoadFormFields } = require('./loadForm.cjs');

// Run the actual publish callback and its ref initializer, without mounting
// native UI or sending requests to the beta service.
const filename = path.resolve(__dirname, '../../App.jsx');
let callback;
let refDeclaration = '';
let locationDeclaration;
babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] },
  plugins: [() => ({ visitor: { VariableDeclarator(p) {
    if (p.node.id.name === 'locationPayload') locationDeclaration = generate(p.parent).code;
    if (p.node.id.name !== 'publish') return;
    callback = generate(p.node.init.arguments[0]).code;
    const binding = p.scope.getBinding('publishBusy');
    if (binding) refDeclaration = generate(binding.path.parent).code;
  } } })],
});

function setup(overrides = {}) {
  const events = [];
  const form = { title: 'Test yükü', description: 'Test açıklaması', cargoType: 'motosiklet', cargoDetails: { motorcycleType: 'scooter' }, urgencyType: 'immediate', vehicleType: 'farketmez' };
  const photos = [{ uri: 'file:///test.jpg', mimeType: 'image/jpeg' }];
  const state = {
    useRef: current => ({ current }), form, photos, pendingDraftId: null,
    routeDraft: { pickup: { address: 'Test A', latitude: 41, longitude: 29 }, dropoff: { address: 'Test B', latitude: 40, longitude: 30 }, stops: [], route: { distanceMeters: 10000 } },
    buildPricingFields, validateLoadFormFields,
    posthog: { isFeatureEnabled: () => true, capture: () => {} },
    loads: {
      create: async () => { events.push('create'); return { data: { id: 'draft-test' } }; },
      photos: async id => { events.push(`photos:${id}`); },
      publish: async id => { events.push(`publish:${id}`); },
      ...overrides,
    },
    setPendingDraftId: id => { state.pendingDraftId = id; },
    setSaving: value => { events.push(`saving:${value}`); },
    setFormErrors: errors => { state.errors = errors; },
    resetLoadWizard: () => { events.push('reset'); },
    setWizardOpen: value => { events.push(`wizard:${value}`); },
    setTab: value => { events.push(`tab:${value}`); },
    fetchLoads: async () => { events.push('refresh'); },
    apiError: error => error.message,
    showToast: (message, options) => { events.push(`toast:${options.type}`); state.message = message; },
  };
  const publish = vm.runInNewContext(`(() => { ${refDeclaration}\n${locationDeclaration}\nreturn ${callback}; })()`, state);
  return { publish, state, events, form, photos };
}

test('completed customer form publishes and refreshes My Loads', async () => {
  const { publish, events } = setup();
  await publish();
  assert.deepEqual(events, ['saving:true', 'create', 'photos:draft-test', 'publish:draft-test', 'reset', 'wizard:false', 'tab:loads', 'refresh', 'toast:success', 'saving:false']);
});

test('repeated publish taps cannot create two drafts while a request is pending', async () => {
  let finish;
  let creates = 0;
  const { publish } = setup({ create: () => { creates++; return new Promise(resolve => { finish = resolve; }); } });
  const first = publish();
  const second = publish();
  finish?.({ data: { id: 'draft-test' } });
  await Promise.all([first, second]);
  assert.equal(creates, 1);
});

test('upload failure keeps form and photos and retry publishes the same draft', async () => {
  let uploads = 0;
  const { publish, state, events, form, photos } = setup({ photos: async () => { if (++uploads === 1) throw new Error('Fotoğraf yüklenemedi'); } });
  await publish();
  assert.equal(state.pendingDraftId, 'draft-test');
  assert.equal(state.form, form);
  assert.equal(state.photos, photos);
  assert.equal(state.message, 'Fotoğraf yüklenemedi');
  assert.equal(events.includes('reset'), false);
  await publish();
  assert.equal(events.filter(event => event === 'create').length, 1);
  assert.equal(events.includes('publish:draft-test'), true);
  assert.equal(events.includes('toast:success'), true);
});

test('publish rejection keeps the draft and allows retry without creating another listing', async () => {
  let attempts = 0;
  const { publish, state, events, form, photos } = setup({ publish: async () => {
    if (++attempts === 1) throw new Error('İlan yayınlanamadı; tekrar deneyin.');
  } });
  await publish();
  assert.equal(state.pendingDraftId, 'draft-test');
  assert.equal(state.form, form);
  assert.equal(state.photos, photos);
  assert.equal(events.includes('reset'), false);
  assert.equal(state.message, 'İlan yayınlanamadı; tekrar deneyin.');
  await publish();
  assert.equal(attempts, 2);
  assert.equal(events.filter(event => event === 'create').length, 1);
  assert.equal(events.includes('toast:success'), true);
});
