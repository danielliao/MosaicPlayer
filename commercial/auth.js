import {randomBytes,scrypt as rawScrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {one,tx,httpError,camel} from './db.js';
const scrypt=promisify(rawScrypt);
export const secret=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
export async function passwordHash(password){if(typeof password!=='string'||password.length<12||password.length>256)throw httpError(400,'密码需要 12–256 个字符');const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
export async function passwordMatches(password,hash){if(typeof password!=='string'||password.length>256)return false;const [type,salt,hex]=String(hash).split(':');if(type!=='scrypt'||!salt||!hex)return false;const actual=await scrypt(password,salt,64),expected=Buffer.from(hex,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export function cookieToken(req){const raw=req.headers.cookie||'';return raw.split(';').map(s=>s.trim()).find(s=>s.startsWith('mosaic_session='))?.slice(15);}
export async function identify(pool,req,{allowQuery=false}={}){const bearer=req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]||(allowQuery?new URL(req.url,'http://localhost').searchParams.get('key'):null);
 if(bearer){const d=await one(pool,'SELECT * FROM auth_device($1)',[digest(bearer)]);if(!d)return null;return {...camel(d),role:'device',registeredCapabilities:d.capabilities,capabilities:parseCapabilities(req.headers['x-mosaic-capabilities']),isDevice:true};}
 const token=cookieToken(req);if(!token)return null;const r=await one(pool,'SELECT * FROM auth_session($1)',[digest(token)]);if(!r)return null;const u=camel(r.user_data),s=camel(r.session_data);return {...u,tenantId:s.supportTenantId||u.tenantId,platform:u.role==='platform_admin',support:Boolean(s.supportTenantId),sessionId:s.id,csrf:s.csrf};
}
export function parseCapabilities(v){return (Array.isArray(v)?v:String(v||'').split(',')).map(s=>String(s).trim()).filter(s=>['programs','audio','screenshot','updates','freeform'].includes(s));}
export function checkWrite(req,identity){if(identity.isDevice)return;const origin=req.headers.origin;if(origin&&origin!==`${req.protocol}://${req.headers.host}`)throw httpError(403,'请求来源无效');if(!req.headers['x-csrf-token']||req.headers['x-csrf-token']!==identity.csrf)throw httpError(403,'CSRF 验证失败');if(identity.mustChangePassword&&!['/api/password','/api/logout'].includes(req.path))throw httpError(403,'请先修改初始密码');}
export function requireRole(identity,roles){if(identity.isDevice||(!roles.includes(identity.role)&&!(identity.platform&&identity.support)))throw httpError(403,'权限不足');}
export function allowedStore(identity,storeId){return identity.platform&&identity.support||['tenant_admin','operator'].includes(identity.role)||identity.isDevice&&identity.storeId===storeId||identity.storeIds?.includes(storeId);}
export function scopeStore(identity,storeId){if(!allowedStore(identity,storeId))throw httpError(404,'资源不存在');}
export const publicUser=i=>({id:i.id,name:i.name,username:i.username,role:i.support?'tenant_admin':i.role,tenantId:i.tenantId,storeIds:i.storeIds||[],mustChangePassword:i.mustChangePassword,platform:i.platform,support:i.support});
export async function sessionPayload(pool,i){return {user:publicUser(i),csrf:i.csrf,tenant:i.tenantId?await tx(pool,i,async c=>camel(await one(c,'SELECT * FROM tenants WHERE id=$1',[i.tenantId]))):null};}
export function setSessionCookie(res,token,secure){res.cookie('mosaic_session',token,{httpOnly:true,sameSite:'strict',secure,maxAge:12*3600e3,path:'/'});}
export function limiter(max,windowMs){const values=new Map();return key=>{const now=Date.now();for(const[k,v]of values)if(v.until<now)values.delete(k);const v=values.get(key)||{n:0,until:now+windowMs};v.n++;values.set(key,v);if(v.n>max)throw httpError(429,'请求过于频繁，请稍后重试');};}
