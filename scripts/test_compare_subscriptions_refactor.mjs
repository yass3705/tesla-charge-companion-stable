import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const compact=read('assets/v8-compare-subscriptions.js');
const stability=read('assets/v8-subscription-stability-fix.js');
const hotfix=read('assets/v8-rc48bn-runtime-hotfix.js');
const update=read('assets/update.js');

const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};

assert(compact.includes("v8SubscriptionsCompactBox"),'compact subscription box missing');
assert(compact.includes("document.createElement('details')"),'subscriptions are not rendered as a collapsible details element');
assert(compact.includes("#v8SubscriptionsBox,#v8SubscriptionsStableBox,#v8SubscriptionsHotfixBox"),'legacy subscription UIs are not hidden');
assert(compact.includes("data-subscription-compact"),'compact checkbox controls missing');
assert(compact.includes("await window.TCCV8Subscriptions.loadPlans()"),'compact UI must explicitly await the complete upstream subscription catalogue');
assert(compact.includes("hasExternalPlan"),'compact UI must distinguish builtin-only bootstrap state from a complete catalogue');
assert(compact.includes("rc48bt-subscriptions-20260825"),'compact UI must have a no-store full-catalogue fallback');
assert(!compact.includes('setInterval('),'compact UI must not use a permanent interval');
assert(!stability.includes('MutationObserver('),'legacy stability bridge must not observe the whole DOM anymore');
assert(!stability.includes('setInterval('),'legacy stability bridge must not poll');
assert(!hotfix.includes('v8SubscriptionsHotfixBox'),'runtime hotfix still owns a duplicate subscription UI');
assert(!hotfix.includes('setInterval('),'runtime hotfix must not poll');
assert(update.includes('v8-compare-subscriptions.js?v=rc48bt-20260825'),'update loader does not load the corrected compact subscription UI');

console.log('Compare subscription refactor OK: one compact collapsible UI, complete catalogue loading, no duplicate polling layers.');
