// Fade occupies the start of the incoming segment; all screens use its server epoch.
export function transitionOpacity(transition, epoch, now, ready) {
  if (!ready) return 1;
  if (transition?.type !== 'fade' || !Number.isFinite(transition.durationMs) || transition.durationMs <= 0 || !Number.isFinite(epoch) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.min(1, 1 - (now - epoch) / transition.durationMs));
}
export function freezeFrame(element, doc = document) {
  const width = element.videoWidth || element.naturalWidth, height = element.videoHeight || element.naturalHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, 1920 / Math.max(width, height)), canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  try { const ctx = canvas.getContext('2d'); if (!ctx) return null; ctx.drawImage(element, 0, 0, canvas.width, canvas.height); }
  catch { return null; }
  Object.assign(canvas.style, {position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',pointerEvents:'none',zIndex:'1'});
  return canvas;
}
export class FrozenTransition {
  constructor({layer,now,doc=document,raf=requestAnimationFrame}) {Object.assign(this,{layer,now,doc,raf});this.token=0;this.overlay=null;this.cleanup=null;}
  get covering(){return Boolean(this.overlay);}
  clear(){this.token++;this.overlay?.remove();this.overlay=null;this.cleanup?.();this.cleanup=null;}
  begin(previous,next,{transition,epoch,ready,release}) {
    // If a second switch arrives before the first renders, preserve the visible frozen frame.
    const frozen=this.overlay?null:previous&&freezeFrame(previous,this.doc);
    if(this.overlay){previous?.pause?.();release?.();}
    else if(previous){previous.pause?.();this.overlay=frozen||previous;if(frozen)release?.();else this.cleanup=release;}
    const token=++this.token;
    this.layer.replaceChildren(next,...(this.overlay?[this.overlay]:[]));
    if(!this.overlay)return;
    Object.assign(this.overlay.style,{position:'absolute',inset:'0',zIndex:'1',pointerEvents:'none'});
    const frame=()=>{
      if(token!==this.token)return;
      const alpha=transitionOpacity(transition,epoch,this.now(),ready());
      this.overlay.style.opacity=String(alpha);
      if(alpha===0){this.clear();return;}
      this.raf(frame);
    };
    frame();
  }
}
