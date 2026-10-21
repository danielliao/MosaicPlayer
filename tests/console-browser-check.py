import http.server,socketserver,threading,subprocess,tempfile,json
from pathlib import Path
root=Path(__file__).resolve().parents[1] / 'public'
harness='''<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/console/style.css"><div id="app"></div><div id="toasts"></div><script type="module">
localStorage.setItem('mosaic.console.locale','en');
const payloads={'/api/session':{user:{role:'tenant_admin',name:'用户名称'},tenant:{name:'门店名称'}},'/api/overview':{},'/api/ai/models':{enabled:false,models:[{id:'m1',name:'用户模型',provider:'gateway',kind:'text',model:'demo',enabled:false}],usage:[],quotas:[]},'/api/ai/jobs':[], '/api/integrations/keys':[]};
const submissions=[];window.fetch=async(path,opts)=>{if(path==='/api/ai/jobs'&&opts?.method==='POST'){submissions.push(JSON.parse(opts.body));throw new Error('uncertain connection');}return {ok:true,json:async()=>payloads[path]||[]};};
await import('/console/app.js');
const wait=()=>new Promise(r=>setTimeout(r,80));await wait();
const b=[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('AI studio'));b.click();await wait();
const checks={disabled:document.body.textContent.includes('Server AI is disabled'),userName:document.body.textContent.includes('用户名称'),english:document.body.textContent.includes('Creation studio'),generateDisabled:[...document.querySelectorAll('button')].find(x=>x.textContent==='Generate')?.disabled};
[...document.querySelectorAll('button')].find(x=>x.textContent==='Add model').click();await wait();checks.modelDialog=!!document.querySelector('input[type=password]');
document.querySelector('.dialog-footer button').click();
[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('API keys')).click();await wait();checks.keys=document.body.textContent.includes('Integration API keys');
const {createPreview}=await import('/console/preview.js');const preview=createPreview({group:{layout:{cols:2,rows:1,tileWidth:100,tileHeight:100,gapX:10,gapY:0,screens:[{id:'a',col:0,row:0},{id:'b',col:1,row:0}]},playback:{mediaId:'asset',epoch:Date.now(),paused:true,position:0}},media:[{id:'asset',type:'image'}],serverTime:Date.now()},{locale:'en',el:(tag,attrs={},...children)=>{let n=document.createElement(tag);for(let [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.append(...children);return n;}});document.querySelector('#page').append(preview);await wait();checks.preview=preview.querySelectorAll('img[src="/media/asset"]').length===2;checks.simulationLabel=preview.textContent.includes('not a device screenshot');checks.mobile=document.documentElement.scrollWidth<=innerWidth;
payloads['/api/ai/models'].enabled=true;payloads['/api/ai/models'].models[0].enabled=true;
[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('AI studio')).click();await wait();
let generate=[...document.querySelectorAll('button')].find(x=>x.textContent==='Generate');generate.click();await wait();generate.click();await wait();checks.idempotency=submissions.length===2&&submissions[0].requestId===submissions[1].requestId;checks.errorsVisible=document.body.textContent.includes('uncertain connection');
document.body.append(Object.assign(document.createElement('pre'),{id:'result',textContent:JSON.stringify(checks)}));
</script>'''
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(root),**kw)
 def do_GET(self):
  if self.path=='/check':self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(harness.encode())
  else:super().do_GET()
 def log_message(self,*a):pass
with socketserver.TCPServer(('127.0.0.1',0),Handler) as server:
 threading.Thread(target=server.serve_forever,daemon=True).start()
 with tempfile.TemporaryDirectory() as profile:
  r=subprocess.run(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless','--no-sandbox','--disable-gpu','--window-size=390,844','--no-first-run','--user-data-dir='+profile,'--dump-dom','--virtual-time-budget=3000',f'http://127.0.0.1:{server.server_address[1]}/check'],capture_output=True,text=True)
  import re
  result=re.search(r'<pre id="result">(.*?)</pre>',r.stdout)
  print(result.group(1) if result else r.stdout[-2500:]);assert result and all(json.loads(result.group(1)).values()), 'Browser checks failed'
 server.shutdown()
