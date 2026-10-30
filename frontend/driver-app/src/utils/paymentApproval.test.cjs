const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../../..');
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment' };
function moduleFromFile(file, requireModule) {
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), { filename: file, babelrc: false, configFile: false, plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')] });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireModule, Intl, Number });
  return module.exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test('driver sees exact cash and credit and explicitly chooses accept/reject before starting', async () => {
  const wallet = await import('../../../shared/walletMoney.mjs');
  const status = moduleFromFile(path.join(root, 'shared/loadStatus.js'), () => ({}));
  const theme = moduleFromFile(path.join(root, 'shared/ui/theme.js'), () => ({}));
  const detail = moduleFromFile(path.join(root, 'driver-app/src/screens/DriverScreens.jsx'), name => {
    if (name === 'react') return react;
    if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: s => s } };
    if (name.endsWith('/walletMoney.mjs')) return wallet;
    if (name.endsWith('/loadStatus')) return status;
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/presentation')) return { ...status, toFiniteNumber: Number };
    if (name.endsWith('/primitives')) return { AppButton: 'AppButton', SectionCard: 'SectionCard' };
    return { __esModule: true, default: name };
  }).DriverJobDetail;
  const load = { id: 'load', status: 'payment_approval_pending', paymentApproval: { id: 'selection', driverId: 'driver', amountCents: 410000, creditCents: 6000, customerPayableCents: 404000, status: 'pending' } };
  const decisions = [];
  const tree = detail({ selected: load, user: { id: 'driver' }, onPaymentApproval: (l, accept) => decisions.push([l.paymentApproval.id, accept]) });
  const all = nodes(tree);
  const text = JSON.stringify(tree);
  assert.ok(text.includes(wallet.formatWalletCents(404000)));
  assert.ok(text.includes(wallet.formatWalletCents(6000)));
  assert.ok(text.includes('Cüzdan kredisi nakit ödeme değildir'));
  const buttons = all.filter(n => n.type === 'AppButton');
  const accept = buttons.find(n => n.props.label === 'Ödeme Şeklini Onayla ve İşi Al');
  const reject = buttons.find(n => n.props.label === 'Reddet');
  assert.ok(accept); assert.ok(reject);
  assert.equal(buttons.some(n => n.props.label === 'Yola Çıktım'), false);
  accept.props.onPress(); reject.props.onPress();
  assert.deepEqual(decisions, [['selection', true], ['selection', false]]);
  const stale = nodes(detail({ selected: { ...load, status: 'driver_selected', assignedDriverId: 'driver' }, user: { id: 'driver' } }));
  assert.ok(stale.find(n => n.props?.label === 'Ödeme Şeklini Onayla ve İşi Al'));
  assert.equal(stale.some(n => n.props?.label === 'Yola Çıktım'), false);
  const busy = nodes(detail({ selected: load, user: { id: 'driver' }, paymentSaving: true }));
  assert.equal(busy.find(n => n.props?.label === 'Ödeme Şeklini Onayla ve İşi Al').props.disabled, true);
});

test('customer selects 60 TL with the offer and sees 4040 TL payable before requesting consent', async () => {
  const wallet = await import('../../../shared/walletMoney.mjs');
  const payment = await import('../../../shared/paymentApproval.mjs');
  const theme = moduleFromFile(path.join(root, 'shared/ui/theme.js'), () => ({}));
  const detail = moduleFromFile(path.join(root, 'customer-app/src/screens/CustomerScreens.jsx'), name => {
    if (name === 'react') return { ...react, useState: () => ['60', () => {}], useEffect: () => {} };
    if (name === 'react-native') return { View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: s => s } };
    if (name.endsWith('/walletMoney.mjs')) return wallet;
    if (name.endsWith('/paymentApproval.mjs')) return payment;
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/presentation')) return { toFiniteNumber: (v, fallback = 0) => Number(v ?? fallback), formatMoney: String, loadStatusLabel: String };
    if (name.endsWith('/listing')) return { DetailRow: 'DetailRow', StatusBadge: 'StatusBadge', RouteTimeline: 'RouteTimeline' };
    if (name.endsWith('/primitives')) return { AppButton: 'AppButton', SectionCard: 'SectionCard', TextField: 'TextField', Divider: 'Divider' };
    if (name.endsWith('/navigation')) return { PageHeading: 'PageHeading' };
    return { __esModule: true, default: name };
  }).CustomerLoadDetail;
  let selected;
  const tree = detail({ selected: { id: 'load', status: 'published', basePriceTl: 3450 }, offers: [{ offer: { id: 'offer', status: 'pending', amountTl: 4100 } }], isCorporate: true, walletInfo: { enabled: true, maxUsageBps: 2500, wallet: { balanceCents: 100000 } }, onAccept: offer => { selected = offer; } });
  const all = nodes(tree);
  assert.ok(all.find(n => n.type === 'DetailRow' && n.props.label === 'Şoföre ödenecek kalan' && n.props.value === wallet.formatWalletCents(404000)));
  const select = all.find(n => n.type === 'AppButton' && n.props.label === 'Ödeme onayına gönder');
  assert.ok(select); assert.equal(select.props.disabled, false);
  select.props.onPress();
  assert.equal(selected.id, 'offer'); assert.equal(selected.selectedCreditCents, 6000);
});

test('disabled corporate wallet still sends cash-only payment for driver consent', async () => {
  const wallet = await import('../../../shared/walletMoney.mjs');
  const payment = await import('../../../shared/paymentApproval.mjs');
  const theme = moduleFromFile(path.join(root, 'shared/ui/theme.js'), () => ({}));
  const detail = moduleFromFile(path.join(root, 'customer-app/src/screens/CustomerScreens.jsx'), name => {
    if (name === 'react') return { ...react, useState: () => ['60', () => {}], useEffect: () => {} };
    if (name === 'react-native') return { StyleSheet: { create: s => s }, View: 'View', Text: 'Text' };
    if (name.endsWith('/walletMoney.mjs')) return wallet;
    if (name.endsWith('/paymentApproval.mjs')) return payment;
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/presentation')) return { toFiniteNumber: (v, fallback = 0) => Number(v ?? fallback), formatMoney: String, loadStatusLabel: String };
    if (name.endsWith('/primitives')) return { AppButton: 'AppButton', SectionCard: 'SectionCard' };
    return { __esModule: true, default: name };
  }).CustomerLoadDetail;
  let selection;
  const tree = detail({ selected: { id: 'load', status: 'published' }, offers: [{ offer: { id: 'offer', status: 'pending', amountTl: 4100 } }], isCorporate: true, walletInfo: { enabled: false, maxUsageBps: 2500, wallet: { balanceCents: 100000 } }, onAccept: v => { selection = v; } });
  const button = nodes(tree).find(n => n.type === 'AppButton' && n.props.label === 'Ödeme onayına gönder');
  assert.ok(button); button.props.onPress(); assert.equal(selection.selectedCreditCents, 0);
});

test('selected driver offer routes to payment consent and hides edit/withdraw during approval', () => {
  const theme = moduleFromFile(path.join(root, 'shared/ui/theme.js'), () => ({}));
  const card = moduleFromFile(path.join(root, 'driver-app/src/components/driver/DriverOfferCard.jsx'), name => {
    if (name === 'react') return react;
    if (name === 'react-native') return { StyleSheet: { create: s => s }, View: 'View', Text: 'Text' };
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/loadMetadata')) return { formatListingTime: () => '' };
    if (name.endsWith('/presentation')) return { formatMoney: String };
    if (name.endsWith('/DriverJobCard')) return { getShortLocation: () => '' };
    if (name.endsWith('/primitives')) return { AppButton: 'AppButton' };
    return { __esModule: true, default: name };
  }).default;
  const tree = card({ item: { offer: { id: 'offer', status: 'pending' }, load: { status: 'payment_approval_pending', paymentApproval: { offerId: 'offer' } } } });
  const buttons = nodes(tree).filter(n => n.type === 'AppButton');
  assert.ok(buttons.find(n => n.props.label === 'Ödeme Şeklini İncele'));
  assert.equal(buttons.some(n => ['Düzenle', 'Geri Çek'].includes(n.props.label)), false);
});

test('approval state is shared across aliases and stale operational status', () => {
  const status = moduleFromFile(path.join(root, 'shared/loadStatus.js'), () => ({}));
  assert.equal(status.canonicalLoadStatus('driver_payment_approval_pending'), 'payment_approval_pending');
  assert.equal(status.requiresDriverPaymentApproval({ status: 'driver_payment_approval_pending' }), true);
  assert.equal(status.requiresDriverPaymentApproval({ status: 'driver_selected', paymentApproval: { status: 'pending' } }), true);
  assert.equal(status.requiresDriverPaymentApproval({ status: 'driver_selected' }), false);
  assert.equal(status.requiresDriverPaymentApproval({ status: 'completed', paymentApproval: { status: 'pending' } }), false);
});

test('pending payment is prominent on dashboard and its action opens consent instead of status change', () => {
  const status = moduleFromFile(path.join(root, 'shared/loadStatus.js'), () => ({}));
  const theme = moduleFromFile(path.join(root, 'shared/ui/theme.js'), () => ({}));
  const dependency = name => {
    if (name === 'react') return { ...react, useState: () => ['all', () => {}], useMemo: fn => fn() };
    if (name === 'react-native') return { StyleSheet: { create: s => s }, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView' };
    if (name.endsWith('/loadStatus')) return status;
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/presentation')) return { ...status, toFiniteNumber: Number };
    if (name.endsWith('/DriverJobCard')) return { __esModule: true, default: 'DriverJobCard', getShortLocation: () => '' };
    return { __esModule: true, default: name };
  };
  const load = { id: 'pending', status: 'payment_approval_pending', paymentApproval: { driverId: 'driver', status: 'pending' } };
  const screens = moduleFromFile(path.join(root, 'driver-app/src/screens/DriverScreens.jsx'), dependency);
  const dashboard = screens.DriverJobs({ jobs: [load], user: { id: 'driver' } });
  const cardNode = nodes(dashboard).find(n => n.type?.endsWith?.('/ActiveJobCard'));
  assert.ok(cardNode, 'dashboard must surface the pending payment');
  assert.equal(cardNode.props.load.id, load.id);
  const card = moduleFromFile(path.join(root, 'driver-app/src/components/driver/ActiveJobCard.jsx'), dependency).default;
  const opened = [], transitions = [];
  const tree = card({ load, onPress: l => opened.push(l.id), onAction: (...args) => transitions.push(args) });
  const button = nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityRole === 'button');
  button.props.onPress();
  assert.deepEqual(opened, ['pending']);
  assert.deepEqual(transitions, []);
  assert.ok(JSON.stringify(tree).includes('Ödeme Şeklini İncele'));
  const offerDashboard = screens.DriverJobs({ jobs: [], myOffers: [{ load }], user: { id: 'driver' } });
  assert.equal(nodes(offerDashboard).find(n => n.type?.endsWith?.('/ActiveJobCard')).props.load.id, load.id);
  const otherDriver = screens.DriverJobs({ jobs: [load], user: { id: 'other' } });
  assert.equal(nodes(otherDriver).some(n => n.type?.endsWith?.('/ActiveJobCard')), false);
  const cash = { id: 'cash', status: 'driver_selected', assignedDriverId: 'driver' };
  const cashTree = card({ load: cash, onPress: l => opened.push(l.id), onAction: (l, status) => transitions.push([l.id, status]) });
  nodes(cashTree).find(n => n.type === 'Pressable' && n.props.accessibilityRole === 'button').props.onPress();
  assert.deepEqual(transitions, [['cash', 'driver_en_route']]);
});

test('PaymentApprovalModal displays minimal breakdown, explanatory text, and triggers approve/reject/close', async () => {
  const wallet = await import('../../../shared/walletMoney.mjs');
  const theme = moduleFromFile(path.join(root, 'shared/ui/theme.js'), () => ({}));
  const modal = moduleFromFile(path.join(root, 'driver-app/src/components/driver/PaymentApprovalModal.jsx'), name => {
    if (name === 'react') return react;
    if (name === 'react-native') return { Modal: 'Modal', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: s => s } };
    if (name.endsWith('/walletMoney.mjs')) return wallet;
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/primitives')) return { AppButton: 'AppButton' };
    return { __esModule: true, default: name };
  }).default;

  const load = {
    id: 'load-123',
    status: 'payment_approval_pending',
    paymentApproval: {
      id: 'approval-456',
      driverId: 'driver-789',
      amountCents: 410000,
      customerPayableCents: 404000,
      creditCents: 6000,
      status: 'pending',
    },
  };

  const approved = [];
  const rejected = [];
  let closed = false;

  const tree = modal({
    visible: true,
    load,
    loading: false,
    onApprove: l => approved.push(l.id),
    onReject: l => rejected.push(l.id),
    onClose: () => { closed = true; },
  });

  const all = nodes(tree);
  const text = JSON.stringify(tree);

  assert.ok(text.includes('KURUMSAL NAKLİYE'));
  assert.ok(text.includes(wallet.formatWalletCents(410000)));
  assert.ok(text.includes(wallet.formatWalletCents(404000)));
  assert.ok(text.includes(wallet.formatWalletCents(6000)));

  const buttons = all.filter(n => n.type === 'AppButton');
  const approveBtn = buttons.find(n => n.props.label === 'Ödeme Şeklini Onayla ve İşi Al');
  const rejectBtn = buttons.find(n => n.props.label === 'Reddet');

  assert.ok(approveBtn);
  assert.ok(rejectBtn);

  approveBtn.props.onPress();
  assert.deepEqual(approved, ['load-123']);

  rejectBtn.props.onPress();
  assert.deepEqual(rejected, ['load-123']);

  const closePressable = all.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Kapat');
  assert.ok(closePressable);
  closePressable.props.onPress();
  assert.equal(closed, true);
});
