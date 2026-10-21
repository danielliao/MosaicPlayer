import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress,validateEndpoint,requestBytes} from '../commercial/outbound.js';
import {sealSecret,openSecret,estimateReservation} from '../commercial/ai.js';
import {generate} from '../commercial/ai-providers.js';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
test('SSRF rejects internal IPv4, mapped IPv6, metadata, redirects and URL credentials',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.1.2.3','::1','::ffff:127.0.0.1','fd00::1','fe80::1'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
 for(const url of ['http://example.com','https://u:p@example.com','https://example.com/#x','https://example.com/?key=x','file:///tmp/x'])assert.throws(()=>validateEndpoint(url));
 await assert.rejects(requestBytes('https://127.0.0.1/test'),/address|地址/i);
 const s=createServer((q,r)=>{r.writeHead(302,{Location:'http://127.0.0.1/private'});r.end();});await new Promise(r=>s.listen(0,'127.0.0.1',r));
 try{await assert.rejects(requestBytes(`http://127.0.0.1:${s.address().port}`,{allowHosts:['127.0.0.1']}),/redirect|重定向/i);}finally{await new Promise(r=>s.close(r));}
});
test('provider secrets authenticated at rest; reservation counts UTF8 prompt conservatively',()=>{const key=randomBytes(32),encrypted=sealSecret('test-provider-secret',key);assert.ok(!encrypted.includes('test-provider-secret'));assert.equal(openSecret(encrypted,key),'test-provider-secret');assert.throws(()=>openSecret(encrypted,randomBytes(32)));assert.equal(estimateReservation({kind:'text',unit_tokens:50},{prompt:'中文',maxOutputTokens:100}),156);assert.equal(estimateReservation({kind:'video',unit_tokens:500},{prompt:'test'}),500);});
test('provider adapters consume image, music, text and asynchronous video protocols',async()=>{
 let calls=[];const request=async(url,options={})=>{calls.push({url,options});if(url.endsWith('/chat/completions'))return {choices:[{message:{content:'copy'}}],usage:{total_tokens:17}};if(url.endsWith('/images/generations'))return {data:[{b64_json:Buffer.from('image').toString('base64')}]};if(url.endsWith('/music_generation'))return {base_resp:{status_code:0},data:{audio:Buffer.from('music').toString('hex')}};if(url.endsWith('/videos'))return {id:'video_test',status:'queued'};if(url.endsWith('/videos/video_test'))return {status:'completed'};if(url.endsWith('/videos/video_test/content'))return Buffer.from('video');throw Error('unexpected request');};
 const model={base_url:'https://example.com/v1',provider:'compatible',model:'test',kind:'text'},job={prompt:'test',lyrics:'lyrics',max_output_tokens:100};
 assert.equal((await generate(model,job,'secret',{request})).text,'copy');assert.equal((await generate({...model,kind:'image'},job,'secret',{request})).bytes.toString(),'image');assert.equal((await generate({...model,provider:'minimax',kind:'music'},job,'secret',{request})).bytes.toString(),'music');
 assert.equal((await generate({...model,kind:'video'},job,'secret',{request})).providerId,'video_test');assert.equal((await generate({...model,kind:'video'},{...job,provider_id:'video_test'},'secret',{request})).bytes.toString(),'video');
 assert.ok(calls.every(x=>x.url.startsWith('https://example.com/v1/')));
});
test('artifact downloads preserve signed query parameters without forwarding provider authorization',async()=>{let seen;const s=createServer((req,res)=>{seen={url:req.url,auth:req.headers.authorization};res.end('asset');});await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const data=await requestBytes(`http://127.0.0.1:${s.address().port}/asset?signature=fixture`,{allowHosts:['127.0.0.1']});assert.equal(data.toString(),'asset');assert.equal(seen.url,'/asset?signature=fixture');assert.equal(seen.auth,undefined);}finally{await new Promise(r=>s.close(r));}});

test('outbound IPv6 allows public 2001 providers while rejecting special and compressed non-global ranges',()=>{for(const ip of ['2001:4860:4860::8888','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip);for(const ip of ['2001:db8::1','2001::1','2001:20::1','2002:7f00:1::1','3fff::1','2::1','200:abcd::1','::ffff:127.0.0.1','fc00::1'])assert.equal(isPublicAddress(ip),false,ip);});
