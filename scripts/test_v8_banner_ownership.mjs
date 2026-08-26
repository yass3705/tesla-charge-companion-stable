import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const assetsDir='assets';
const allowed=new Set(['preview-storage.js','v8-preview-cache-guard.js']);
const offenders=[];
for(const name of fs.readdirSync(assetsDir)){
  if(!name.endsWith('.js')||allowed.has(name))continue;
  const file=path.join(assetsDir,name);
  const text=fs.readFileSync(file,'utf8');
  if(text.includes('tccPreviewBanner'))offenders.push(name);
}
assert.deepEqual(offenders,[],`Only the preview/build layer may mutate #tccPreviewBanner. Offenders: ${offenders.join(', ')}`);
console.log('V8 preview banner ownership OK.');
