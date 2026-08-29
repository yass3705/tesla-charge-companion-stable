const fs=require('fs');
const zlib=require('zlib');
const path=require('path');
const assert=require('assert');

const root=path.resolve(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/netherlands_direct_tariffs_v1.json'),'utf8'));
const api=require(path.join(root,'assets/v8-netherlands-tariffs.js'));

function byId(list,id){const x=list.find(v=>v.id===id);assert(x,`offre manquante: ${id}`);return x;}
assert.strictEqual(data.country,'NL');
assert.strictEqual(byId(data.directOffers,'fastned-direct-nl').pricePerKwh,0.77);
assert.strictEqual(byId(data.directOffers,'ionity-direct-nl').pricePerKwh,0.76);
assert.strictEqual(byId(data.directOffers,'ionity-go-nl').pricePerKwh,0.72);
assert.strictEqual(byId(data.directOffers,'lidl-direct-ac-nl').pricePerKwh,0.55);
assert.strictEqual(byId(data.directOffers,'lidl-direct-dc-nl').pricePerKwh,0.60);
assert.strictEqual(byId(data.directOffers,'lidl-plus-ac-nl').pricePerKwh,0.49);
assert.strictEqual(byId(data.directOffers,'lidl-plus-dc-nl').pricePerKwh,0.55);
assert.strictEqual(byId(data.subscriptionOffers,'fastned-gold').pricePerKwh,0.54);
assert.strictEqual(byId(data.subscriptionOffers,'ionity-motion-nl').pricePerKwh,0.54);
assert.strictEqual(byId(data.subscriptionOffers,'ionity-power-nl').pricePerKwh,0.43);
assert(api.isNetherlandsCard({dataset:{resultId:'netherlands-catalog:NL:ALL:ABC'}}));
assert(!api.isNetherlandsCard({dataset:{resultId:'france-catalog:FR:ABC'}}));
assert(api.offerMatches({operator:'Fastned',kind:'DC',power:300},byId(data.directOffers,'fastned-direct-nl')));
assert(api.offerMatches({operator:'IONITY',kind:'DC',power:350},byId(data.directOffers,'ionity-direct-nl')));
assert(!api.offerMatches({operator:'IONITY',kind:'AC',power:22},byId(data.directOffers,'ionity-direct-nl')));
assert(Math.abs(api.rowTotal(42.5,byId(data.subscriptionOffers,'fastned-gold'))-22.95)<1e-9);

const runtimePath=path.join(root,'data/non_tesla_netherlands/all.json.gz');
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(runtimePath)).toString('utf8'));
assert(rows.length>70000,`runtime NL trop petit: ${rows.length}`);
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const stats={fastned:0,ionity:0,lidlOperator:0,lidlName:0,tesla:0};
const samples={fastned:null,ionity:null,lidlOperator:null,lidlName:null};
for(const row of rows){
  const op=norm(row[5]),name=norm(row[1]);
  if(op.includes('fastned')){stats.fastned++;samples.fastned??={id:row[0],name:row[1],operator:row[5],configs:row[8]?.length||0};}
  if(op.includes('ionity')){stats.ionity++;samples.ionity??={id:row[0],name:row[1],operator:row[5],configs:row[8]?.length||0};}
  if(op.includes('lidl')){stats.lidlOperator++;samples.lidlOperator??={id:row[0],name:row[1],operator:row[5],configs:row[8]?.length||0};}
  if(name.includes('lidl')){stats.lidlName++;samples.lidlName??={id:row[0],name:row[1],operator:row[5],configs:row[8]?.length||0};}
  if(op.includes('tesla')||String(row[0]).includes(':TSL:'))stats.tesla++;
}
assert(stats.fastned>50,`Fastned opérateur inattendu: ${stats.fastned}`);
assert(stats.ionity>10,`IONITY opérateur inattendu: ${stats.ionity}`);
assert.strictEqual(stats.tesla,0,'Tesla ne doit pas être dans le catalogue DOT-NL');

function firstEnergyPrice(sample){
  if(!sample)return null;const row=rows.find(r=>r[0]===sample.id);if(!row)return null;
  for(const cfg of row[8]||[])for(const rule of cfg[5]||[]){const p=Number(rule?.[5]);if(p>0)return p;}
  return null;
}
const report={stations:rows.length,stats,samples,dotNlSampleEnergyPrice:{fastned:firstEnergyPrice(samples.fastned),ionity:firstEnergyPrice(samples.ionity)},overlay:{fastnedDirect:0.77,fastnedGold:0.54,ionityDirect:0.76,ionityGo:0.72,ionityMotion:0.54,ionityPower:0.43,lidlDirectAC:0.55,lidlDirectDC:0.60,lidlPlusAC:0.49,lidlPlusDC:0.55}};
console.log(JSON.stringify(report,null,2));
console.log('Netherlands V8 tariff overlay tests: OK');
