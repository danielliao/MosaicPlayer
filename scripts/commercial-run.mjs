import {readFile} from 'node:fs/promises';
import path from 'node:path';
const envPath=process.env.COMMERCIAL_ENV_FILE||path.resolve(import.meta.dirname,'../output/commercial-development/commercial.env');
for(const line of (await readFile(envPath,'utf8')).split('\n')){if(!line||line.startsWith('#'))continue;const at=line.indexOf('=');const k=line.slice(0,at);if(!process.env[k])process.env[k]=line.slice(at+1);}
await import('../commercial/server.js').then(m=>m.start());
