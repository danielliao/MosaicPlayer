import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {newPool} from '../commercial/db.js';
import {importLegacy} from '../commercial/import.js';
const root=path.resolve(import.meta.dirname,'..'),folder=path.join(root,'output/commercial-development');const envPath=process.env.COMMERCIAL_ENV_FILE||path.join(folder,'commercial.env');for(const line of(await readFile(envPath,'utf8')).split('\n')){const p=line.indexOf('=');if(p>0&&!process.env[line.slice(0,p)])process.env[line.slice(0,p)]=line.slice(p+1);}
const pool=newPool();try{const result=await importLegacy({pool,source:path.resolve(process.argv[2]||path.join(root,'.data')),dataDir:process.env.COMMERCIAL_DATA_DIR,adminUsername:process.env.COMMERCIAL_IMPORT_ADMIN_USERNAME||'default-admin',credentialsPath:path.join(folder,'import-login.json')});await writeFile(path.join(folder,'import-report.json'),JSON.stringify(result,null,2)+'\n');console.log(`Legacy import ${result.idempotent?'already present':'complete'}: ${result.screens.length} screens, ${result.media.length} assets, SHA-256 verified. Credentials in output/commercial-development/import-login.json (0600).`);}finally{await pool.end();}
