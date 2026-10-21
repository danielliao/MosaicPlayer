import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,access,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import {passwordHash} from '../commercial/auth.js';
const root=path.resolve(import.meta.dirname,'..'),folder=path.join(root,'output/commercial-development'),envPath=path.join(folder,'commercial.env');
await mkdir(folder,{recursive:true,mode:0o700});
let config;
try{config=Object.fromEntries((await readFile(envPath,'utf8')).trim().split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));}catch{const owner=randomBytes(24).toString('hex'),runtime=randomBytes(24).toString('hex');config={COMMERCIAL_OWNER_PASSWORD:owner,COMMERCIAL_RUNTIME_PASSWORD:runtime,COMMERCIAL_PG_PORT:'55432',COMMERCIAL_DATABASE_URL:`postgres://mosaic_runtime:${runtime}@127.0.0.1:55432/mosaic_commercial`,COMMERCIAL_OWNER_URL:`postgres://mosaic_owner:${owner}@127.0.0.1:55432/mosaic_commercial`,COMMERCIAL_DATA_DIR:path.join(folder,'data'),COMMERCIAL_PORT:'3220',COMMERCIAL_ADMIN_USERNAME:'platform-admin',COMMERCIAL_ADMIN_PASSWORD:randomBytes(18).toString('base64url'),COMMERCIAL_COOKIE_SECURE:'false'};await writeFile(envPath,Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});}
await chmod(envPath,0o600);
execFileSync('docker',['compose','--env-file',envPath,'-f',path.join(root,'compose.commercial.yaml'),'up','-d'],{stdio:'inherit'});
const pool=new pg.Pool({connectionString:config.COMMERCIAL_OWNER_URL});let connected=false;for(let i=0;i<40;i++){try{await pool.query('SELECT 1');connected=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!connected)throw new Error('PostgreSQL unavailable');
const password=config.COMMERCIAL_RUNTIME_PASSWORD;if(!/^[a-f0-9]{48}$/.test(password))throw new Error('Invalid runtime password format');
await pool.query(`DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='mosaic_runtime') THEN CREATE ROLE mosaic_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END$$`);
await pool.query(await readFile(path.join(root,'commercial/schema.sql'),'utf8'));
await pool.query('GRANT USAGE ON SCHEMA public TO mosaic_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO mosaic_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO mosaic_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO mosaic_runtime; REVOKE UPDATE,DELETE ON audit,versions FROM mosaic_runtime;');
if(!(await pool.query("SELECT id FROM users WHERE role='platform_admin'")).rowCount)await pool.query('INSERT INTO users(id,username,name,password_hash,role,must_change_password)VALUES($1,$2,$3,$4,$5,true)',[randomUUID(),config.COMMERCIAL_ADMIN_USERNAME,'平台管理员',await passwordHash(config.COMMERCIAL_ADMIN_PASSWORD),'platform_admin']);
await pool.end();console.log(`Commercial PostgreSQL ready. Private configuration: ${envPath}. Run node scripts/commercial-run.mjs`);
