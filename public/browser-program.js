import { programCursor, programContent, programMediaIDs } from "./program.js";

export class BrowserProgram {
  constructor({key,screenId,send,error}) {
    Object.assign(this,{key,screenId,send,error});
    this.assets=new Map();this.ready=new Set();this.loading=new Set();this.active=null;this.incoming=null;this.generation=0;this.receiveSequence=0;
    this.audio=new Audio();this.audio.loop=true;this.audioID=null;this.audioBlocked=false;this.presentedID=null;
    this.supported=Boolean(globalThis.crypto?.subtle);this.namespace=null;this.lastReady=0;
    this.persistedState=null;this.persisting=false;this.lastSaveAttempt=-Infinity;this.lastAttemptedState=null;
  }
  async database() {
    if (!this.supported) throw new Error("浏览器节目缓存需要 HTTPS 或 localhost；局域网推荐原生播放器");
    if (!this.dbPromise) this.dbPromise=(async()=>{
      const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(this.key));
      this.namespace=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,"0")).join("");
      return new Promise((resolve,reject)=>{
        const r=indexedDB.open(`mosaic-program-${this.namespace}`,1);
        r.onupgradeneeded=()=>r.result.createObjectStore("files");
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
    })();
    return this.dbPromise;
  }
  async get(id) {
    const db=await this.database();
    return new Promise((resolve,reject)=>{const r=db.transaction("files").objectStore("files").get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  }
  async put(id,value) {
    const db=await this.database();
    return new Promise((resolve,reject)=>{const t=db.transaction("files","readwrite");t.objectStore("files").put(value,id);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});
  }
  async restore() {
    if (!this.supported) return null;
    const generation=this.generation,sequence=this.receiveSequence;
    try {
      const state=await this.get("state");
      if(generation!==this.generation||sequence!==this.receiveSequence)return null;
      if(state?.program){
        await this.prepare(state.program,state.media);
        if(generation!==this.generation||sequence!==this.receiveSequence)return null;
        this.incoming=state;return state;
      }
    } catch {}
    return null;
  }
  async prepare(manifest,media) {
    if(this.ready.has(manifest.id)||this.loading.has(manifest.id))return;
    this.loading.add(manifest.id);const generation=this.generation;
    try{
      const ids=programMediaIDs(manifest),assets=ids.map(id=>media.find(x=>x.id===id));
      if(assets.some(x=>!x)||assets.reduce((s,x)=>s+x.size,0)>1024**3)throw new Error("节目缺少资源或超出浏览器 1 GiB 缓存预算");
      for(const asset of assets){
        if(this.assets.has(asset.id))continue;
        let blob=await this.get(asset.id);
        const verify=async data=>data?.size===asset.size&&(!asset.sha256||Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await data.arrayBuffer())),x=>x.toString(16).padStart(2,"0")).join("")===asset.sha256);
        if(!await verify(blob)){
          const response=await fetch(`/media/${encodeURIComponent(asset.id)}`,{headers:{Authorization:`Bearer ${this.key}`},redirect:"error"});
          if(!response.ok)throw new Error("节目下载失败");
          blob=await response.blob();if(!await verify(blob))throw new Error("节目完整性校验失败");
          await this.put(asset.id,blob);
        }
        if(generation!==this.generation)return;
        const url=URL.createObjectURL(blob);
        try { await this.validateDecode(asset,url); }
        catch(error){URL.revokeObjectURL(url);throw error;}
        if(generation!==this.generation){URL.revokeObjectURL(url);return;}
        this.assets.set(asset.id,url);
      }
      if(generation===this.generation)this.ready.add(manifest.id);
    }finally{this.loading.delete(manifest.id);}
  }
  async validateDecode(asset,url) {
    await new Promise((resolve,reject)=>{
      const media=document.createElement(asset.type==="image"?"img":asset.type==="audio"?"audio":"video");
      let settled=false;
      const finish=error=>{
        if(settled)return;settled=true;clearTimeout(timeout);
        media.onload=media.onloadeddata=media.onerror=null;
        media.pause?.();media.removeAttribute("src");media.load?.();
        error?reject(error):resolve();
      };
      const timeout=setTimeout(()=>finish(Error("节目解码准备超时")),20000);
      media.onerror=()=>finish(Error("浏览器无法解码节目素材"));
      if(asset.type==="image")media.onload=()=>finish();
      else{media.muted=true;media.preload="auto";media.onloadeddata=()=>finish();}
      media.src=url;
    });
  }
  receive(state) {
    this.receiveSequence++;
    this.incoming=state;
    if(!state.program&&!state.pendingProgram){this.active=null;this.presentedID=null;this.audio.pause();return;}
    for(const manifest of [state.program,state.pendingProgram?.program].filter(Boolean)){
      this.prepare(manifest,state.media).catch(e=>{
        this.error(e.message);
        if(this.incoming?.pendingProgram?.program.id===manifest.id)this.send({type:"failed",id:this.incoming.pendingProgram.id,error:e.message});
      });
    }
  }
  effective(now) {
    const pending=this.incoming?.pendingProgram;
    if(pending&&this.ready.has(pending.program.id)&&now-this.lastReady>1000){this.send({type:"ready",id:pending.id});this.lastReady=now;}
    const incoming=this.incoming;
    if(incoming?.program&&this.ready.has(incoming.program.id)&&now>=incoming.program.activateAt){
      this.active=incoming;
      if(this.persistedState!==incoming&&!this.persisting&&(this.lastAttemptedState!==incoming||now-this.lastSaveAttempt>=5000)){
        this.persisting=true;this.lastSaveAttempt=now;this.lastAttemptedState=incoming;
        const generation=this.generation;
        this.put("state",{...incoming,pending:null,pendingProgram:null})
          .then(()=>{if(generation===this.generation){this.persistedState=incoming;return this.prune();}})
          .catch(e=>this.error(`离线保存失败，正在重试：${e.message}`)).finally(()=>this.persisting=false);
      }
    }
    if(!this.active)return null;
    const cursor=programCursor(this.active.program,now);
    if(!cursor)return null;
    if(this.presentedID===this.active.program.id)this.updateAudio(now);
    return {...this.active,pending:null,pendingProgram:null,playback:{mediaId:cursor.mediaId,epoch:cursor.epoch,paused:false,position:0,revision:Math.round(cursor.epoch)}};
  }
  updateAudio(now) {
    const content=programContent(this.active.program,now).content;
    const cursor=programCursor(this.active.program,now,true);
    if(this.active.audioScreenId!==this.screenId||content.audioMode!=="music"||!cursor){this.audio.pause();return;}
    const url=this.assets.get(cursor.mediaId);if(!url)return;
    if(this.audioID!==cursor.mediaId){this.audioID=cursor.mediaId;this.audio.src=url;}
    this.audio.volume=content.volume;
    if(this.audio.readyState>=2&&Math.abs(this.audio.currentTime-cursor.position)>1&&!this.audio.seeking)this.audio.currentTime=cursor.position;
    if(this.audio.paused&&!this.audioBlocked){this.audioBlocked=true;this.audio.play().then(()=>this.audioBlocked=false).catch(()=>this.error("请点击全屏按钮授权音乐播放"));}
  }
  videoVolume(now) {
    if(!this.active||this.active.audioScreenId!==this.screenId)return 0;
    const content=programContent(this.active.program,now).content;
    return content.audioMode==="video"?content.volume:0;
  }
  unlockAudio(){this.audioBlocked=false;if(this.audio.src)this.audio.play().catch(()=>{});}
  async prune() {
    if(!this.active)return;
    const protectedIDs=()=>{
      const keep=new Set();
      for(const manifest of [this.active?.program,this.incoming?.pendingProgram?.program,this.incoming?.program].filter(Boolean))for(const id of programMediaIDs(manifest))keep.add(id);
      return keep;
    };
    const db=await this.database();
    if(!this.active)return;
    await new Promise((resolve,reject)=>{
      const t=db.transaction("files","readwrite"),store=t.objectStore("files"),r=store.openCursor();
      r.onsuccess=()=>{const c=r.result;if(!c)return;if(c.key!=="state"&&!protectedIDs().has(c.key))c.delete();c.continue();};
      t.oncomplete=resolve;t.onerror=()=>reject(t.error);
    });
    const keep=protectedIDs();
    for(const[id,url]of this.assets)if(!keep.has(id)){URL.revokeObjectURL(url);this.assets.delete(id);}
    for(const id of this.ready)if(id!==this.active.program.id&&id!==this.incoming?.pendingProgram?.program.id&&id!==this.incoming?.program?.id)this.ready.delete(id);
  }
  async revoke() {
    this.generation++;this.receiveSequence++;this.ready.clear();this.loading.clear();
    this.active=this.incoming=null;this.presentedID=null;this.audio.pause();
    for(const url of this.assets.values())URL.revokeObjectURL(url);this.assets.clear();
    if(this.dbPromise){const db=await this.dbPromise;db.close();indexedDB.deleteDatabase(db.name);}
  }
}
