import base64
import http.server,socketserver,threading,subprocess,tempfile,json,os,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1] / 'public'
harness='''<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/console/style.css"><div id="app"></div><div id="toasts"></div><script type="module">
localStorage.setItem('mosaic.console.locale','en');
const payloads={'/api/session':{user:{role:'tenant_admin',name:'用户名称'},tenant:{name:'门店名称'}},'/api/overview':{},'/api/ai/models':{enabled:false,models:[{id:'m1',name:'用户模型',provider:'gateway',kind:'text',model:'demo',enabled:false}],usage:[],quotas:[]},'/api/ai/jobs':[], '/api/integrations/keys':[]};
const submissions=[];window.fetch=async(path,opts)=>{if(path==='/api/ai/jobs'&&opts?.method==='POST'){submissions.push(JSON.parse(opts.body));throw new Error('uncertain connection');}return {ok:true,json:async()=>payloads[path]||[]};};
await import('/console/app.js');
const wait=()=>new Promise(r=>setTimeout(r,80));await wait();
const overviewOK=!document.querySelector('#app').textContent.includes('Unable to load data');
const b=[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('AI studio'));b.click();await wait();
const checks={overviewOK,disabled:document.querySelector('#app').textContent.includes('Server AI is disabled'),userName:document.querySelector('#app').textContent.includes('用户名称'),english:document.querySelector('#app').textContent.includes('Creation studio'),generateDisabled:[...document.querySelectorAll('button')].find(x=>x.textContent==='Generate')?.disabled};
[...document.querySelectorAll('button')].find(x=>x.textContent==='Add model').click();await wait();checks.modelDialog=!!document.querySelector('input[type=password]');
document.querySelector('.dialog-footer button').click();
[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('API keys')).click();await wait();checks.keys=document.querySelector('#app').textContent.includes('Integration API keys');
const {createPreview}=await import('/console/preview.js');const preview=createPreview({group:{layout:{cols:2,rows:1,tileWidth:100,tileHeight:100,gapX:10,gapY:0,screens:[{id:'a',col:0,row:0},{id:'b',col:1,row:0}]},playback:{mediaId:'asset',epoch:Date.now(),paused:true,position:0}},media:[{id:'asset',type:'image'}],serverTime:Date.now()},{locale:'en',el:(tag,attrs={},...children)=>{let n=document.createElement(tag);for(let [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.append(...children);return n;}});document.querySelector('#page').append(preview);await wait();checks.preview=preview.querySelectorAll('img[src="/media/asset"]').length===2;checks.simulationLabel=preview.textContent.includes('not a device screenshot');checks.mobile=document.documentElement.scrollWidth<=innerWidth;
payloads['/api/ai/models'].enabled=true;payloads['/api/ai/models'].models[0].enabled=true;
[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('AI studio')).click();await wait();
let generate=[...document.querySelectorAll('button')].find(x=>x.textContent==='Generate');generate.click();await wait();document.querySelector('textarea').value='changed after uncertainty';generate.click();await wait();checks.frozenPayload=submissions[0].prompt===submissions[1].prompt&&document.querySelector('textarea').disabled;checks.idempotency=submissions.length===2&&submissions[0].requestId===submissions[1].requestId;checks.errorsVisible=document.querySelector('#app').textContent.includes('uncertain connection');
document.body.append(Object.assign(document.createElement('pre'),{id:'result',hidden:true,textContent:JSON.stringify(checks)}));
</script>'''

scenario='''<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/console/style.css"><div id="app"></div><div id="toasts"></div><script type="module">
localStorage.setItem('mosaic.console.locale','en');const params=new URLSearchParams(location.search),platform=params.has('platform');
const layout={cols:2,rows:1,tileWidth:1920,tileHeight:1080,gapX:30,gapY:0,screens:[{id:'a',name:'Screen A',col:0,row:0},{id:'b',name:'Screen B',col:1,row:0}]};
const payloads={'/api/session':platform?{user:{role:'platform_admin',name:'Admin'}}:{user:{role:'tenant_admin',name:'Tenant'},tenant:{name:'Tenant'}},'/api/platform/tenants':[{id:'tenant',name:'Demo tenant',status:'active',limits:{stores:10,devices:20,users:5,storageBytes:1024}}],'/api/overview':{},'/api/stores':[{id:'store',name:'Lobby',timezone:'UTC'}],'/api/groups':[{id:'group',name:'Video wall',storeId:'store',layout,playback:{paused:true}}],'/api/templates':[{id:'template',name:'Demo template',slots:[]}],'/api/versions':[]};
window.fetch=async path=>({ok:true,json:async()=>payloads[path]||[]});await import('/console/app.js');const wait=()=>new Promise(r=>setTimeout(r,100));await wait();const checks={initialPage:!document.querySelector('#app').textContent.includes('Unable to load data')};
if(platform){checks.tenantCard=document.querySelector('#app').textContent.includes('Demo tenant');checks.quotaSummary=document.querySelector('#app').textContent.includes('Stores 10');[...document.querySelectorAll('button')].find(b=>b.textContent==='Service & quotas')?.click();checks.tenantNoCrash=!document.querySelector('#app').textContent.includes('t is not a function');}
else{[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Programs')).click();await wait();checks.templateCard=document.querySelector('#app').textContent.includes('Demo template');checks.templateNoCrash=!document.querySelector('#app').textContent.includes('Unable to load data');[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Stores & groups')).click();await wait();[...document.querySelectorAll('button')].find(b=>b.textContent==='Layout & audio').click();await wait();const select=[...document.querySelectorAll('.dialog select')].find(s=>[...s.options].some(o=>o.value==='freeform'));select.value='freeform';select.dispatchEvent(new Event('change'));await wait();checks.freeform=!document.querySelector('.dialog').textContent.includes('t is not a function');[...document.querySelectorAll('.dialog button')].find(b=>b.textContent==='Add screen').click();await wait();checks.add=document.querySelectorAll('.dialog button').length>5;[...document.querySelectorAll('.dialog button')].filter(b=>b.textContent==='Portrait preset')[1].click();await wait();const rotations=[...document.querySelectorAll('.dialog select')].filter(s=>[...s.options].some(o=>o.value==='270'));checks.portrait=rotations[1].value==='90';const fields=[...document.querySelectorAll('.dialog input')].map(n=>n.value);checks.gapPreserved=fields.includes('1950');checks.layoutPreview=document.querySelectorAll('.freeform-layout-preview div').length>0||document.querySelector('.dialog [style*="aspect-ratio"]')!==null;checks.noHorizontalOverflow=document.documentElement.scrollWidth<=innerWidth;}
document.body.append(Object.assign(document.createElement('pre'),{id:'result',hidden:true,textContent:JSON.stringify(checks)}));
</script>'''

class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(root),**kw)
 def do_GET(self):
  if self.path == '/media/asset':
   image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==');self.send_response(200);self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(image)
  elif self.path.startswith('/check'):
   self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write((scenario if self.path.startswith('/check-scenario') else harness).encode())
  else:super().do_GET()
 def log_message(self,*a):pass
with socketserver.TCPServer(('127.0.0.1',0),Handler) as server:
 threading.Thread(target=server.serve_forever,daemon=True).start()
 for route in ['/check','/check-scenario','/check-scenario?platform=1']:
  result=subprocess.run(['node',str(root.parent/'tests/browser-runner.mjs'),f'http://127.0.0.1:{server.server_address[1]}{route}'],capture_output=True,text=True,timeout=45)
  assert result.returncode==0,result.stderr
  data=json.loads(result.stdout);print(route,data)
  assert data['viewport']['width']==390, 'Phone viewport not active'
  assert all(data['checks'].values()), 'Browser interaction failed'
 server.shutdown()
