// launchd invokes this as a dedicated, unprivileged account.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..');
const base=process.env.MOSAIC_SERVICE_BASE||'/Library/Application Support/MosaicServer';
const mode=process.argv[2];
if(!['app','postgres'].includes(mode))throw new Error('Invalid service');
const log=path.join(base,'logs',mode,'service.log');
fs.mkdirSync(path.dirname(log),{recursive:true,mode:0o700});
function append(bytes){
  if(fs.existsSync(log)&&fs.statSync(log).size>5*1024*1024){
    fs.rmSync(log+'.5',{force:true});
    for(let n=4;n>=1;n--)if(fs.existsSync(log+'.'+n))fs.renameSync(log+'.'+n,log+'.'+(n+1));
    fs.renameSync(log,log+'.1');
  }
  fs.appendFileSync(log,bytes,{mode:0o600});
}
const runtime=path.join(root,'runtime');
const cleanEnv={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:base,LANG:'en_US.UTF-8',TMPDIR:path.join(base,mode==='app'?'data/tmp':'run')};
let command,args,env;
if(mode==='postgres'){
  command=path.join(runtime,'postgres/bin/postgres');
  args=['-D',path.join(base,'postgres')];env=cleanEnv;
}else{
  const settings=JSON.parse(fs.readFileSync(path.join(base,'config/server.json'),'utf8'));
  env={...cleanEnv,...settings,JAVA_HOME:path.join(runtime,'java'),
    COMMERCIAL_DATA_DIR:path.join(base,'data'),
    COMMERCIAL_DOWNLOAD_DIR:path.join(root,'downloads'),
    COMMERCIAL_AAPT_PATH:path.join(runtime,'android/aapt'),
    COMMERCIAL_APKSIGNER_PATH:path.join(runtime,'android/apksigner'),
    FFPROBE_PATH:path.join(runtime,'media/ffprobe')};
  command=path.join(runtime,'node/bin/node');args=[path.join(root,'app/commercial/server.js')];
}
const child=spawn(command,args,{cwd:path.join(root,'app'),env,stdio:['ignore','pipe','pipe']});
// Keep an AC-powered signage server awake without changing system power settings.
const awake=mode==='app'?spawn('/usr/bin/caffeinate',['-s','-w',String(child.pid)],{stdio:'ignore'}):null;
awake?.on('error',()=>{});
child.stdout.on('data',append);child.stderr.on('data',append);
child.on('error',()=>{append(Buffer.from('Unable to start service process\n'));process.exit(1);});
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
  if(stopping)return;stopping=true;
  child.kill(mode==='postgres'?'SIGINT':'SIGTERM');
  setTimeout(()=>child.kill('SIGKILL'),90000).unref();
});
child.on('exit',(code,signal)=>{awake?.kill();process.exit(stopping?0:(code||1));});
