const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modulePaths = [process.cwd(), path.join(__dirname, '../customer-app'), path.join(__dirname, '../driver-app')];
const babel = require(require.resolve('@babel/core', { paths: modulePaths }));
function loadNotifications(options = {}) {
 const calls = { registered: [], permissions: [], callbacks: {} };
 const N = {
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 }, DEFAULT_ACTION_IDENTIFIER: 'default',
  setNotificationHandler: h => { calls.handler = h; },
  getPermissionsAsync: async () => options.permission || { status: 'granted' },
  requestPermissionsAsync: async o => { calls.permissions.push(o); return { status: 'granted' }; },
  getExpoPushTokenAsync: async o => { calls.project = o; return { data: 'ExpoPushToken[test]' }; },
  addNotificationResponseReceivedListener: f => { calls.callbacks.response = f; return { remove() {} }; },
  getLastNotificationResponseAsync: async () => options.last || null,
  clearLastNotificationResponseAsync: async () => { calls.cleared = true; },
  addPushTokenListener: f => { calls.callbacks.token = f; return { remove() {} }; },
 };
 const constants = { easConfig: { projectId: options.project === undefined ? '8b52d4da-e7d6-4bf0-a44a-60cc1c103cde' : options.project }, expoConfig: { extra: { eas: { projectId: options.project === undefined ? '8b52d4da-e7d6-4bf0-a44a-60cc1c103cde' : options.project } } } };
 const source = fs.readFileSync(path.join(__dirname,'notifications.js'),'utf8');
 const { code } = babel.transformSync(source,{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-modules-commonjs', { paths: modulePaths })]});
 const module = { exports: {} };
 vm.runInNewContext(code,{module,exports:module.exports,Set,Map,Promise,Error,console,require:name=>name==='react-native'?{Platform:{OS:'ios'},AppState:{addEventListener:(_,f)=>{calls.callbacks.appState=f;return{remove(){}};}}}:name==='expo-constants'?{__esModule:true,default:constants}:N});
 const api = { register: async (...args) => calls.registered.push(args), unregister: async token => { calls.unregistered = token; } };
 return { ...module.exports, calls, api };
}
const response = (id='push-1') => ({ actionIdentifier:'default',notification:{request:{identifier:id,content:{data:{screen:'load',loadId:'load-1',type:'payment_approval_pending'}}}} });
test('iOS provisional permission registers with an explicit EAS project instead of losing silent permission',async()=>{
 const n=loadNotifications({permission:{status:'undetermined',ios:{status:3}}});
 const token=await n.registerDevicePushToken(n.api);
 assert.equal(token,'ExpoPushToken[test]');assert.equal(n.calls.permissions.length,0);
 assert.equal(n.calls.project.projectId,'8b52d4da-e7d6-4bf0-a44a-60cc1c103cde');
 assert.equal(n.calls.registered[0][2],'8b52d4da-e7d6-4bf0-a44a-60cc1c103cde');
});
test('missing EAS project fails before token registration',async()=>{
 const n=loadNotifications({project:null});await assert.rejects(n.registerDevicePushToken(n.api),/project/i);assert.equal(n.calls.registered.length,0);
});
test('cold-start and live tap of one notification opens its target once; dismiss cannot navigate',async()=>{
 const r=response(),n=loadNotifications({last:r}),opened=[];
 const stop=n.subscribeNotificationResponses(data=>opened.push(data));n.calls.callbacks.response(r);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(opened.length,1);
 n.calls.callbacks.response({...response('dismiss'),actionIdentifier:'dismiss'});assert.equal(opened.length,1);
 stop();n.calls.callbacks.response(response('after-stop'));assert.equal(opened.length,1);
});
test('notification handler presents foreground banner/list/sound without changing backend state',async()=>{
 const n=loadNotifications();const h=await n.calls.handler.handleNotification();assert.equal(h.shouldShowBanner,true);assert.equal(h.shouldShowList,true);assert.equal(h.shouldPlaySound,true);assert.equal(n.calls.registered.length,0);
});
test('logout still unregisters the current device token',async()=>{
 const n=loadNotifications();await n.unregisterDevicePushToken(n.api,'ExpoPushToken[test]');assert.equal(n.calls.unregistered,'ExpoPushToken[test]');
});

test('registration retries on foreground after network failure and listens for APNs token rotation',async()=>{
 const n=loadNotifications(),tokens=[],errors=[];let attempt=0;
 n.api.register=async(...args)=>{attempt++;if(attempt===1)throw new Error('offline');n.calls.registered.push(args);};
 const stop=n.subscribeDevicePushRegistration(n.api,t=>tokens.push(t),e=>errors.push(e));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(errors.length,1);
 n.calls.callbacks.appState('active');await new Promise(resolve=>setImmediate(resolve));assert.equal(tokens[0],'ExpoPushToken[test]');
 n.calls.callbacks.token({type:'ios',data:'new-apns-token'});await new Promise(resolve=>setImmediate(resolve));assert.equal(n.calls.registered.length,2);
 stop();n.calls.callbacks.appState('active');await new Promise(resolve=>setImmediate(resolve));assert.equal(n.calls.registered.length,2);
});
test('leaving a session during permission/token lookup prevents a late register',async()=>{
 const n=loadNotifications();let current=true;
 const result=n.registerDevicePushToken(n.api,()=>current);current=false;
 assert.equal(await result,null);assert.equal(n.calls.registered.length,0);
});
test('configuration uses each real EAS project and native bundle consistently',()=>{
 for(const [app,id,bundle] of [['customer-app','8b52d4da-e7d6-4bf0-a44a-60cc1c103cde','com.nakliyego.customer'],['driver-app','c95ee8d8-eb16-470f-b3c0-eabe2dce574d','com.nakliyego.driver']]){
  const config=require(path.join(__dirname,'..',app,'app.config.js'));
  assert.equal(config.extra.eas.projectId,id);assert.equal(config.ios.bundleIdentifier,bundle);
  assert.equal(config.ios.entitlements['aps-environment'],'development');assert.ok(config.plugins.includes('expo-notifications'));
 }
});
test('logout waits for in-flight registration before removing its token',async()=>{
 const n=loadNotifications();let finish;
 n.api.register=async()=>new Promise(resolve=>{finish=resolve;});
 const stop=n.subscribeDevicePushRegistration(n.api,()=>{},()=>{});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof finish,'function');
 const logout=Promise.resolve(stop()).then(token=>n.unregisterDevicePushToken(n.api,token));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(n.calls.unregistered,undefined);
 finish();await logout;assert.equal(n.calls.unregistered,'ExpoPushToken[test]');
});
test('revoking permission preserves the last token so logout can remove the binding',async()=>{
 const permission={status:'granted'},n=loadNotifications({permission}),tokens=[];
 const stop=n.subscribeDevicePushRegistration(n.api,t=>tokens.push(t),()=>{});
 await new Promise(resolve=>setImmediate(resolve));permission.status='denied';
 n.calls.callbacks.appState('active');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tokens[tokens.length-1],'ExpoPushToken[test]');
 assert.equal(await stop(),'ExpoPushToken[test]');
});
test('permission-screen refresh shares the logout barrier',async()=>{
 const n=loadNotifications();const stop=n.subscribeDevicePushRegistration(n.api,()=>{},()=>{});
 await new Promise(resolve=>setImmediate(resolve));let finish;
 n.api.register=async()=>new Promise(resolve=>{finish=resolve;});
 const manual=stop.refresh();await new Promise(resolve=>setImmediate(resolve));
 const logout=Promise.resolve(stop()).then(token=>n.unregisterDevicePushToken(n.api,token));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(n.calls.unregistered,undefined);
 finish();await manual;await logout;assert.equal(n.calls.unregistered,'ExpoPushToken[test]');
});
test('development clients are built against beta rather than inheriting an unrelated EAS environment',()=>{
 for(const app of ['customer-app','driver-app']){
  const eas=require(path.join(__dirname,'..',app,'eas.json'));
  assert.equal(eas.build.development.developmentClient,true);
  assert.equal(eas.build.development.env?.EXPO_PUBLIC_API_URL,'https://beta-api-18-157-76-136.sslip.io/api');
 }
});
test('a lost registration response still leaves a known token for logout cleanup',async()=>{
 const n=loadNotifications();n.api.register=async()=>{throw new Error('response lost after server commit');};
 const stop=n.subscribeDevicePushRegistration(n.api,()=>{},()=>{});
 await new Promise(resolve=>setImmediate(resolve));
 const token=await stop();await n.unregisterDevicePushToken(n.api,token);
 assert.equal(n.calls.unregistered,'ExpoPushToken[test]');
});

test('login never prompts for notification permission before explicit user action',async()=>{
 const n=loadNotifications({permission:{status:'undetermined'}});
 assert.equal(await n.registerDevicePushToken(n.api),null);
 assert.equal(n.calls.permissions.length,0);
 assert.equal(n.calls.registered.length,0);
});
