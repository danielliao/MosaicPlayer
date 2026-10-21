import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SegmentTracker,ProofQueue,proofNamespace} from '../public/proof.js';
import {programCursor} from '../public/program.js';
import {FrozenTransition} from '../public/transitions.js';
import {BrowserProgram} from '../public/browser-program.js';

class FakeAudio {
  constructor(){this.paused=true;this.readyState=2;this.currentTime=0;this.src='';}
  pause(){this.paused=true;}
  play(){this.paused=false;return Promise.resolve();}
}
globalThis.Audio=FakeAudio;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const content=(id='visual')=>({playlist:[{mediaId:id,durationMs:1000}],music:[],audioMode:'video',volume:1});
const manifest=(id='deployment',mediaId='visual')=>({id,versionId:'v1',activateAt:1000,validUntil:100000,defaultProgram:content(mediaId),intervals:[]});
const wall=(program=manifest(),audioScreenId='s1')=>({program,audioScreenId,layout:{tileWidth:100,tileHeight:100,screens:[{id:'s1',name:'Screen',row:0,col:0}]},media:[],playback:{mediaId:null,epoch:0,position:0,paused:true,revision:1},pending:null,pendingProgram:null});
function program(){const errors=[],sent=[];const p=new BrowserProgram({key:'fixture-key',screenId:'s1',send:x=>sent.push(x),error:x=>errors.push(x)});return {p,errors,sent};}
function memoryDB(entries){
  const values=new Map(entries);
  return {values,transaction(){
    const transaction={objectStore(){return {openCursor(){
      const request={},keys=[...values.keys()];let index=0;
      function next(){queueMicrotask(()=>{const key=keys[index++];request.result=key===undefined?null:{key,delete(){values.delete(key)},continue:next};request.onsuccess?.();if(key===undefined)queueMicrotask(()=>transaction.oncomplete?.());});}
      next();return request;
    }}}};return transaction;
  }};
}

test('same-ID audio routing refresh updates output and persists the latest state',async()=>{
  const {p}=program(),writes=[];p.put=async(id,value)=>writes.push([id,value]);p.prune=async()=>{};p.ready.add('deployment');
  p.receive(wall());p.effective(2000);assert.equal(p.videoVolume(2000),1);
  p.receive(wall(manifest(),'s2'));p.effective(2100);await flush();
  assert.equal(p.videoVolume(2100),0);
  p.effective(8000);await flush(); // Allow the intentional five-second persistence throttle.
  assert.equal(writes.at(-1)[1].audioScreenId,'s2');
  assert.equal(writes.at(-1)[1].pendingProgram,null);
});

test('future committed program retains the previous program until activation time',()=>{
  const {p}=program();p.put=async()=>{};p.prune=async()=>{};p.ready.add('deployment');p.receive(wall());p.effective(2000);
  const next={...manifest('next','next-media'),activateAt:5000};p.ready.add('next');p.receive(wall(next));
  assert.equal(p.effective(4999).program.id,'deployment');assert.equal(p.effective(5000).program.id,'next');
});

test('actual decode error prevents program readiness and releases the temporary URL',async t=>{
  const {p,sent}=program(),created=[],revoked=[];
  const original=globalThis.document;globalThis.document={createElement(tag){const el={tag,removeAttribute(){},pause(){},load(){}};Object.defineProperty(el,'src',{set(){queueMicrotask(()=>el.onerror?.());}});return el;}};
  t.after(()=>{globalThis.document=original;});
  t.mock.method(URL,'createObjectURL',()=>{created.push('blob:decode');return 'blob:decode';});
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  const blob=new Blob(['fixture']);p.get=async()=>blob;
  await assert.rejects(p.prepare(manifest(),[{id:'visual',type:'video',size:blob.size}]),/无法解码/);
  assert.equal(p.ready.has('deployment'),false);assert.equal(p.assets.size,0);assert.deepEqual(created,revoked);assert.deepEqual(sent,[]);
});

test('pending receipt waits for asynchronous decode completion',async()=>{
  const {p,sent}=program(),decode=defer(),blob=new Blob(['fixture']);p.get=async()=>blob;p.validateDecode=()=>decode.promise;
  const source=wall();source.program=null;source.media=[{id:'visual',type:'image',size:blob.size}];source.pendingProgram={id:'request',program:manifest()};
  p.receive(source);await flush();p.effective(2000);assert.deepEqual(sent,[]);
  decode.resolve();await flush();p.effective(2100);assert.equal(sent[0]?.type,'ready');assert.equal(sent[0]?.id,'request');
  await p.revoke();
});

test('pruning preserves active/pending media and snapshot, removes obsolete media and ready IDs',async t=>{
  const {p}=program(),db=memoryDB([['state',{}],['active',1],['pending',2],['obsolete',3]]),released=[];
  p.database=async()=>db;p.active=wall(manifest('current','active'));p.incoming={...p.active,pendingProgram:{id:'request',program:manifest('next','pending')}};
  p.assets=new Map([['active','blob:active'],['pending','blob:pending'],['obsolete','blob:obsolete']]);p.ready=new Set(['current','next','old']);
  t.mock.method(URL,'revokeObjectURL',url=>released.push(url));await p.prune();
  assert.deepEqual([...db.values.keys()],['state','active','pending']);assert.deepEqual([...p.assets.keys()],['active','pending']);assert.deepEqual([...p.ready],['current','next']);assert.deepEqual(released,['blob:obsolete']);
});

test('snapshot write failure is reported and never prunes previous recoverable resources',async()=>{
  const {p,errors}=program();let prunes=0;p.put=async()=>{throw Error('disk full')};p.prune=async()=>{prunes++};p.ready.add('deployment');
  p.receive(wall());p.effective(2000);await flush();assert.equal(prunes,0);assert.match(errors[0],/disk full/);
});

const playerSource=readFileSync(new URL('../public/player.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
function playerHarness({response={ok:false,status:503},restore=null}={}){
  const nodes=new Map(),created=[],intervals=[],timers=new Map(),fetches=[],sockets=[],restoreGate=defer();let timerId=0;
  const element=tag=>({tagName:tag.toUpperCase(),style:{},hidden:false,textContent:'',removed:false,paused:true,readyState:2,currentTime:0,classList:{remove(){},add(){}},replaceChildren(...children){this.children=children},remove(){this.removed=true},removeAttribute(){},load(){},pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()}});
  class StubProgram{constructor(){this.supported=true;this.assets=new Map();this.presentedID=null;}restore(){return restoreGate.promise}effective(){return null}receive(){}revoke(){this.assets.clear();this.presentedID=null;}videoVolume(){return 0}}
  class Socket{static OPEN=1;static CLOSED=3;constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(value){this.sent.push(JSON.parse(value))}}
  const context=vm.createContext({FrozenTransition,requestAnimationFrame:()=>{},SegmentTracker,ProofQueue,proofNamespace,programCursor,BrowserProgram:StubProgram,WebSocket:Socket,URLSearchParams,location:{search:'?key=fixture-key&screen=s1',protocol:'https:',host:'fixture.invalid'},performance:{timeOrigin:1000,now:()=>1000},document:{querySelector:s=>{if(!nodes.has(s))nodes.set(s,element('div'));return nodes.get(s)},createElement:tag=>{const el=element(tag);created.push(el);return el;},addEventListener(){},body:element('body')},navigator:{},window:{addEventListener(){}},setInterval(fn){intervals.push(fn)},setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout(id){timers.delete(id)},innerWidth:100,innerHeight:100,fetch:async(...args)=>{fetches.push(args);if(response instanceof Error)throw response;return response},geometry:()=>({offsetX:0,offsetY:0,scale:1,wallWidth:100,wallHeight:100,x:0,y:0}),console});
  vm.runInContext(playerSource,context);
  if(restore!==null)restoreGate.resolve(restore);
  return {context,nodes,created,intervals,fetches,sockets,restoreGate,run:code=>vm.runInContext(code,context)};
}
function seedPlayer(h){h.context.fixture=wall();h.context.fixture.playback={mediaId:'visual',paused:true,epoch:0,position:0};h.context.fixture.media=[{id:'visual',type:'image'}];h.run('state=fixture;screen=state.layout.screens[0];clockReady=true;');}

test('authenticated revocation destroys prepared visual and the next tick cannot remount it',async()=>{
  const h=playerHarness();await flush();seedPlayer(h);
  h.run('prepared={id:"visual",el:document.createElement("img"),media:{type:"image"}};');const preparedElement=h.created.at(-1);
  h.sockets[0].onclose({code:4001});h.run('tick()');
  assert.equal(preparedElement.removed,true);assert.equal(h.run('current'),null);assert.equal(h.run('prepared'),null);assert.equal(h.run('state'),null);assert.equal(h.run('revoked'),true);
});

test('revocation invalidates an in-flight renderer load before its completion can mount',async()=>{
  const h=playerHarness();await flush();seedPlayer(h);h.run('ensureCurrent()');const pendingElement=h.created.at(-1);assert.ok(pendingElement.onload);
  h.sockets[0].onclose({code:4001});pendingElement.onload();await flush();h.run('tick()');
  assert.equal(h.run('current'),null);assert.equal(pendingElement.removed,true);assert.equal(h.run('state'),null);
});

test('HTTP 401 quarantines before socket creation and rejects a late cached restore',async()=>{
  const h=playerHarness({response:{ok:false,status:401}});await flush();assert.equal(h.sockets.length,0);assert.equal(h.run('revoked'),true);
  h.restoreGate.resolve(wall());await flush();h.run('tick()');assert.equal(h.run('state'),null);assert.equal(h.run('current'),null);
  assert.equal(h.fetches[0][0],'/api/state');assert.equal(h.fetches[0][1].headers.Authorization,'Bearer fixture-key');
});

test('unreachable service still permits an existing cached program to restore',async()=>{
  const h=playerHarness({response:Error('offline')});await flush();h.restoreGate.resolve(wall());await flush();
  assert.equal(h.run('revoked'),false);assert.equal(h.run('state.program.id'),'deployment');assert.equal(h.run('clockReady'),true);
});

test('late offline restoration cannot overwrite a newer authoritative state',async()=>{
  const {p}=program(),snapshot=defer();p.get=()=>snapshot.promise;p.ready.add('cached');p.ready.add('live');
  const restoring=p.restore();p.receive(wall(manifest('live','live-media')));
  snapshot.resolve(wall(manifest('cached','cached-media')));await restoring;
  assert.equal(p.incoming.program.id,'live');
});

test('revocation during asynchronous decode cannot repopulate old-identity object URLs',async t=>{
  const {p}=program(),decode=defer(),blob=new Blob(['fixture']),released=[];p.get=async()=>blob;p.validateDecode=()=>decode.promise;
  t.mock.method(URL,'createObjectURL',()=> 'blob:inflight');t.mock.method(URL,'revokeObjectURL',url=>released.push(url));
  const preparing=p.prepare(manifest(),[{id:'visual',type:'image',size:blob.size}]);await flush();await p.revoke();decode.resolve();await preparing;
  assert.equal(p.assets.size,0);assert.equal(p.ready.size,0);assert.deepEqual(released,['blob:inflight']);
});

test('pruning rechecks references when a newer pending program arrives while storage is awaited',async()=>{
  const {p}=program(),gate=defer(),db=memoryDB([['state',{}],['active',1],['pending',2],['obsolete',3]]);
  p.active=wall(manifest('current','active'));p.incoming=p.active;p.database=()=>gate.promise;
  const pruning=p.prune();
  p.ready.add('next');p.receive({...p.active,pendingProgram:{id:'request',program:manifest('next','pending')}});
  p.assets.set('pending','blob:pending');gate.resolve(db);await pruning;
  assert.equal(db.values.has('pending'),true);assert.equal(p.assets.has('pending'),true);assert.equal(db.values.has('obsolete'),false);
});

test('manual playback and stop clear the previously presented program identity',()=>{
  const {p}=program();p.active=wall();p.presentedID='deployment';p.audio.paused=false;
  p.receive({...wall(),program:null});
  assert.equal(p.presentedID,null);assert.equal(p.active,null);assert.equal(p.audio.paused,true);
});

test('a transient snapshot failure is retried without requiring a new server broadcast',async()=>{
  const {p}=program();let attempts=0,prunes=0;
  p.put=async()=>{attempts++;if(attempts===1)throw Error('transient storage failure')};p.prune=async()=>{prunes++};p.ready.add('deployment');p.receive(wall());
  p.effective(2000);await flush();
  for(let now=8000;now<=32000&&attempts<2;now+=6000){p.effective(now);await flush();}
  assert.equal(attempts,2);assert.equal(prunes,1);
});

test('direct-play receipt excludes a future replay and a still-seeking video',async()=>{
  const h=playerHarness();await flush();seedPlayer(h);
  h.run('state.playback={mediaId:"visual",paused:false,epoch:3000,position:0,revision:42};current={id:"visual",media:{type:"image"},el:document.createElement("img")};status="playing";');
  const report=h.intervals.at(-1),last=()=>h.sockets[0].sent.at(-1);
  report();assert.equal(last().playbackRevision,null);
  h.run('offset=2000');report();assert.equal(last().playbackRevision,42);
  h.run('current.media.type="video";current.el=document.createElement("video");current.el.paused=false;current.el.seeking=true;');
  report();assert.equal(last().playbackRevision,null);
  h.run('current.el.seeking=false');report();assert.equal(last().playbackRevision,42);
  h.run('current.id="old-media"');report();assert.equal(last().playbackRevision,null);
});
