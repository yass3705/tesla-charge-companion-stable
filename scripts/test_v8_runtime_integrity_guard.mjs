import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const calls=[];
globalThis.window=globalThis;
globalThis.location={
  pathname:'/tesla-charge-companion-stable/v8-preview/index.html',
  href:'https://example.test/tesla-charge-companion-stable/v8-preview/index.html',
  origin:'https://example.test'
};
globalThis.fetch=async(input,init)=>{calls.push({input:String(input),init});return{ok:true}};
globalThis.document={dispatchEvent(){}};
globalThis.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}};

const source=fs.readFileSync(new URL('../assets/v8-runtime-integrity-guard.js',import.meta.url),'utf8');
vm.runInThisContext(source,{filename:'v8-runtime-integrity-guard.js'});
const G=globalThis.TCCV8RuntimeIntegrity;
assert.ok(G,'runtime integrity API missing');
assert.equal(G.previewActive,true);
assert.equal(G.repoRoot,'/tesla-charge-companion-stable/');
assert.equal(G.previewRoot,'/tesla-charge-companion-stable/v8-preview/');

const escaped=G.rewriteUrl('../data/powerdot_direct_france.json.gz');
assert.equal(escaped.pathname,'/tesla-charge-companion-stable/v8-preview/data/powerdot_direct_france.json.gz');
const alreadyLocal=G.rewriteUrl('data/etotem_direct_tariffs_france.json.gz');
assert.equal(alreadyLocal.pathname,'/tesla-charge-companion-stable/v8-preview/data/etotem_direct_tariffs_france.json.gz');
const external=G.rewriteUrl('https://operator.example/data/catalog.json');
assert.equal(external.href,'https://operator.example/data/catalog.json');

await globalThis.fetch('../data/powerdot_direct_france.json.gz',{cache:'no-store'});
assert.equal(calls.at(-1).input,'https://example.test/tesla-charge-companion-stable/v8-preview/data/powerdot_direct_france.json.gz');
await globalThis.fetch('https://operator.example/data/catalog.json');
assert.equal(calls.at(-1).input,'https://operator.example/data/catalog.json');
assert.equal(G.diagnostics.length,2,'one explicit rewrite + one fetch rewrite expected');

console.log('V8 runtime integrity guard OK: preview data stays preview-local; cross-origin APIs untouched.');
