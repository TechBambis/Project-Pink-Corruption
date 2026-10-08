// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalUpdate,updateKeyId,verifyUpdateManifest,verifyUpdateFile,type UpdatePayload} from '../packages/runtime/update-manifest';

const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({format:'pem',type:'spki'}) as string;
const now=Date.parse('2026-10-08T12:00:00Z');
const payload:UpdatePayload={schema:1,product:'bambi-local',channel:'alpha',version:'0.1.0-alpha.8',target:'windows-x64',applicationDigest:'a'.repeat(64),
 issuedAt:'2026-10-08T11:00:00Z',expiresAt:'2026-10-22T11:00:00Z',files:[{filename:'bambi-local-0.1.0-alpha.8-x64.exe',bytes:4,sha256:createHash('sha256').update('test').digest('hex')}]};
const envelope=(data:UpdatePayload=payload)=>({payload:data,keyId:updateKeyId(publicKey),signature:sign(null,Buffer.from(canonicalUpdate(data)),keys.privateKey).toString('base64')});
const options={trustedKeys:[publicKey],target:'windows-x64' as const,channel:'alpha' as const,currentVersion:'0.1.0-alpha.7',now};

test('signed update identity survives JSON field ordering and only accepts a newer matching target',()=>{
 assert.deepEqual(verifyUpdateManifest(envelope(),options),payload);
 const reordered=JSON.parse(JSON.stringify(envelope()));reordered.payload={files:reordered.payload.files,...reordered.payload};
 assert.deepEqual(verifyUpdateManifest(reordered,options),payload);
 assert.throws(()=>verifyUpdateManifest(envelope(),{...options,target:'linux-x64'}),/target\/channel/);
 assert.throws(()=>verifyUpdateManifest(envelope(),{...options,channel:'smoke'}),/target\/channel/);
 assert.throws(()=>verifyUpdateManifest(envelope(),{...options,currentVersion:payload.version}),/newer/);
 assert.throws(()=>verifyUpdateManifest(envelope(),{...options,currentVersion:'0.1.0-alpha.99'}),/newer/);
});

test('unknown keys, changed metadata, unsafe filenames and invalid signatures are rejected',()=>{
 assert.throws(()=>verifyUpdateManifest(envelope(),{...options,trustedKeys:[]}),/not trusted/);
 const changed=envelope();changed.payload={...payload,applicationDigest:'c'.repeat(64)};
 assert.throws(()=>verifyUpdateManifest(changed,options),/not trusted/);
 assert.throws(()=>verifyUpdateManifest({...envelope(),signature:'!'},options));
 assert.throws(()=>canonicalUpdate({...payload,files:[{...payload.files[0],filename:'../app.exe'}]}));
 assert.throws(()=>verifyUpdateManifest(envelope({...payload,files:[...payload.files,...payload.files]}),options),/file list/);
 assert.throws(()=>verifyUpdateManifest(envelope({...payload,files:[{...payload.files[0],filename:'..'}]}),options),/file list/);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'}) as string;
 assert.throws(()=>updateKeyId(rsa),/Ed25519/);
});

test('expired, excessive and future validity intervals cannot be accepted',()=>{
 assert.throws(()=>verifyUpdateManifest(envelope(),{...options,now:Date.parse(payload.expiresAt)}),/expired/);
 assert.throws(()=>verifyUpdateManifest(envelope({...payload,issuedAt:'2026-10-08T12:06:00Z'}),options),/validity/);
 assert.throws(()=>verifyUpdateManifest(envelope({...payload,expiresAt:'2027-01-01T00:00:00Z'}),options),/validity/);
 assert.throws(()=>verifyUpdateManifest(envelope({...payload,expiresAt:payload.issuedAt}),options),/validity/);
});

test('received update verification rejects changed bytes, incorrect sizes and symlinks',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'bambi-update-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const path=join(directory,'app.exe');writeFileSync(path,'test');await verifyUpdateFile(path,payload.files[0]);
 writeFileSync(path,'evil');await assert.rejects(verifyUpdateFile(path,payload.files[0]),/checksum/);
 writeFileSync(path,'too long');await assert.rejects(verifyUpdateFile(path,payload.files[0]),/size/);
 // Unprivileged Windows accounts may not have permission to create symlinks.
 if(process.platform!=='win32'){const link=join(directory,'link.exe');symlinkSync(path,link);await assert.rejects(verifyUpdateFile(link,payload.files[0]),/type/);}
});
