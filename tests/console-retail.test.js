import test from 'node:test';import assert from 'node:assert/strict';
import {parseCSV,exportCSV,aggregatePOS} from '../public/console/retail-ui.js';
test('CSV handles quotes commas and multiline fields without dropping zeros',()=>{assert.deepEqual(parseCSV('name,value\r\n"a,b",0\r\n"a""b\nc",2'),[['name','value'],['a,b','0'],['a"b\nc','2']]);assert.throws(()=>parseCSV('"unfinished'),/CSV/);});
test('CSV export prevents spreadsheet formulas including whitespace prefixes',()=>{const csv=exportCSV([['=SUM(A1)', ' \t+cmd', '-1', '@x','safe,quoted']]);assert.equal(csv,'"\'=SUM(A1)","\' \t+cmd","\'-1","\'@x","safe,quoted"');});
test('aggregate POS rejects personal columns and invalid counters',()=>{assert.throws(()=>aggregatePOS('email,sales\na@b,1'),/columns/i);assert.throws(()=>aggregatePOS('storeId,date,sku,units,revenue\ns1,2026-10-21,SKU,-1,2'),/units/i);});

test('POS import preserves aggregate SKU data and zero revenue',()=>{assert.deepEqual(aggregatePOS('storeId,date,sku,units,revenue\ns1,2026-10-21,SKU,2,0'),[{storeId:'s1',date:'2026-10-21',sku:'SKU',units:2,revenue:0}]);});

test('POS dates must be real calendar dates and row counts bounded',()=>{assert.throws(()=>aggregatePOS('storeId,date,sku,units,revenue\ns1,2026-02-30,SKU,1,1'),/date/i);assert.throws(()=>aggregatePOS('storeId,date,sku,units,revenue'),/rows/i);});
