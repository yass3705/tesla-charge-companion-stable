const assert=require('assert');
const https=require('https');
const adapter=require('../assets/v9/adapters/morocco-nonproduction.js');

const URL='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/morocco/shell-vivo/al-jazira-evidence-2026-08-30.json';

function getJson(url){
  return new Promise((resolve,reject)=>{
    https.get(url,{headers:{'User-Agent':'TeslaChargeCompanionV9ReadOnlyGuard/1.0','Accept':'application/json'}},res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',d=>{body+=d;if(body.length>250000){res.destroy();reject(new Error('response too large'));}});
      res.on('end',()=>{
        if(res.statusCode!==200)return reject(new Error(`HTTP ${res.statusCode}`));
        try{resolve(JSON.parse(body));}catch(e){reject(e);}
      });
    }).on('error',reject);
  });
}

(async()=>{
  const report=await getJson(URL);
  assert.equal(report.country,'MA');
  assert.equal(report.station?.site_brand,'Shell');
  assert.equal(report.station?.network_brand,'Shell Recharge');
  assert.equal(report.station?.operator_cpo,null,'public evidence must not assert a technical CPO');
  assert.equal(report.station?.tariff_channel,null,'secondary free evidence must not become a direct tariff');
  assert.equal(report.station?.status_source,null,'no native live status source is validated');
  assert.equal(report.production_recommendation?.production_ready_as_cpo_station,false);

  const row=adapter.shellVivoDiagnostic(report);
  assert.equal(row.countryCode,'MA');
  assert.equal(row.name,'Shell Al Jazira');
  assert.equal(row.latitude,33.779558);
  assert.equal(row.longitude,-7.232679);
  assert.equal(row.physicalOperator,null,'Shell/Vivo diagnostic must not invent CPO attribution');
  assert.equal(row.access?.siteBrand,'Shell');
  assert.equal(row.access?.accessNetwork,'Shell Recharge');
  assert.deepEqual(row.offers,[],'no unvalidated direct/free offer may enter V9');
  assert.equal(row.status?.state,'unknown');
  assert.equal(row.status?.statusSource,null);
  assert.equal(row.productionEligible,false);
  assert.equal(row.diagnosticOnly,true);

  console.log(JSON.stringify({ok:true,name:row.name,diagnosticOnly:row.diagnosticOnly,productionEligible:row.productionEligible,siteBrand:row.access.siteBrand,accessNetwork:row.access.accessNetwork,physicalOperator:row.physicalOperator,offers:row.offers.length,status:row.status.state},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
