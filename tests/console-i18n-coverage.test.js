import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogs,translate,normalizeLocale,chooseLocale } from '../public/console/i18n.js';
// Match only complete double-quoted JS string arguments. JSON.parse handles
// escaped quotes/newlines; the identifier boundary excludes get/post/put.
const source=await readFile(new URL('../public/console/app.js',import.meta.url),'utf8');
const keys=[...new Set([...source.matchAll(/(?<![\w$])t\(\s*("(?:\\.|[^"\\])*")\s*\)/g)].map(match=>JSON.parse(match[1])))];
test('English catalog covers every explicit console source literal',()=>{
 assert.ok(keys.length>350,'extractor must include detailed console dialogs');
 const missing=keys.filter(key=>!Object.hasOwn(catalogs.en,key));
 assert.deepEqual(missing,[]);
 for(const key of keys){assert.ok(catalogs.en[key].trim());assert.doesNotMatch(catalogs.en[key],/[\u3400-\u9fff]/,key);}
});
test('locale fallback preserves arbitrary user and provider content',()=>{
 for(const input of ['客户自定义名称','<script>alert(1)</script>','A new provider error']) assert.equal(translate(input,'en'),input);
 assert.equal(normalizeLocale('en-US'),'zh');assert.equal(translate('关闭','fr'),'关闭');assert.equal(translate('关闭','en'),'Close');
});

test('authored dynamic alternatives preserve interpolated user content',()=>{
 const name='客户 <img onerror="alert(1)">';
 assert.equal(chooseLocale(`确认删除「${name}」？`,`Delete “${name}”?`,'en'),`Delete “${name}”?`);
 assert.equal(chooseLocale(`确认删除「${name}」？`,`Delete “${name}”?`,'zh'),`确认删除「${name}」？`);
 assert.equal(chooseLocale('中文','English','unsupported'),'中文');
});
