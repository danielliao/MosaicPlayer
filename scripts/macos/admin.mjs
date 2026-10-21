import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import pg from 'pg';

const base=process.env.MOSAIC_SERVICE_BASE||'/Library/Application Support/MosaicServer';
const root=path.resolve(import.meta.dirname,'../../..');
const runtime=path.join(root,'runtime'),config=path.join(base,'config');
const testing=process.env.MOSAIC_INSTALL_TEST==='1'&&process.getuid()!==0;
const label={app:testing?'local.mosaic.test.server':'local.mosaic.server',postgres:testing?'local.mosaic.test.postgres':'local.mosaic.postgres'};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const save=(f,v,mode=0o600)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n',{mode});
const random=()=>randomBytes(24).toString('hex');
const run=(cmd,args,opts={})=>execFileSync(cmd,args,{stdio:'pipe',...opts});
const dbConfig=()=>read(path.join(config,'database.json'));
const appConfig=()=>read(path.join(config,'server.json'));
const dbUrl=(db,user,password,name='mosaic')=>`postgres://${user}:${password}@127.0.0.1:${db.port}/${name}`;
function mkdir(p,mode=0o700){fs.mkdirSync(p,{recursive:true,mode});}
function own(p,user,mode){
  if(!testing)run('/usr/sbin/chown',[user+':'+user,p]);
  if(mode)fs.chmodSync(p,mode);
}
async function freePort(start){
  for(let port=start;port<start+20;port++){
    const free=await new Promise(resolve=>{
      const s=net.createServer();s.once('error',()=>resolve(false));
      s.listen(port,'0.0.0.0',()=>s.close(()=>resolve(true)));
    });
    if(free)return port;
  }
  throw new Error('没有可用端口，请释放 '+start+' 附近端口后重试');
}
function daemon(mode){
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
  const args=[path.join(runtime,'node/bin/node'),path.join(root,'app/scripts/macos/service.mjs'),mode];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label[mode]}</string>
<key>ProgramArguments</key><array>${args.map(a=>`<string>${escape(a)}</string>`).join('')}</array>
${testing?`<key>EnvironmentVariables</key><dict><key>MOSAIC_SERVICE_BASE</key><string>${escape(base)}</string></dict>`:`<key>UserName</key><string>${mode==='app'?'_mosaic':'_mosaicdb'}</string><key>GroupName</key><string>${mode==='app'?'_mosaic':'_mosaicdb'}</string>`}
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>110</integer>
<key>Umask</key><integer>63</integer><key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
}
function trustedApkSigner(){
  const digest=fs.readFileSync(path.join(root,'trusted-apk-signer.txt'),'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(digest))throw new Error('Invalid bundled APK certificate fingerprint');
  return digest;
}
async function configure(){
  mkdir(base,0o755);mkdir(config,0o755);
  for(const [dir,user] of [['data','_mosaic'],['data/tmp','_mosaic'],['postgres','_mosaicdb'],['run','_mosaicdb'],['logs/app','_mosaic'],['logs/postgres','_mosaicdb']]){
    mkdir(path.join(base,dir));own(path.join(base,dir),user,0o700);
  }
  fs.chmodSync(path.join(base,'logs'),0o755);
  if(!fs.existsSync(path.join(config,'database.json'))){
    const db={port:await freePort(testing?16432:15432),adminPassword:random(),ownerPassword:random(),runtimePassword:random()};
    save(path.join(config,'database.json'),db);
  }
  const db=dbConfig();
  if(!fs.existsSync(path.join(config,'server.json'))){
    save(path.join(config,'server.json'),{
      COMMERCIAL_DATABASE_URL:dbUrl(db,'mosaic_runtime',db.runtimePassword),
      COMMERCIAL_PORT:String(await freePort(testing?13320:3210)),
      COMMERCIAL_HOST:'0.0.0.0',COMMERCIAL_COOKIE_SECURE:'false',
      COMMERCIAL_DISCOVERY_ADVERTISE:testing?'0':'1',
      COMMERCIAL_APK_SIGNER_SHA256:trustedApkSigner()
    },0o640);
  }
  if(!testing)run('/usr/sbin/chown',['root:_mosaic',path.join(config,'server.json')]);
  fs.chmodSync(path.join(config,'server.json'),0o640);
  save(path.join(base,'connection.json'),{port:Number(appConfig().COMMERCIAL_PORT)},0o644);
  const pgDir=path.join(base,'postgres'),pw=path.join(base,'run/init-password');
  if(!fs.existsSync(path.join(pgDir,'PG_VERSION'))){
    fs.writeFileSync(pw,db.adminPassword,{mode:0o600});own(pw,'_mosaicdb',0o600);
    const args=['-D',pgDir,'-U','mosaic_db_admin','--encoding=UTF8','--locale=C','--auth-local=scram-sha-256','--auth-host=scram-sha-256','--pwfile='+pw];
    try{
      if(testing)run(path.join(runtime,'postgres/bin/initdb'),args);
      else run('/usr/bin/sudo',['-u','_mosaicdb',path.join(runtime,'postgres/bin/initdb'),...args]);
    }finally{fs.rmSync(pw,{force:true});}
  }
  if(fs.readFileSync(path.join(pgDir,'PG_VERSION'),'utf8').trim()!=='16')throw new Error('需要 PostgreSQL 16；拒绝自动升级数据目录');
  fs.writeFileSync(path.join(pgDir,'mosaic.conf'),`listen_addresses = '127.0.0.1'\nport = ${db.port}\nunix_socket_directories = ''\npassword_encryption = 'scram-sha-256'\nmax_connections = 50\nshared_buffers = '128MB'\nlogging_collector = off\n`,{mode:0o600});
  own(path.join(pgDir,'mosaic.conf'),'_mosaicdb',0o600);
  const pgMain=path.join(pgDir,'postgresql.conf');
  if(!fs.readFileSync(pgMain,'utf8').includes("include = 'mosaic.conf'"))fs.appendFileSync(pgMain,"\ninclude = 'mosaic.conf'\n");
  for(const mode of ['postgres','app']){
    const file=testing?path.join(base,label[mode]+'.plist'):'/Library/LaunchDaemons/'+label[mode]+'.plist';
    fs.writeFileSync(file,daemon(mode),{mode:0o644});
    if(!testing)run('/usr/sbin/chown',['root:wheel',file]);
  }
  console.log('配置和数据库目录已就绪；未输出密码。');
}
async function migrate(){
  const db=dbConfig(),admin=new pg.Client({connectionString:dbUrl(db,'mosaic_db_admin',db.adminPassword,'postgres')});
  let connected=false;
  for(let i=0;i<60;i++){
    try{await admin.connect();connected=true;break;}catch{
      // pg.Client cannot be reconnected after a failed attempt.
      break;
    }
  }
  if(!connected){await admin.end().catch(()=>{});throw new Error('数据库尚未就绪');}
  try{
    for(const [role,password] of [['mosaic_owner',db.ownerPassword],['mosaic_runtime',db.runtimePassword]]){
      if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)
        await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
    }
    if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='mosaic'")).rowCount)await admin.query('CREATE DATABASE mosaic OWNER mosaic_owner');
  }finally{await admin.end();}
  const env={PATH:'/usr/bin:/bin',COMMERCIAL_OWNER_URL:dbUrl(db,'mosaic_owner',db.ownerPassword),COMMERCIAL_DATABASE_URL:appConfig().COMMERCIAL_DATABASE_URL};
  run(path.join(runtime,'node/bin/node'),[path.join(root,'app/scripts/commercial-migrate.mjs')],{env});
  const client=new pg.Client({connectionString:env.COMMERCIAL_OWNER_URL});await client.connect();
  try{
    if(!(await client.query("SELECT 1 FROM users WHERE role='platform_admin' LIMIT 1")).rowCount){
      const password=random();
      // Save before bootstrap so a power failure cannot lose the only initial password.
      const login=path.join(base,'admin-login.txt');
      if(!fs.existsSync(login))fs.writeFileSync(login,`平台管理员：platform-admin\n初始密码：${password}\n首次登录必须修改密码。\n`,{mode:0o640});
      const saved=fs.readFileSync(login,'utf8').match(/初始密码：([a-f0-9]+)/)?.[1];
      if(!saved)throw new Error('初始账号文件格式无效');
      run(path.join(runtime,'node/bin/node'),[path.join(root,'app/scripts/commercial-bootstrap.mjs')],{env:{...env,COMMERCIAL_ADMIN_USERNAME:'platform-admin',COMMERCIAL_ADMIN_PASSWORD:saved}});
      if(!testing)run('/usr/sbin/chown',['root:admin',login]);
    }
  }finally{await client.end();}
  fs.writeFileSync(path.join(base,'installed-version'),fs.readFileSync(path.join(root,'VERSION')));
  console.log('数据库迁移及管理员检查完成。');
}
function launch(mode,action){
  const domain=testing?'gui/'+process.getuid():'system';
  const file=testing?path.join(base,label[mode]+'.plist'):'/Library/LaunchDaemons/'+label[mode]+'.plist';
  if(action==='stop'){
    const result=spawnSync('/bin/launchctl',['bootout',domain+'/'+label[mode]],{encoding:'utf8'});
    // A missing job is harmless; other failures are verified by checking the job.
    if(result.status!==0&&spawnSync('/bin/launchctl',['print',domain+'/'+label[mode]],{stdio:'ignore'}).status===0)
      throw new Error('无法停止服务 '+label[mode]);
  }else if(spawnSync('/bin/launchctl',['print',domain+'/'+label[mode]],{stdio:'ignore'}).status!==0){
    run('/bin/launchctl',['bootstrap',domain,file]);
  }
}
async function waitForDb(){
  const db=dbConfig();
  for(let i=0;i<60;i++){
    const c=new pg.Client({connectionString:dbUrl(db,'mosaic_db_admin',db.adminPassword,'postgres'),connectionTimeoutMillis:1000});
    try{await c.connect();await c.query('SELECT 1');await c.end();return;}
    catch{await c.end().catch(()=>{});await new Promise(r=>setTimeout(r,1000));}
  }
  throw new Error('数据库 60 秒内未就绪，请查看 logs/postgres/service.log');
}
async function waitForWeb(){
  const port=appConfig().COMMERCIAL_PORT;
  for(let i=0;i<45;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).service==='mosaic-commercial')return;}
    catch{}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('后台未就绪，请查看 logs/app/service.log');
}
function fileHash(f){
  const hash=createHash('sha256'),fd=fs.openSync(f,'r'),buffer=Buffer.alloc(1024*1024);
  try{let bytes;while((bytes=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));}
  finally{fs.closeSync(fd);}return hash.digest('hex');
}
function hashes(dir){
  const result={};
  function walk(p){for(const name of fs.readdirSync(p)){const f=path.join(p,name),st=fs.lstatSync(f);if(st.isSymbolicLink())throw new Error('备份不接受符号链接');if(st.isDirectory())walk(f);else if(st.isFile())result[path.relative(dir,f)]=fileHash(f);}}
  walk(dir);return result;
}
async function stopped(fn,restart=true){
  launch('app','stop');launch('postgres','stop');
  // launchctl bootout may return before the PostgreSQL process finishes shutdown.
  for(let i=0;fs.existsSync(path.join(base,'postgres/postmaster.pid'));i++){
    if(i>=120)throw new Error('数据库仍在停止，未开始复制');
    await new Promise(r=>setTimeout(r,500));
  }
  try{return await fn();}finally{if(restart){launch('postgres','start');await waitForDb();launch('app','start');await waitForWeb();}}
}
async function backup({leaveStopped=false}={}){
  const dir=path.join(base,'backups',new Date().toISOString().replaceAll(':','-'));
  await stopped(async()=>{
    mkdir(dir);
    for(const name of ['postgres','data','config','admin-login.txt','installed-version'])if(fs.existsSync(path.join(base,name)))fs.cpSync(path.join(base,name),path.join(dir,name),{recursive:true,preserveTimestamps:true});
    save(path.join(dir,'manifest.json'),{version:1,postgresMajor:16,arch:process.arch,createdAt:new Date().toISOString(),files:hashes(dir)});
  },!leaveStopped);
  console.log('备份完成：'+dir);return dir;
}
async function restore(dir){
  dir=fs.realpathSync(dir);
  const manifest=read(path.join(dir,'manifest.json'));
  if(manifest.version!==1||manifest.postgresMajor!==16||manifest.arch!==process.arch)throw new Error('备份格式、数据库版本或 CPU 架构不匹配');
  for(const required of ['postgres/PG_VERSION','config/database.json','config/server.json','data/server-id','installed-version'])
    if(!Object.hasOwn(manifest.files||{},required))throw new Error('备份不完整：'+required);
  if(fs.readFileSync(path.join(dir,'installed-version'),'utf8').trim()!==fs.readFileSync(path.join(root,'VERSION'),'utf8').trim())
    throw new Error('请先安装与此备份相同版本的服务端，再执行恢复');
  for(const [name,sha] of Object.entries(manifest.files)){
    if(path.isAbsolute(name)||name.split(path.sep).includes('..'))throw new Error('备份路径无效');
    const f=path.join(dir,name);
    if(fs.lstatSync(f).isSymbolicLink()||fileHash(f)!==sha)throw new Error('备份校验失败：'+name);
  }
  const actual=hashes(dir);delete actual['manifest.json'];
  if(JSON.stringify(Object.keys(actual).sort())!==JSON.stringify(Object.keys(manifest.files).sort()))throw new Error('备份文件清单不匹配');
  // Keep the previous state until the restored service has been validated.
  const previous=path.join(base,'restore-previous-'+Date.now());mkdir(previous);
  await stopped(async()=>{
    const staging=path.join(base,'restore-staging-'+Date.now());mkdir(staging);
    const names=['postgres','data','config','admin-login.txt','installed-version'];
    const moved=[],replaced=[];
    try{
      // Complete every copy before changing the active data, including disk-full failures.
      for(const name of names)if(fs.existsSync(path.join(dir,name)))fs.cpSync(path.join(dir,name),path.join(staging,name),{recursive:true,preserveTimestamps:true});
      for(const name of names){
        const dest=path.join(base,name);
        if(fs.existsSync(dest)){fs.renameSync(dest,path.join(previous,name));moved.push(name);}
        if(fs.existsSync(path.join(staging,name))){fs.renameSync(path.join(staging,name),dest);replaced.push(name);}
      }
    }catch(error){
      for(const name of replaced)fs.rmSync(path.join(base,name),{recursive:true,force:true});
      for(const name of moved)fs.renameSync(path.join(previous,name),path.join(base,name));
      throw error;
    }finally{
      fs.rmSync(staging,{recursive:true,force:true});
    }
    fs.chmodSync(path.join(base,'postgres'),0o700);
    fs.chmodSync(path.join(base,'data'),0o700);
    fs.chmodSync(config,0o755);
    fs.chmodSync(path.join(config,'database.json'),0o600);
    if(!testing){
      run('/usr/sbin/chown',['-R','_mosaicdb:_mosaicdb',path.join(base,'postgres')]);
      run('/usr/sbin/chown',['-R','_mosaic:_mosaic',path.join(base,'data')]);
      run('/usr/sbin/chown',['root:_mosaic',path.join(config,'server.json')]);
    }
    fs.chmodSync(path.join(config,'server.json'),0o640);
    if(!testing&&fs.existsSync(path.join(base,'admin-login.txt')))run('/usr/sbin/chown',['root:admin',path.join(base,'admin-login.txt')]);
    save(path.join(base,'connection.json'),{port:Number(appConfig().COMMERCIAL_PORT)},0o644);
  });
  console.log('恢复完成；恢复前数据保留于：'+previous);
}
async function main(){
  const command=process.argv[2]||'status';
  if(!testing&&process.getuid()!==0&&!['status','urls','plist'].includes(command))throw new Error('请使用 sudo mosaic-server '+command);
  const mutate=!['status','urls','plist'].includes(command);
  let lock;
  if(mutate){
    mkdir(base,0o755);lock=path.join(base,'maintenance.lock');
    try{fs.mkdirSync(lock,{mode:0o700});}
    catch{
      let alive=true;
      try{const pid=Number(fs.readFileSync(path.join(lock,'pid'),'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error();process.kill(pid,0);}
      catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive)throw new Error('另一项安装/备份/恢复任务正在运行，请稍后重试');
      fs.rmSync(lock,{recursive:true});fs.mkdirSync(lock,{mode:0o700});
    }
    fs.writeFileSync(path.join(lock,'pid'),String(process.pid),{mode:0o600});
  }
  try{switch(command){
    case 'configure': await configure();break;
    case 'migrate': await waitForDb();await migrate();break;
    case 'install': launch('postgres','start');await waitForDb();await migrate();launch('app','start');await waitForWeb();break;
    case 'start': launch('postgres','start');await waitForDb();launch('app','start');await waitForWeb();break;
    case 'stop': await stopped(async()=>{},false);break;
    case 'restart': await stopped(async()=>{});break;
    case 'backup': await backup();break;
    case 'upgrade-backup': {const dir=await backup({leaveStopped:true});fs.writeFileSync(path.join(base,'upgrade-backup'),dir,{mode:0o600});break;}
    case 'restore': if(process.argv[4]!=='--confirm-restore')throw new Error('用法：restore /绝对路径/备份 --confirm-restore');await restore(process.argv[3]);break;
    case 'status': {const port=read(path.join(base,'connection.json')).port;const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(5000)});if(!r.ok||(await r.json()).service!=='mosaic-commercial')throw new Error('服务未就绪');console.log(`服务运行正常：http://localhost:${port}`);break;}
    case 'urls': {const port=read(path.join(base,'connection.json')).port;console.log(`本机：http://localhost:${port}`);for(const n of Object.values(os.networkInterfaces()).flat())if(n.family==='IPv4'&&!n.internal)console.log(`内网：http://${n.address}:${port}`);break;}
    case 'plist': console.log(daemon(process.argv[3]));break;
    default: throw new Error('支持 status / urls / start / stop / restart / backup / restore');
  }}finally{if(lock)fs.rmSync(lock,{recursive:true,force:true});}
}
main().catch(e=>{console.error('Mosaic Server：'+(e.code||e.message));process.exitCode=1;});
