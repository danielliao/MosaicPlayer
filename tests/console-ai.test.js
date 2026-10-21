import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, normalizeLocale } from '../public/console/i18n.js';
import { previewCursor, previewGeometry } from '../public/console/preview.js';
test('locale fallback and user content preservation',()=>{assert.equal(normalizeLocale('fr'),'zh');assert.equal(translate('关闭','en'),'Close');assert.equal(translate('Customer supplied name','en'),'Customer supplied name');});
test('preview follows scheduled program boundaries and pause',()=>{const manifest={activateAt:0,validUntil:10000,defaultProgram:{playlist:[{mediaId:'a',durationMs:1000}]},intervals:[{start:2000,end:4000,program:{playlist:[{mediaId:'b',durationMs:3000}]}}]};assert.equal(previewCursor({program:manifest},2500).mediaId,'b');assert.equal(previewCursor({program:manifest},4000).mediaId,'a');assert.equal(previewCursor({playback:{mediaId:'v',paused:true,position:3}},9000,[{id:'v',duration:10}]).position,3);});
test('preview geometry includes bezel gaps',()=>{assert.equal(previewGeometry({cols:2,rows:1,tileWidth:100,tileHeight:100,gapX:10,gapY:0},{col:1,row:0},200,200).x,110);});
