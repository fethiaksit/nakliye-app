const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modulePaths = [path.join(__dirname, '../customer-app'), path.join(__dirname, '../driver-app')];
const babel = require(require.resolve('@babel/core', { paths: modulePaths }));

function screen(app, fail) {
 const calls = { deleted: [], logout: 0, toast: [] };
 const react = { createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:value=>[typeof value==='function'?value():value,()=>{}],useCallback:fn=>fn,useEffect:()=>{} };
 const api = { profile:{deleteAccount:async payload=>{calls.deleted.push(payload);if(fail)throw Error('active load');}},apiError:e=>e.message };
 const name=app==='customer-app'?'Customer':'Driver';
 const source=fs.readFileSync(path.join(__dirname,`../${app}/src/screens/${name}AccountScreens.jsx`),'utf8');
 const {code}=babel.transformSync(source,{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-react-jsx',{paths:modulePaths}),require.resolve('@babel/plugin-transform-modules-commonjs',{paths:modulePaths})]});
 const generic=new Proxy({},{get:(_,key)=>key==='__esModule'?true:key==='default'?'component':()=>{}});
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,console,require:n=>{
  if(n==='react') return {...react,default:react,__esModule:true};
  if(n==='react-native') return {StyleSheet:{create:x=>x}};
  if(n.endsWith('/services/api'))return api;
  if(n.endsWith('/ui/theme'))return {colors:{},radius:{},spacing:{},typography:{}};
  if(n.endsWith('/ui/feedback'))return {useToast:()=>({showToast:(...a)=>calls.toast.push(a)})};
  if(n.endsWith('/ui/account'))return {DeleteAccountPage:'delete-page',useAccountBack:()=>{}};
  return generic;
 }});
 const root=mod.exports.default({page:'delete-account',account:{},form:{},logout:async()=>{calls.logout++;}});
 const find=node=>node?.type==='delete-page'?node:(node?.props?.children || []).flat(Infinity).map(find).find(Boolean);
 const tree=find(root);
 return {calls,tree};
}
for(const app of ['customer-app','driver-app']) {
 test(`${app}: real deletion handler submits credentials then logs out`,async()=>{
  const {calls,tree}=screen(app,false);
  const payload={password:'password',reason:'optional'};
  assert.equal(tree.type,'delete-page');await tree.props.onDelete(payload);
  assert.equal(calls.deleted.length,1);assert.equal(calls.deleted[0],payload);assert.equal(calls.logout,1);
 });
 test(`${app}: backend rejection keeps the account signed in`,async()=>{
  const {calls,tree}=screen(app,true);await tree.props.onDelete({password:'password'});
  assert.equal(calls.logout,0);assert.equal(calls.toast[0][0],'active load');
 });
}
test('analytics sends no requests even when an API key exists',()=>{
 const source=fs.readFileSync(path.join(__dirname,'posthog.js'),'utf8');
 const {code}=babel.transformSync(source,{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-modules-commonjs',{paths:modulePaths})]});
 let requests=0;const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,process:{env:{EXPO_PUBLIC_POSTHOG_API_KEY:'test'}},fetch:()=>{requests++;return Promise.resolve({ok:false});}});
 const p=mod.exports.posthog;p.init({apiKey:'test'});p.identify('user');p.capture('event');p.reloadFeatureFlags();
 assert.equal(requests,0);
});
