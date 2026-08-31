#!/usr/bin/env node
'use strict';
const crypto=require('node:crypto');
const minutes=Math.max(1,Math.min(1440,Number(process.argv[2])||60));
const now=Date.now();
const token=crypto.randomBytes(24).toString('base64url');
const hash=crypto.createHash('sha256').update(token).digest('hex');
const expiresAt=new Date(now+minutes*60000).toISOString();
const tokenVersion=`test-${new Date(now).toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`;
const patch={enabled:true,requireReadiness:true,readinessApproved:true,tokenSha256:hash,tokenVersion,expiresAt,maxGrantMinutes:minutes};
console.log('TCC V9 temporary device-test token');
console.log('TOKEN (share only with the test device; never commit):');
console.log(token);
console.log('\nSELF-ENROLL CONFIG PATCH (safe to version: contains hash only):');
console.log(JSON.stringify(patch,null,2));
console.log('\nAfter the test, restore enabled=false, readinessApproved=false, tokenSha256="", expiresAt=null and set access-readiness back to BLOCKED.');
