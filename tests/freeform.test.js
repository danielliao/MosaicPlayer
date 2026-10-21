import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayout} from '../lib/model.js';
import {previewGeometry} from '../public/console/preview.js';
import {geometry} from '../public/sync.js';
const fixture=()=>({mode:'freeform',canvasWidth:4280,canvasHeight:1920,screens:[{x:0,y:0,width:1920,height:1080,rotation:0},{x:1920,y:0,width:1080,height:1920,rotation:90},{x:3000,y:0,width:1280,height:720,rotation:270}]});
test('heterogeneous rectangles preserve identities and reject injected credentials',()=>{const a=validateLayout(fixture());const raw=fixture();raw.screens=a.screens.map(s=>({...s,key:'injected'}));const b=validateLayout(raw,a.screens);assert.deepEqual(b.screens.map(s=>s.id),a.screens.map(s=>s.id));assert.deepEqual(b.screens.map(s=>s.key),a.screens.map(s=>s.key));});
test('freeform rejects overlaps bounds duplicates and invalid rotations',()=>{for(const change of [x=>x.screens[1].x=1900,x=>x.screens[2].width=2000,x=>x.screens[0].rotation=45,x=>x.screens[0].width=0,x=>x.screens[0].x=.5,x=>x.screens=[]]){const x=fixture();change(x);assert.throws(()=>validateLayout(x));}const a=validateLayout(fixture());a.screens[1].id=a.screens[0].id;assert.throws(()=>validateLayout(a,a.screens));});
test('rotation crops same logical wall with centered clockwise output',()=>{const l=validateLayout(fixture());for(const rotation of [0,90,180,270]){const s={...l.screens[1],rotation},g=geometry(l,s,1920,1080);assert.equal(g.wallWidth,4280);assert.equal(g.x,1920);assert.equal(g.tileWidth,1080);assert.equal(g.rotation,rotation);assert.equal(g.scale,rotation%180?1:1080/1920);}});

test('wall assembly preview uses upright full-scale portrait coverage and leaves compensation to players',()=>{const l=validateLayout(fixture()),s=l.screens[1],g=previewGeometry(l,s,s.width,s.height);assert.equal(g.scale,1);assert.equal(g.rotation,0);assert.equal(g.offsetX,0);assert.equal(g.offsetY,0);assert.equal(g.x,1920);});
