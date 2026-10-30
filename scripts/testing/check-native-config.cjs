// Native iOS projects are intentionally tracked; validate critical identifiers
// instead of regenerating them with prebuild (which would erase local fixes).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(process.argv[2] || '.');
const expected = {
 'customer-app': ['com.nakliyego.customer', '8b52d4da-e7d6-4bf0-a44a-60cc1c103cde'],
 'driver-app': ['com.nakliyego.driver', 'c95ee8d8-eb16-470f-b3c0-eabe2dce574d'],
}[path.basename(dir)];
assert.ok(expected, 'Unknown mobile app');
const config = require(path.join(dir, 'app.config.js'));
assert.equal(config.ios.bundleIdentifier, expected[0]);
assert.equal(config.extra.eas.projectId, expected[1]);
const project = fs.readdirSync(path.join(dir, 'ios')).find(name => !name.startsWith('._') && name.endsWith('.xcodeproj') && fs.statSync(path.join(dir, 'ios', name)).isDirectory());
assert.ok(project, 'Tracked native iOS project missing');
const native = fs.readFileSync(path.join(dir, 'ios', project, 'project.pbxproj'), 'utf8');
const ids = [...native.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\s]+)/g)].map(match => match[1]);
assert.ok(ids.length > 0 && ids.every(id => id === expected[0]), 'Native Bundle Identifier mismatch');
const name = project.replace('.xcodeproj', '');
const entitlement = fs.readFileSync(path.join(dir, 'ios', name, `${name}.entitlements`), 'utf8');
const aps = entitlement.match(/<key>aps-environment<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
assert.equal(aps, config.ios.entitlements['aps-environment'], 'Native APNs entitlement mismatch');
assert.ok(config.plugins.includes('expo-notifications'));
console.log(`${path.basename(dir)} native Bundle ID / EAS project / APNs config consistent`);
