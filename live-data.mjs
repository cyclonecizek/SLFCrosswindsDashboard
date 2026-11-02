export const TOWER_IDS = ['0511','0512','0513'];
export const TOWER_MAX_AGE = 15 * 60000;
export function observationFresh(row, kind='tower', now=Date.now()) {
  const age=now-row?.t;
  return Number.isFinite(age) && age>=-120000 && age<=TOWER_MAX_AGE;
}
export function dataHealth(towers, selected, sourceStatus, generatedAt, now=Date.now()) {
  const ids=selected==='worst'?TOWER_IDS:[selected];
  const missing=ids.filter(id=>!observationFresh(towers[id], 'tower', now));
  const age=now-Date.parse(generatedAt);
  const sourceBad=sourceStatus!=='ok'||!Number.isFinite(age)||age>TOWER_MAX_AGE||age < -120000;
  return {ok:!missing.length&&!sourceBad,missing,sourceBad};
}
export function compactSeries(data, now=Date.now()) {
  if(data?.version!==1||!data.towers)throw Error('Unexpected SLF history response');
  const clean=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<999?v:null;
  const series={},towers={};
  for(const id of TOWER_IDS){
    const by=new Map();
    for(const row of data.towers[id]||[]){
      if(row.hgt!==30||!Number.isFinite(row.t)||row.t<now-24*3600000||row.t>now+120000)continue;
      const r={id,t:row.t,hgt:30,spd:clean(row.spd),pk:clean(row.pk),dir:clean(row.dir),pkdir:clean(row.pkdir)};
      if(r.spd!==null||r.pk!==null)by.set(r.t,r);
    }
    series[id]=[...by.values()].sort((a,b)=>a.t-b.t);
    if(series[id].length)towers[id]=series[id].at(-1);
  }
  if(!Object.keys(towers).length)throw Error('No 30 ft SLF wind observations');
  return {series,towers,sourceStatus:data.source_status,generatedAt:data.generated_at};
}
