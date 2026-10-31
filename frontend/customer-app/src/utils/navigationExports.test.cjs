const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const babel = require('@babel/core');

// Exercise the public module imported by both App.jsx files. Native UI modules
// are replaced only at the boundary; the resolver functions and exports are real.
const filename = path.resolve(__dirname, '../../../shared/ui/navigation.jsx');
const localRequire = createRequire(filename);
const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename,
  configFile: false,
  babelrc: false,
  plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
const publicModule = { exports: {} };
vm.runInNewContext(source, {
  module: publicModule,
  exports: publicModule.exports,
  require(id) {
    if (id === '../navigationState.cjs') return localRequire(id);
    if (id === 'react') return require('react');
    if (id === 'react-native') return { StyleSheet: { create: styles => styles } };
    if (id === './Icon') return { default: () => null };
    if (id === './theme') return { colors: {}, control: {}, radius: {}, shadows: {}, spacing: {}, typography: {} };
    throw new Error(`Unexpected dependency: ${id}`);
  },
}, { filename });
const navigation = publicModule.exports;
const state = localRequire('../navigationState.cjs');

test('public driver navigation exports the existing resolver and preserves account back routes', () => {
  assert.equal(typeof navigation.resolveDriverAccountBackPage, 'function');
  assert.equal(navigation.resolveDriverAccountBackPage, state.resolveDriverAccountBackPage);
  for (const [page, expected] of [
    ['vehicle-edit', 'vehicle-detail'], ['vehicle-detail', 'vehicles'],
    ['vehicle-add', 'vehicles'], ['document-detail', 'documents'],
    ['profile-edit', 'personal'], ['support-detail', 'support'],
    ['legal-doc', 'legal-index'], ['home', 'home'], ['unknown', 'home'],
  ]) assert.equal(navigation.resolveDriverAccountBackPage(page), expected);
});

test('public customer navigation preserves personal and corporate account back routes', () => {
  assert.equal(typeof navigation.resolveCustomerAccountBackPage, 'function');
  assert.equal(navigation.resolveCustomerAccountBackPage, state.resolveCustomerAccountBackPage);
  assert.equal(navigation.resolveCustomerAccountBackPage('profile-edit', false), 'personal');
  assert.equal(navigation.resolveCustomerAccountBackPage('company-edit', true), 'company');
  assert.equal(navigation.resolveCustomerAccountBackPage('support-detail', true), 'support');
  assert.equal(navigation.resolveCustomerAccountBackPage('legal-doc', false), 'legal-index');
  assert.equal(navigation.resolveCustomerAccountBackPage('home'), 'home');
});
