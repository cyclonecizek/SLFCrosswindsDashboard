import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactSeries,dataHealth,observationFresh} from '../live-data.mjs';
const now=Date.parse('2026-11-02T19:00:00Z');
const row={t:now-60000,hgt:30,spd:0,pk:8,dir:0,pkdir:120};
test('stale, missing, future, and failed source cannot be healthy',()=>{
 const towers=Object.fromEntries(['0511','0512','0513'].map(id=>[id,row]));
 assert.equal(dataHealth(towers,'worst','ok',new Date(now).toISOString(),now).ok,true);
 assert.equal(dataHealth({...towers,'0512':{...row,t:now-6*60000}},'worst','ok',new Date(now).toISOString(),now).ok,false);
 assert.equal(dataHealth({'0511':row},'worst','ok',new Date(now).toISOString(),now).missing.length,2);
 assert.equal(dataHealth(towers,'worst','error',new Date(now).toISOString(),now).ok,false);
 assert.equal(observationFresh({...row,t:now+5*60000},'tower',now),false);
 assert.equal(observationFresh({...row,t:now-40*60000},'ktts',now),true);
});
test('history uses only exact 30 ft rows and retains calm and peak direction',()=>{
 const d=compactSeries({version:1,towers:{'0511':[row,row,{...row,hgt:6},{...row,t:now+3600000}]}},now);
 assert.equal(d.series['0511'].length,1);assert.equal(d.towers['0511'].spd,0);assert.equal(d.towers['0511'].pkdir,120);
});
