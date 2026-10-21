import express from 'express';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {networkInterfaces,hostname} from 'node:os';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {newPool,tx,one,httpError,audit} from './db.js';
import {secret,digest,passwordMatches,passwordHash,identify,checkWrite,requireRole,setSessionCookie,sessionPayload,limiter} from './auth.js';
import {installAdmin} from './admin.js';
import {installMedia} from './media.js';
import {installPrograms} from './programs.js';
import {deviceSystem} from './devices.js';
import {installReleases} from './releases.js';
import {installDesigner} from './designer.js';
import {installRetail} from './retail.js';
import {installIntake} from './intake.js';
import {installAI} from './ai.js';
import {installIntegrations} from './integrations.js';
const root=path.resolve(import.meta.dirname,'..');
export async function createCommercial(options={}){
 const pool=options.pool||newPool(),dataDir=path.resolve(options.dataDir||process.env.COMMERCIAL_DATA_DIR||path.join(root,'output/commercial-development/data'));
 const privileges=await one(pool,"SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relkind='r' AND t.relowner=r.oid) AS owns_tables FROM pg_roles r WHERE r.rolname=current_user");if(privileges.rolsuper||privileges.rolbypassrls||privileges.owns_tables)throw new Error('Commercial runtime must use a non-owner role without SUPERUSER/BYPASSRLS');await mkdir(dataDir,{recursive:true,mode:0o700});let serverId;try{serverId=(await readFile(path.join(dataDir,'server-id'),'utf8')).trim();}catch{serverId=randomUUID();await writeFile(path.join(dataDir,'server-id'),serverId,{mode:0o600});}
 const app=express(),server=createServer(app);app.disable('x-powered-by');if(process.env.COMMERCIAL_TRUST_PROXY==='1')app.set('trust proxy',1);
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});next();});app.use(express.json({limit:'256kb'}));
 const loginLimit=limiter(20,60000),secure=options.cookieSecure??process.env.COMMERCIAL_COOKIE_SECURE!=='false';let device;
 const authorize=async(req,res,next)=>{try{req.identity=await identify(pool,req,{allowQuery:req.path==='/api/state'||req.path.startsWith('/media/')});if(!req.identity)throw httpError(401,'请登录或重新配对');if(!['GET','HEAD','OPTIONS'].includes(req.method))checkWrite(req,req.identity);next();}catch(e){next(e);}};
 app.get('/api/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'mosaic-commercial',protocolVersion:2});}catch{res.status(503).json({error:'数据库不可用'});}});
 app.post('/api/login',async(req,res,next)=>{try{if(req.headers.origin&&req.headers.origin!==`${req.protocol}://${req.headers.host}`)throw httpError(403,'请求来源无效');loginLimit(req.ip);const username=String(req.body.username||'').slice(0,180);loginLimit('user:'+username);const u=await one(pool,'SELECT * FROM auth_user($1)',[username]);if(!u||!await passwordMatches(req.body.password,u.password_hash))throw httpError(401,'用户名或密码错误');const token=secret(),csrf=secret();const i={id:u.id,tenantId:u.tenant_id,platform:u.role==='platform_admin'};await tx(pool,i,async c=>{await c.query("INSERT INTO sessions(id,user_id,csrf,expires_at)VALUES($1,$2,$3,now()+interval '12 hours')",[digest(token),u.id,csrf]);await audit(c,i,'session.login',u.id);});setSessionCookie(res,token,secure);req.headers.cookie='mosaic_session='+token;const identity=await identify(pool,req);res.json(await sessionPayload(pool,identity));}catch(e){next(e);}});
 app.get('/api/session',authorize,async(req,res,next)=>{try{if(req.identity.isDevice)throw httpError(403,'需要后台账号');res.json(await sessionPayload(pool,req.identity));}catch(e){next(e);}});
 function route(method,url,roles,fn){app[method](url,authorize,async(req,res,next)=>{try{if(roles)requireRole(req.identity,roles);req.afterCommit=[];const result=await tx(pool,req.identity,c=>fn(c,req.identity,req));for(const action of req.afterCommit)await action();res.status(result?.status&&'value'in result?result.status:200).json(result?.status&&'value'in result?result.value:result);}catch(e){next(e);}});}
 route('post','/api/logout',null,async(c,i,r)=>{if(i.isDevice)throw httpError(403,'需要后台账号');await c.query('DELETE FROM sessions WHERE id=$1',[i.sessionId]);await audit(c,i,'session.logout',i.id);r.afterCommit.push(()=>device.disconnectUser(i.id));return {ok:true};});
 route('post','/api/password',null,async(c,i,r)=>{if(i.isDevice)throw httpError(403,'需要后台账号');const u=await one(c,'SELECT * FROM users WHERE id=$1 FOR UPDATE',[i.id]);if(!u||!await passwordMatches(r.body.currentPassword,u.password_hash))throw httpError(403,'当前密码错误');const hash=await passwordHash(r.body.newPassword);await c.query('UPDATE users SET password_hash=$2,must_change_password=false WHERE id=$1',[i.id,hash]);await c.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2',[i.id,i.sessionId]);await audit(c,i,'user.password',i.id);r.afterCommit.push(()=>device.disconnectUser(i.id));return {ok:true};});
 route('get','/api/network',['platform_admin','tenant_admin','operator','store_operator','viewer'],()=>({addresses:Object.values(networkInterfaces()).flat().filter(v=>v.family==='IPv4'&&!v.internal).map(v=>v.address)}));
 device=deviceSystem({app,server,pool,dataDir,route,authorize,serverId});
 let programs;installAdmin({route,scheduleAssignment:(...args)=>programs.assign(...args),disconnectUser:device.disconnectUser,disconnectDevice:device.disconnectDevice,broadcast:device.broadcast});
 await installMedia({app,route,pool,dataDir,authorize,broadcast:device.broadcast});
 programs=installPrograms({route,pool,dataDir,broadcast:device.broadcast,prepareTimeoutMs:options.prepareTimeoutMs||Number(process.env.COMMERCIAL_PREPARE_TIMEOUT_MS)||120000});
 await installReleases({app,route,authorize,pool,dataDir,broadcast:device.broadcast});
 const ai=await installAI({route,pool,dataDir,enabled:options.aiEnabled,allowHosts:options.aiAllowedHosts,provider:options.aiProvider});
 installIntegrations({app,route,pool,programs,ai});
 const intake=installIntake({route,pool,dataDir});
 const designer=installDesigner({route,pool,dataDir});
 installRetail({route,programs});
 const downloads=options.downloadDir||process.env.COMMERCIAL_DOWNLOAD_DIR;
 app.get(['/downloads/mosaic-player.apk','/downloads/mosaic-player-macos.zip'],(req,res)=>{if(!downloads)return res.status(404).json({error:'安装包暂不可用'});const filename=req.path.endsWith('.apk')?'mosaic-player.apk':'mosaic-player-macos.zip';res.set('Content-Disposition',`attachment; filename="${filename}"`);res.type(filename.endsWith('.apk')?'application/vnd.android.package-archive':'application/zip');res.sendFile(path.resolve(downloads,filename),{dotfiles:'deny'},error=>{if(error&&!res.headersSent)res.status(404).json({error:'安装包暂不可用'});});});
 app.use('/downloads',(req,res)=>res.status(404).json({error:'资源不存在'}));
 app.get('/play',(req,res)=>res.sendFile(path.join(root,'public/play.html')));
 app.use('/console',express.static(path.join(root,'public/console')));app.get('/',(req,res)=>res.sendFile(path.join(root,'public/console/index.html')));app.use(express.static(path.join(root,'public'),{index:false}));
 app.use((req,res)=>res.status(404).json({error:'资源不存在'}));
 app.use((e,req,res,next)=>{if(res.headersSent)return next(e);let status=e.status||400,message=e.message;if(['23505','23503'].includes(e.code)){status=409;message=e.code==='23505'?'资源已存在、配对已使用或屏幕已占用':'资源仍被引用或目标不属于当前租户';}else if(e.code==='22P02'){status=400;message='资源 ID 格式无效';}else if(e.code==='42501'){status=403;message='权限不足';}else if(e.code==='LIMIT_FILE_SIZE'){status=413;message='文件超过大小限制';}else if(e.code&&String(e.code).length===5){status=500;message='数据库操作失败';console.error('Commercial database error',e.code);}res.status(status).json({error:message||'请求失败'});});
 let running=false;const tick=async()=>{if(running)return;running=true;try{await programs.tick();}finally{running=false;}};const timer=options.startWorker===false?null:setInterval(()=>tick().catch(e=>console.error('Commercial worker failure:',e.code||e.name)),250);timer?.unref();
 const aiTimer=options.startWorker===false?null:setInterval(()=>ai.tick().catch(e=>console.error('AI worker failure:',e.code||e.name)),1000);aiTimer?.unref();
 const designerTimer=options.startWorker===false?null:setInterval(()=>designer.tick().catch(e=>console.error('Design worker failure:',e.code||e.name)),1000);designerTimer?.unref();
 const intakeTimer=options.startWorker===false?null:setInterval(()=>intake.tick().catch(e=>console.error('Intake worker failure:',e.code||e.name)),1000);intakeTimer?.unref();
 return {app,server,pool,dataDir,tick,intakeTick:intake.tick,designerTick:designer.tick,aiTick:ai.tick,...device,close:async()=>{if(timer)clearInterval(timer);if(aiTimer)clearInterval(aiTimer);if(intakeTimer)clearInterval(intakeTimer);if(designerTimer)clearInterval(designerTimer);await Promise.all([ai.close(),intake.close(),designer.close()]);device.close();await new Promise(r=>server.close(r));if(!options.pool)await pool.end();}};
}
export async function start(){const service=await createCommercial();const port=Number(process.env.COMMERCIAL_PORT)||3220,host=process.env.COMMERCIAL_HOST||'0.0.0.0';let advertisement;service.server.listen(port,host,()=>{console.log(`Mosaic commercial listening on ${port}`);if(process.platform==='darwin'&&process.env.COMMERCIAL_DISCOVERY_ADVERTISE!=='0'&&!['127.0.0.1','::1'].includes(host)){advertisement=spawn('/usr/bin/dns-sd',['-R',process.env.COMMERCIAL_SERVER_NAME||`Mosaic-${hostname().split('.')[0]}`,'_mosaic-player._tcp','local.',String(port),'version=2'],{stdio:'ignore'});advertisement.on('error',()=>console.warn('Bonjour unavailable; manual server address remains supported.'));}});process.once('exit',()=>advertisement?.kill());for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{advertisement?.kill();service.close().then(()=>process.exit(0));});return service;}
if(import.meta.url===`file://${process.argv[1]}`)await start();
