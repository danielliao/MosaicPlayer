import pg from 'pg';
export const newPool=(connectionString=process.env.COMMERCIAL_DATABASE_URL)=>new pg.Pool({connectionString,max:12,idleTimeoutMillis:20000});
export async function tx(pool,identity,fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.platform',$2,true)",[identity?.tenantId||'',identity?.platform?'true':'false']);const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export const one=async(c,sql,args=[])=>{const r=await c.query(sql,args);return r.rows[0]||null;};
export const rows=async(c,sql,args=[]) =>(await c.query(sql,args)).rows;
export function httpError(status,message){return Object.assign(new Error(message),{status});}
export function requireValue(value,message='资源不存在'){if(!value)throw httpError(404,message);return value;}
export async function audit(c,identity,action,target,details={}){await c.query('INSERT INTO audit(tenant_id,actor_id,action,target,details)VALUES($1,$2,$3,$4,$5)',[identity.tenantId||null,identity.id||null,action,String(target||''),details]);}
export const camel=row=>row&&Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,x)=>x.toUpperCase()),v]));
