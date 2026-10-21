import { programCursor } from '../program.js';
import { positionAt, geometry } from '../sync.js';
import { FrozenTransition } from '../transitions.js';
// Wall assembly shows logical coverage; physical mounting compensation belongs to players.
export const previewGeometry = (layout, screen, width, height) => geometry(layout, {...screen, rotation:0}, width, height);
export function previewCursor(group, now, media=[]) {
  if (group.program) return programCursor(group.program,now);
  const p=group.playback;
  return p?.mediaId ? {mediaId:p.mediaId,position:positionAt(p,now,media.find(m=>m.id===p.mediaId)?.duration),epoch:p.epoch,transition:p.transition} : null;
}
export function createPreview({group,media,serverTime}, {el, locale}) {
  const caption=locale==='en'?'Playback simulation · muted · not a device screenshot':'播放模拟 · 静音 · 非设备实拍';
  const root=el('div',{class:'playback-preview'}),stage=el('div',{class:'preview-stage'}),note=el('p',{},caption);
  root.append(note,stage);const layout=group.layout,timestamp=typeof serverTime==='number'?serverTime:Date.parse(serverTime),offset=timestamp-Date.now(),now=()=>Date.now()+(Number.isFinite(offset)?offset:0);
  if(!layout?.screens?.length){stage.textContent=locale==='en'?'No screen layout':'尚无屏幕布局';return root;}
  const wallWidth=layout.mode==='freeform'?layout.canvasWidth:layout.cols*layout.tileWidth+(layout.cols-1)*layout.gapX,wallHeight=layout.mode==='freeform'?layout.canvasHeight:layout.rows*layout.tileHeight+(layout.rows-1)*layout.gapY;
  stage.style.aspectRatio=`${wallWidth}/${wallHeight}`;
  const tiles=layout.screens.map(screen=>{
    const tw=layout.mode==='freeform'?screen.width:layout.tileWidth,th=layout.mode==='freeform'?screen.height:layout.tileHeight,g=previewGeometry(layout,screen,tw,th),tile=el('div',{class:'preview-screen'}),crop=el('div'),surface=el('div',{class:'preview-surface'});
    Object.assign(tile.style,{left:`${g.x/wallWidth*100}%`,top:`${g.y/wallHeight*100}%`,width:`${tw/wallWidth*100}%`,height:`${th/wallHeight*100}%`});
    Object.assign(crop.style,{position:'absolute',overflow:'hidden',left:`${g.offsetX/tw*100}%`,top:`${g.offsetY/th*100}%`,width:`${g.scale*100}%`,height:`${g.scale*100}%`,transform:`rotate(${g.rotation}deg)`,transformOrigin:'center'});
    Object.assign(surface.style,{position:'absolute',width:`${wallWidth/tw*100}%`,height:`${wallHeight/th*100}%`,maxWidth:'none',left:`${-g.x/tw*100}%`,top:`${-g.y/th*100}%`});
    crop.append(surface);tile.append(crop,el('span',{class:'preview-screen-label'},`${screen.name||`${screen.col+1},${screen.row+1}`} · ↻${screen.rotation||0}°`));stage.append(tile);
    return {surface,transition:new FrozenTransition({layer:surface,now,doc:document,raf:callback=>requestAnimationFrame(callback)}),node:null};
  });
  let active=null,pending=null,generation=0,retryAt=0,retryId=null;const preparing=new Set();
  const destroy=node=>{if(!node)return;node.pause?.();node.removeAttribute('src');if(node.tagName==='VIDEO'||node.tagName==='AUDIO')node.load();node.remove();};
  function prepare(asset,cursor){return new Promise((resolve,reject)=>{
    const node=el(asset.type==='video'?'video':asset.type==='audio'?'audio':'img');preparing.add(node);
    Object.assign(node.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover'});
    let done=false,timer,frameReady=asset.type==='image';
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);node.removeEventListener('error',failed);node.removeEventListener('load',loaded);node.removeEventListener('loadeddata',loaded);if(error){preparing.delete(node);destroy(node);reject(error);}else resolve({node,ready:()=>asset.type==='image'||node.readyState>=2&&!node.seeking&&frameReady});};
    const failed=()=>finish(new Error(locale==='en'?'Preview media could not be loaded; previous frame retained':'无法加载预览素材，保留原画面'));
    const observe=()=>{frameReady=false;if(node.requestVideoFrameCallback)node.requestVideoFrameCallback(()=>{frameReady=true;});else frameReady=true;};
    function loaded(){if(asset.type==='image'){if(node.decode)node.decode().then(()=>finish(),failed);else finish();}else{try{node.currentTime=cursor.position;}catch{}observe();node.play().catch(()=>{});finish();}}
    node.addEventListener('error',failed);node.addEventListener(asset.type==='image'?'load':'loadeddata',loaded,{once:true});
    if(asset.type!=='image'){node.muted=true;node.defaultMuted=true;node.loop=true;node.playsInline=true;node.preload='auto';node.addEventListener('seeking',observe);}
    timer=setTimeout(failed,15000);node.src=`/media/${encodeURIComponent(asset.id)}`;
  });}
  async function switchMedia(asset,cursor){pending=asset.id;const ticket=++generation;let prepared=[];try{
    const results=await Promise.allSettled(tiles.map(()=>prepare(asset,cursor)));prepared=results.filter(x=>x.status==='fulfilled').map(x=>x.value);if(results.some(x=>x.status==='rejected'))throw results.find(x=>x.status==='rejected').reason;
    if(ticket!==generation||!root.isConnected){prepared.forEach(x=>{preparing.delete(x.node);destroy(x.node);});return;}
    for(let index=0;index<tiles.length;index++){const tile=tiles[index],item=prepared[index],previous=tile.node;preparing.delete(item.node);tile.node=item.node;tile.transition.begin(previous,item.node,{transition:cursor.transition,epoch:cursor.epoch,ready:item.ready,release:()=>destroy(previous)});}
    active=asset.id;retryAt=0;retryId=null;note.textContent=caption;
  }catch(e){prepared.forEach(x=>{preparing.delete(x.node);destroy(x.node);});if(ticket===generation){retryAt=Date.now()+5000;retryId=asset.id;note.textContent=e.message;}}
  finally{if(ticket===generation)pending=null;}}
  function update(){if(!root.isConnected)return;const cursor=previewCursor(group,now(),media),asset=media.find(m=>m.id===cursor?.mediaId);
    if(asset&&active!==asset.id&&pending!==asset.id&&(asset.id!==retryId||Date.now()>=retryAt))switchMedia(asset,cursor);
    if(asset?.id!==active)return;
    for(const {node} of tiles)if(node&&(node.tagName==='VIDEO'||node.tagName==='AUDIO')){if(node.readyState&&!node.seeking&&Math.abs(node.currentTime-cursor.position)>.3)node.currentTime=cursor.position;if(group.playback?.paused&&!group.program)node.pause();else node.play().catch(()=>{});}
  }
  const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);generation++;preparing.forEach(destroy);preparing.clear();tiles.forEach(tile=>{tile.transition.clear();destroy(tile.node);});return;}update();},100);queueMicrotask(update);return root;
}
