import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {httpError} from './db.js';
export function isPublicAddress(ip){
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);}
 if(isIP(ip)===6){
  // IANA special-purpose registry: block protocol assignments, transition and documentation space.
  // https://www.iana.org/assignments/iana-ipv6-special-registry/
  const [first,second]=ip.toLowerCase().split(':').map(v=>parseInt(v||'0',16));
  return first>=0x2000&&first<=0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8))&&first!==0x2002&&!(first===0x3fff&&second<0x1000);
 }
 return false;
}
export function validateEndpoint(value,allowHosts=[],{allowQuery=false}={}){let url;try{url=new URL(value);}catch{throw httpError(400,'Invalid model URL');}const host=url.hostname.replace(/^\[|\]$/g,'');if(url.username||url.password||url.hash||(!allowQuery&&url.search)||(!['https:'].includes(url.protocol)&&!(url.protocol==='http:'&&allowHosts.includes(host))))throw httpError(400,'Model URL requires HTTPS without credentials, query or fragment');return url;}
export async function requestBytes(value,{method='GET',headers={},body,allowHosts=[],maxBytes=128*1024**2,timeoutMs=120000,signal}={}){
 const url=validateEndpoint(value,allowHosts,{allowQuery:true}),host=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});if(!addresses.length||!allowHosts.includes(host)&&addresses.some(x=>!isPublicAddress(x.address)))throw httpError(400,'Unsafe outbound address');
 const chosen=addresses[0];return new Promise((resolve,reject)=>{
 const req=(url.protocol==='https:'?https:http).request(url,{method,headers,signal,lookup:(_host,options,cb)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},res=>{
 if(res.statusCode>=300&&res.statusCode<400){res.resume();return reject(httpError(502,'Provider redirect rejected'));}
 if(res.statusCode<200||res.statusCode>=300){res.destroy();return reject(httpError(502,`Provider HTTP ${res.statusCode}`));}
 let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>maxBytes){res.destroy(httpError(413,'Provider response too large'));return;}chunks.push(b);});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks)));});
 const timer=setTimeout(()=>req.destroy(httpError(504,'Provider timeout; result uncertain')),timeoutMs);req.on('close',()=>clearTimeout(timer));req.on('error',reject);if(body)req.write(body);req.end();});
}
export async function requestProvider(url,{json,raw=false,...options}={}){if(json!==undefined){options.body=JSON.stringify(json);options.headers={...options.headers,'Content-Type':'application/json'};}const bytes=await requestBytes(url,options);if(raw)return bytes;try{return JSON.parse(bytes.toString('utf8'));}catch{throw httpError(502,'Invalid provider JSON');}}
