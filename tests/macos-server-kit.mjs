// Explicit integration test of the packaged runtime in an isolated launchd GUI domain.
// Never loads the production/local commercial environment or touches its database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
const kit=path.resolve(process.env.MOSAIC_TEST_KIT||'output/macos-server-build/payload/Library/MosaicServer/versions/0.2.0-macos.1');
const base=fs.mkdtempSync(path.resolve('output/macos-server-build/test-'));
fs.chmodSync(base,0o700);
const node=path.join(kit,'runtime/node/bin/node'),admin=path.join(kit,'app/scripts/macos/admin.mjs');
const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME,MOSAIC_INSTALL_TEST:'1',MOSAIC_SERVICE_BASE:base};
const checks=[];
function ok(name){checks.push(name);console.log('PASS '+name);}
function ctl(...args){return execFileSync(node,[admin,...args],{env,encoding:'utf8',timeout:150000});}
let url;
async function req(route,identity,body,method=body?'POST':'GET',headers={}){
  return fetch(url+route,{method,headers:{Connection:'close',...(identity?{Cookie:identity.cookie,'X-CSRF-Token':identity.csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
}
async function json(route,identity,body,method){
  const r=await req(route,identity,body,method),j=await r.json();assert.ok(r.ok,route+' '+r.status+' '+JSON.stringify(j));return j;
}
async function login(username,password){
  const r=await req('/api/login',null,{username,password});assert.equal(r.status,200);
  return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};
}
async function upload(route,identity,file,mime){
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(file)],{type:mime}),path.basename(file));
  const r=await fetch(url+route,{method:'POST',headers:{Cookie:identity.cookie,'X-CSRF-Token':identity.csrf},body:form});
  const j=await r.json();assert.equal(r.status,201,JSON.stringify(j));return j;
}
try{
  ctl('configure');
  const settings=JSON.parse(fs.readFileSync(path.join(base,'config/server.json')));
  url='http://127.0.0.1:'+settings.COMMERCIAL_PORT;
  assert.notEqual(settings.COMMERCIAL_PORT,'3210');
  for(const label of ['local.mosaic.test.server','local.mosaic.test.postgres'])
    execFileSync('/usr/bin/plutil',['-lint',path.join(base,label+'.plist')]);
  ctl('install');ok('relocated runtime initializes and runs under launchd with a clean PATH');
  const health=await json('/api/health');assert.equal(health.service,'mosaic-commercial');ok('database-backed health');
  const html=await fetch(url);assert.equal(html.status,200);assert.match(await html.text(),/console/);ok('admin HTML and assets served');
  assert.equal((await req('/api/devices')).status,401);ok('unauthenticated business access denied');
  const initial=fs.readFileSync(path.join(base,'admin-login.txt'),'utf8').match(/初始密码：(\w+)/)[1];
  const platform=await login('platform-admin',initial);assert.equal(platform.user.mustChangePassword,true);ok('random bootstrap credentials require password change');
  const password='Kit-test-'+randomBytes(12).toString('hex');
  await json('/api/password',platform,{currentPassword:initial,newPassword:password});
  await json('/api/platform/tenants',platform,{name:'Installer Test',expiresAt:'2035-01-01T00:00:00Z',limits:{stores:2,devices:4,users:5,storageBytes:100000000},adminUsername:'kit-tenant',adminPassword:password});
  const tenant=await login('kit-tenant',password);
  await json('/api/password',tenant,{currentPassword:password,newPassword:password+'new'});
  const store=await json('/api/stores',tenant,{name:'Test Store',timezone:'Asia/Shanghai'});
  const group=await json('/api/groups',tenant,{storeId:store.id,name:'TV wall'});ok('platform opens tenant and tenant manages store/screen group');
  const db=JSON.parse(fs.readFileSync(path.join(base,'config/database.json')));
  const runtimeClient=new pg.Client({connectionString:settings.COMMERCIAL_DATABASE_URL});await runtimeClient.connect();
  const rights=(await runtimeClient.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(rights,{rolsuper:false,rolbypassrls:false});
  assert.equal((await runtimeClient.query('SELECT * FROM stores')).rowCount,0);
  await runtimeClient.end();ok('database runtime is restricted and RLS is active');
  const fixtures=path.join(base,'fixtures');fs.mkdirSync(fixtures);
  const ffmpeg='/opt/homebrew/bin/ffmpeg'; // Test fixture generation only; not needed by the kit.
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=red:s=64x64:d=1:r=30','-c:v','libx264',path.join(fixtures,'test.mp4')]);
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1',path.join(fixtures,'test.png')]);
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','pcm_s16le',path.join(fixtures,'test.wav')]);
  for(const [file,mime,type] of [['test.mp4','video/mp4','video'],['test.png','image/png','image'],['test.wav','audio/wav','audio']]){
    const m=await upload('/api/media',tenant,path.join(fixtures,file),mime);assert.equal(m.type,type);
    const range=await req('/media/'+m.id,tenant,null,'GET',{Range:'bytes=0-9'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,10);
  }
  ok('packaged ffprobe validates video, image, music; authenticated Range playback works');
  const apk=await upload('/api/releases',platform,path.join(kit,'downloads/mosaic-player.apk'),'application/vnd.android.package-archive');
  assert.equal(apk.versionCode,3);assert.equal(apk.versionName,'0.2.0');
  assert.equal(apk.signerSha256,fs.readFileSync(path.join(kit,'trusted-apk-signer.txt'),'utf8').trim());
  ok('bundled aapt and Java verify Android update identity and signing certificate');
  for(const file of ['mosaic-player.apk','mosaic-player-macos.zip']){
    const r=await fetch(url+'/downloads/'+file);assert.equal(r.status,200);
    assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),createHash('sha256').update(fs.readFileSync(path.join(kit,'downloads',file))).digest('hex'));
  }
  ok('both client installers download intact');
  const pair=await json('/api/pairing',tenant,{storeId:store.id,groupId:group.id});
  const device=await json('/api/pair',null,{code:pair.code,screenId:group.layout.screens[0].id,name:'Kit TV',client:'test'});
  assert.equal((await req('/api/state',null,null,'GET',{Authorization:'Bearer '+device.key})).status,200);ok('TV pairing and device state');
  const adminHash=createHash('sha256').update(fs.readFileSync(path.join(base,'admin-login.txt'))).digest('hex');
  ctl('stop');ctl('configure');ctl('install');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(base,'admin-login.txt'))).digest('hex'),adminHash);
  assert.equal((await json('/api/stores',tenant)).length,1);ok('idempotent reinstallation preserves passwords, tenants, stores, and media');
  const launch=execFileSync('/bin/launchctl',['print',`gui/${process.getuid()}/local.mosaic.test.server`],{encoding:'utf8'});
  const oldPID=Number(launch.match(/\bpid = (\d+)/)[1]);process.kill(oldPID,'SIGKILL');
  for(let n=0;n<45;n++){
    await new Promise(r=>setTimeout(r,1000));
    const now=execFileSync('/bin/launchctl',['print',`gui/${process.getuid()}/local.mosaic.test.server`],{encoding:'utf8'}).match(/\bpid = (\d+)/)?.[1];
    if(now&&Number(now)!==oldPID){try{ctl('status');break;}catch{}}
    if(n===44)throw new Error('launchd did not restart the service');
  }
  ok('launchd restarts a crashed service');
  ctl('backup');
  const backup=path.join(base,'backups',fs.readdirSync(path.join(base,'backups')).sort().at(-1));
  assert.ok(fs.existsSync(path.join(backup,'manifest.json')));
  await json('/api/stores/'+store.id,tenant,{name:'changed-after-backup'},'PUT');
  ctl('restore',backup,'--confirm-restore');
  assert.equal((await json('/api/stores',tenant))[0].name,'Test Store');ok('consistent offline snapshot restores database and application state');
  const tamper=path.join(backup,'data/tamper-test');fs.writeFileSync(tamper,'bad');
  assert.throws(()=>ctl('restore',backup,'--confirm-restore'));fs.unlinkSync(tamper);
  ctl('status');ok('restore rejects files outside backup manifest without stopping service');
  const lock=path.join(base,'maintenance.lock');fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock,'pid'),String(process.pid));
  try{assert.throws(()=>ctl('stop'));ctl('status');}
  finally{fs.rmSync(lock,{recursive:true});}
  ok('maintenance lock prevents concurrent destructive operations');
  fs.writeFileSync('output/releases/macos-server/verification.json',JSON.stringify({ok:true,checks,base,architecture:process.arch,systemServiceInstallTested:false,physicalTVTested:false},null,2));
}finally{
  try{ctl('stop');}catch{
    for(const label of ['local.mosaic.test.server','local.mosaic.test.postgres'])spawnSync('/bin/launchctl',['bootout',`gui/${process.getuid()}/${label}`],{stdio:'ignore'});
  }
}
