import test from 'node:test';import assert from 'node:assert/strict';
import {transitionOpacity,FrozenTransition} from '../public/transitions.js';
test('incoming epoch fixes fade progress across devices, lateness, and first-frame readiness',()=>{
 const fade={type:'fade',durationMs:600};assert.equal(transitionOpacity(fade,1000,1000,true),1);assert.equal(transitionOpacity(fade,1000,1300,true),.5);assert.equal(transitionOpacity(fade,1000,1700,true),0);assert.equal(transitionOpacity(fade,1000,1700,false),1);assert.equal(transitionOpacity({type:'cut'},1000,1000,true),0);
});
test('all image/video pairs hold old frame until ready, release it once, and cancel stale animations',()=>{
 for(const from of ['IMG','VIDEO'])for(const to of ['IMG','VIDEO']){
  let now=1000,ready=false,released=0;const frames=[],old={tagName:from,style:{},pause(){},remove(){this.removed=true}},next={tagName:to,style:{}},layer={replaceChildren(...v){this.children=v}};
  const transition=new FrozenTransition({layer,now:()=>now,doc:{},raf:fn=>frames.push(fn)});
  transition.begin(old,next,{transition:{type:'fade',durationMs:500},epoch:1000,ready:()=>ready,release:()=>released++});assert.equal(transition.covering,true);assert.equal(old.style.opacity,'1');assert.equal(released,0);
  now=1250;ready=true;frames.shift()();assert.equal(old.style.opacity,'0.5');now=1500;frames.shift()();assert.equal(transition.covering,false);assert.equal(released,1);transition.clear();assert.equal(released,1);
 }
});
test('superseding a not-ready incoming frame keeps the last visible frame, never black',()=>{
 const frames=[],layer={replaceChildren(...v){this.children=v}},old={style:{},pause(){},remove(){}},one={style:{},pause(){}},two={style:{}},t=new FrozenTransition({layer,now:()=>2000,doc:{},raf:f=>frames.push(f)});let releaseOne=0;
 t.begin(old,one,{epoch:0,ready:()=>false});t.begin(one,two,{epoch:0,ready:()=>false,release:()=>releaseOne++});assert.equal(layer.children[1],old);assert.equal(releaseOne,1);frames.shift()();assert.equal(t.covering,true);t.clear();
});
test('decoder failure during a fade restores the fully opaque previous frame',()=>{
 let ready=true,now=1250;const frames=[],previous={style:{},pause(){},remove(){}},t=new FrozenTransition({layer:{replaceChildren(){}},now:()=>now,doc:{},raf:f=>frames.push(f)});
 t.begin(previous,{style:{}},{transition:{type:'fade',durationMs:500},epoch:1000,ready:()=>ready});assert.equal(previous.style.opacity,'0.5');ready=false;now=1700;frames.shift()();assert.equal(previous.style.opacity,'1');assert.equal(t.covering,true);t.clear();
});
