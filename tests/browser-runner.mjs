// Real Chromium at an emulated phone viewport. Test pages publish #result JSON.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp(path.join(tmpdir(),'mosaic-browser-'));
const chrome=process.env.CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome');
const child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});let socket,exitError;child.on('error',e=>{exitError=e;});
try{
 let port;for(let n=0;n<100;n++){if(exitError)throw exitError;try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await wait(100);}}
 if(!port)throw Error('Chromium did not start');const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let next=1;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await command('Page.navigate',{url:process.argv[2]});
 let result;for(let n=0;n<200;n++){const r=await command('Runtime.evaluate',{expression:'document.querySelector("#result")?.textContent',returnByValue:true});if(r.result.value){result=JSON.parse(r.result.value);break;}await wait(100);}
 if(!result){const r=await command('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});throw Error('No browser result: '+r.result.value);}
 const viewport=await command('Runtime.evaluate',{expression:'({width:innerWidth,scroll:document.documentElement.scrollWidth})',returnByValue:true});
 if(process.env.MOSAIC_BROWSER_SCREENSHOT){const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(process.env.MOSAIC_BROWSER_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 console.log(JSON.stringify({checks:result,viewport:viewport.result.value}));
}finally{socket?.close();child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),wait(3000)]);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
