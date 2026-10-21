import { programCursor } from '../program.js';
import { positionAt, geometry } from '../sync.js';
export const previewGeometry = geometry;
export function previewCursor(group, now, media=[]) {
  if (group.program) return programCursor(group.program,now);
  const p=group.playback;
  return p?.mediaId ? {mediaId:p.mediaId,position:positionAt(p,now,media.find(m=>m.id===p.mediaId)?.duration)} : null;
}
export function createPreview({group,media,serverTime}, {el, locale}) {
  const root=el('div',{class:'playback-preview'}), stage=el('div',{class:'preview-stage'}), note=el('p',{},locale==='en'?'Playback simulation · muted · not a device screenshot':'播放模拟 · 静音 · 非设备实拍');
  root.append(note,stage); const layout=group.layout; let active, nodes=[]; const timestamp=typeof serverTime==='number'?serverTime:Date.parse(serverTime);const offset=timestamp-Date.now();
  if (!layout?.screens?.length) {stage.textContent=locale==='en'?'No screen layout':'尚无屏幕布局';return root;}
  const wallWidth=layout.cols*layout.tileWidth+(layout.cols-1)*layout.gapX,wallHeight=layout.rows*layout.tileHeight+(layout.rows-1)*layout.gapY;
  stage.style.aspectRatio=`${wallWidth}/${wallHeight}`;
  function update(){
    if(!root.isConnected)return;
    const cursor=previewCursor(group,Date.now()+(Number.isFinite(offset)?offset:0),media), asset=media.find(m=>m.id===cursor?.mediaId);
    if(active!==asset?.id){active=asset?.id;nodes=[];stage.replaceChildren();
      if(asset)for(const screen of layout.screens){const g=geometry(layout,screen,layout.tileWidth,layout.tileHeight),tile=el('div',{class:'preview-screen'});Object.assign(tile.style,{left:`${g.x/wallWidth*100}%`,top:`${g.y/wallHeight*100}%`,width:`${layout.tileWidth/wallWidth*100}%`,height:`${layout.tileHeight/wallHeight*100}%`});const node=el(asset.type==='video'?'video':asset.type==='audio'?'audio':'img',{src:`/media/${encodeURIComponent(asset.id)}`,onError:()=>{note.textContent=locale==='en'?'Preview media could not be loaded':'无法加载预览素材';}});Object.assign(node.style,{position:'absolute',width:`${wallWidth/layout.tileWidth*100}%`,height:`${wallHeight/layout.tileHeight*100}%`,maxWidth:'none',left:`${-g.x/layout.tileWidth*100}%`,top:`${-g.y/layout.tileHeight*100}%`,objectFit:group.playback?.fit||'contain'});if(asset.type==='video'||asset.type==='audio'){node.muted=true;node.loop=true;node.playsInline=true;}tile.append(node,el('span',{class:'preview-screen-label'},screen.name||`${screen.col+1},${screen.row+1}`));stage.append(tile);nodes.push(node);}
    }
    for(const node of nodes)if(node.tagName==='VIDEO'||node.tagName==='AUDIO'){if(node.readyState&&Math.abs(node.currentTime-cursor.position)>.3)node.currentTime=cursor.position;if(group.playback?.paused&&!group.program)node.pause();else node.play().catch(()=>{});}
  }
  const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);nodes.forEach(n=>n.pause?.());return;}update();},500);queueMicrotask(update);return root;
}
