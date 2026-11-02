import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as live from '../live-data.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.split('<script type="module">')[1].split('</script>')[0].replace(/^\s*import .*?;\s*/,'');
function context(){
 const c=vm.createContext({...live,console,Intl,Date,URL,setTimeout,clearTimeout});
 vm.runInContext(code.slice(0,code.indexOf('(function init()')),c);
 return c;
}
test('components follow runway direction and reverse head and tailwind',()=>{
 const c=context();
 const x=vm.runInContext(`S.rwy='33';JSON.stringify(judgeVals(comps(20,330)))`,c);
 assert.deepEqual(JSON.parse(x),{xw:0,hw:20,tw:0});
 const y=JSON.parse(vm.runInContext(`S.rwy='15';JSON.stringify(judgeVals(comps(20,330)))`,c));
 assert.ok(y.tw>19.99);assert.ok(y.xw<.0001);
});
test('worst tower selects a current reading ahead of a stale high wind',()=>{
 const c=context();
 assert.equal(vm.runInContext(`S.live.towers={'0511':{t:Date.now()-3600000,spd:50,dir:90},'0512':{t:Date.now(),spd:5,dir:90}};currentObs().key`,c),'0512');
});
test('page has only observation sections and no forecast request',()=>{
 assert.doesNotMatch(html,/board\.json|loadBoard|Next 7 days|Chance of violation|SLFWeather/);
 assert.match(html,/slf-winds\.json/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 const refs=[...code.matchAll(/\$\("#([^"]+)"\)/g)].map(x=>x[1]);
 const dynamic=['hcur','hhit'];
 for(const id of refs)assert.ok(ids.includes(id)||dynamic.includes(id),'Missing element '+id);
});
