import {allowedStore} from './auth.js';
import {one,httpError,requireValue} from './db.js';
export const contentOwnerId=row=>row.owner_store_id??row.ownerStoreId??null;
const manager=i=>['tenant_admin','operator'].includes(i.role)||Boolean(i.support);
const sameTenant=(i,row)=>(row.tenant_id??row.tenantId??i.tenantId)===i.tenantId;
// storeId undefined: account library. Explicit storeId: selection for that store. null: HQ-owned.
export function canReadContent(i,row,storeId=undefined){if(!sameTenant(i,row)||i.isDevice)return false;const owner=contentOwnerId(row);if(storeId!==undefined){if(storeId===null)return manager(i)&&owner===null;if(!allowedStore(i,storeId))return false;return owner===storeId||owner===null&&row.shared===true;}return manager(i)||owner!==null&&allowedStore(i,owner)||owner===null&&row.shared===true;}
export function canEditContent(i,row){if(!sameTenant(i,row)||i.isDevice)return false;return manager(i)||i.role==='store_operator'&&contentOwnerId(row)!==null&&allowedStore(i,contentOwnerId(row));}
export function canShareContent(i,row){return canEditContent(i,row)&&manager(i)&&contentOwnerId(row)===null;}
export async function contentOwner(c,i,value){const owner=value===undefined||value===null||value===''?null:value;if(owner===null){if(!manager(i))throw httpError(403,'Store operators must select an authorized owner store');return null;}if(typeof owner!=='string'||!allowedStore(i,owner))throw httpError(404,'Owner store unavailable');requireValue(await one(c,'SELECT id FROM stores WHERE id=$1 AND tenant_id=$2',[owner,i.tenantId]));return owner;}
export function contentSharing(i,row,value){if(value===undefined)return row.shared??false;if(typeof value!=='boolean')throw httpError(400,'shared must be boolean');if(value!==row.shared&&!canShareContent(i,row))throw httpError(403,'Only headquarters managers can change sharing');return value;}
