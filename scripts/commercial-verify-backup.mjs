import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
const destination=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Usage: node scripts/commercial-verify-backup.mjs <backup-directory>');
const manifest=JSON.parse(await readFile(path.join(destination,'manifest.json'),'utf8'));
const dump=await readFile(path.join(destination,'database.dump'));
if(createHash('sha256').update(dump).digest('hex')!==manifest.dumpSHA256)throw Error('Backup checksum mismatch');
const database='mosaic_restore_'+randomUUID().replaceAll('-','');
function run(args,input){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i','mosaic-commercial-postgres',...args],{stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(error||`Command failed: ${code}`)));child.stdin.end(input);});}
await run(['createdb','-U','mosaic_owner',database]);
try {
 await run(['pg_restore','-U','mosaic_owner','-d',database,'--exit-on-error'],dump);
 const result=await run(['psql','-U','mosaic_owner','-d',database,'-At','-c',"SELECT json_build_object('tenants',(SELECT count(*) FROM tenants),'devices',(SELECT count(*) FROM devices),'media',(SELECT count(*) FROM media),'versions',(SELECT count(*) FROM versions))"]);
 console.log('Isolated PostgreSQL restore verified: '+result.trim());
}finally{await run(['dropdb','-U','mosaic_owner',database]);}
