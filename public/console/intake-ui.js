export async function openIntake(h){
 const {el,button,field,select,dialog,get,post,locale}=h,L=(zh,en)=>locale==='en'?en:zh;
 const body=dialog(L('广告素材入稿','Creative intake'),{wide:true});
 const status=el('p',{class:'meta'},L('读取素材…','Loading media…'));body.append(status);
 try{
  const media=await get('/api/media'),assets=(Array.isArray(media)?media:media.items||[]).filter(m=>!m.archived&&['video','image'].includes(m.type));
  const source=select(assets.map(m=>[m.id,m.name||m.id])),quality=select([['tv',L('电视档 2880 × 540（每屏 960 × 540）','TV · 2880 × 540 (960 × 540 per panel)')],['full',L('全尺寸 5760 × 1080（需测试解码能力）','Full · 5760 × 1080 (test decoder support)')]],'tv');
  body.replaceChildren(el('p',{class:'help'},L('将 3840 × 2160 四宫格的左上、右上、左下映射为横向三联屏。原文件保留，右下区域不使用。检查结果是技术提示，不代表内容审核通过。','Map the top-left, top-right and bottom-left quadrants of a 3840 × 2160 source to three horizontal screens. Preserve the original; omit the bottom-right. Technical checks do not approve advertising content.')),field(L('源素材','Source'),source),field(L('输出质量','Output quality'),quality));
  const result=el('div'),checks=el('div'),actions=el('div',{class:'actions'});body.append(actions,checks,result);let checkRevision=0;source.addEventListener('change',()=>{checkRevision++;checks.replaceChildren();});
  const labels={dimensions:L('像素尺寸','Dimensions'),codec:L('编码','Codec'),duration:L('时长','Duration'),frameRate:L('帧率','Frame rate'),bitrate:L('视频码率','Video bitrate'),audio:L('音频','Audio'),loudness:L('响度与首尾静音','Loudness & silent edges')};
  const expected={dimensions:'3840 × 2160',codec:L('JPEG RGB / H.264','JPEG RGB / H.264'),duration:L('15 / 30 秒（±0.15 秒）','15 / 30 seconds (±0.15)'),frameRate:'29.97 fps',bitrate:'10–30 Mbps',audio:L('AAC ≥160 kbps，或无音轨','AAC ≥160 kbps, or no audio'),loudness:L('须人工或音频分析核验：-24 LKFS，首尾各静音 0.5 秒','Manual/audio analysis: -24 LKFS and 0.5 second silent edges')};
  actions.append(button(L('检查规格','Check specifications'),async()=>{const revision=++checkRevision,id=source.value;checks.textContent=L('正在检查…','Checking…');try{const report=await get(`/api/media/${encodeURIComponent(id)}/intake`);if(revision!==checkRevision||id!==source.value)return;checks.replaceChildren(el('h3',{},assets.find(m=>m.id===id)?.name||id),...report.checks.map(c=>el('p',{class:'meta'},`${c.pass===true?'✓':c.pass===false?'!':'?'} ${labels[c.code]||c.code}: ${c.value??'—'} · ${expected[c.code]||c.expected}`)));}catch(e){if(revision===checkRevision)checks.textContent=e.message;}}));
  let pending=null,jobId=null;const convert=button(L('生成三联屏素材','Create three-panel asset'),async()=>{convert.disabled=true;try{
   if(!pending){pending={sourceId:source.value,body:{mapping:'quadrants-to-three',quality:quality.value,requestId:crypto.randomUUID()}};source.disabled=quality.disabled=true;}
   const job=jobId?await get('/api/intake/jobs/'+jobId):await post(`/api/media/${encodeURIComponent(pending.sourceId)}/derive`,pending.body);jobId=job.id;
   if(job.status==='completed'){result.replaceChildren(el('p',{},L('已生成，可在素材库和节目中选择。','Created. Select the asset in the media library or a program.')),el('a',{href:'/media/'+job.resultId,target:'_blank',rel:'noopener'},L('预览新素材','Preview asset')));convert.textContent=L('查看转换结果','View conversion result');}
   else if(job.status==='failed'){result.textContent=job.error;pending=null;jobId=null;source.disabled=quality.disabled=false;convert.textContent=L('重新生成','Create again');}
   else{result.textContent=L('正在排队或转换，点击刷新查看结果。','Queued or converting. Refresh to check the result.');convert.textContent=L('刷新转换状态','Refresh conversion status');}
  }catch(e){result.textContent=e.message;if(e.status>=400&&e.status<500){pending=null;jobId=null;source.disabled=quality.disabled=false;}convert.textContent=L('重试 / 刷新','Retry / refresh');}finally{convert.disabled=false;}},'primary');actions.append(convert);
  if(!assets.length){convert.disabled=true;status.textContent=L('请先上传图片或视频。','Upload an image or video first.');body.append(status);}
 }catch(e){status.textContent=e.message;}
}
