const assert=require('node:assert/strict');
const shell=require('../v9-production-shell/bridge.js');

function storage(){
  const values=new Map();
  return{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
}

const w={localStorage:storage()};
assert.deepEqual(shell.selectedSubscriptions(w),[]);
assert.deepEqual(shell.saveSelectedSubscriptions(w,['fastned-gold','lidl-plus-ch','fastned-gold']),['fastned-gold','lidl-plus-ch']);
assert.deepEqual(shell.selectedSubscriptions(w),['fastned-gold','lidl-plus-ch']);
assert.equal(shell.subscriptionLabel({id:'fastned-gold',provider:'Fastned Gold',label:'fastned-gold'}),'Fastned Gold');
assert.equal(shell.subscriptionLabel({id:'emoti-member-ch',provider:'emotì member',label:'Membre emotì'}),'Membre emotì');
console.log('V9 production subscription selector state OK');
