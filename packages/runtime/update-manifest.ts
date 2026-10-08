// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {createPublicKey,createHash,verify} from 'node:crypto';
import {z} from 'zod';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const payloadSchema=z.object({
 schema:z.literal(1),product:z.literal('bambi-local'),channel:z.enum(['smoke','alpha']),
 version:z.string().regex(/^0\.1\.0-(?:smoke|alpha)\.[1-9][0-9]*$/),
 target:z.enum(['linux-x64','windows-x64','macos-arm64']),applicationDigest:sha,
 issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),
 files:z.array(z.object({filename:z.string().regex(/^[a-zA-Z0-9_.-]+$/),bytes:z.number().int().positive().max(2**31-1),sha256:sha}).strict()).min(1).max(12),
}).strict();
const envelopeSchema=z.object({payload:payloadSchema,keyId:sha,signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict();
export type UpdatePayload=z.infer<typeof payloadSchema>;

/** Fixed field order; verification never depends on incoming JSON key ordering. */
export function canonicalUpdate(payload:UpdatePayload){
 const parsed=payloadSchema.parse(payload);
 return JSON.stringify({schema:parsed.schema,product:parsed.product,channel:parsed.channel,version:parsed.version,target:parsed.target,
  applicationDigest:parsed.applicationDigest,issuedAt:parsed.issuedAt,expiresAt:parsed.expiresAt,
  files:parsed.files.map(file=>({filename:file.filename,bytes:file.bytes,sha256:file.sha256}))});
}
export function updateKeyId(publicKey:string){
 const key=createPublicKey(publicKey);if(key.asymmetricKeyType!=='ed25519')throw Error('Use an Ed25519 update key.');
 return createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
}

/** Offline verification boundary; network checks/installers must opt in separately. */
export function verifyUpdateManifest(input:unknown,options:{trustedKeys:string[];target:UpdatePayload['target'];channel:UpdatePayload['channel'];currentVersion:string;now?:number}){
 const envelope=envelopeSchema.parse(input),payload=envelope.payload;
 const key=options.trustedKeys.find(key=>updateKeyId(key)===envelope.keyId);
 if(!key||!verify(null,Buffer.from(canonicalUpdate(payload)),createPublicKey(key),Buffer.from(envelope.signature,'base64')))throw Error('Update signature is not trusted.');
 if(payload.target!==options.target||payload.channel!==options.channel||!payload.version.startsWith('0.1.0-'+payload.channel+'.'))throw Error('Update target/channel mismatch.');
 const now=options.now??Date.now(),issued=Date.parse(payload.issuedAt),expires=Date.parse(payload.expiresAt);
 if(issued>now+5*60*1000||expires<=now||expires<=issued||expires-issued>31*24*60*60*1000)throw Error('Update metadata is expired or has an invalid validity interval.');
 const revision=(version:string)=>{const match=/^0\.1\.0-(smoke|alpha)\.([1-9][0-9]*)$/.exec(version);if(!match||match[1]!==payload.channel)throw Error('Unsupported installed update version.');return BigInt(match[2]);};
 if(revision(payload.version)<=revision(options.currentVersion))throw Error('Update must be newer than the installed version.');
 if(new Set(payload.files.map(file=>file.filename)).size!==payload.files.length||payload.files.some(file=>file.filename==='.'||file.filename==='..'))throw Error('Invalid update file list.');
 return payload;
}

/** Verify the received bytes without executing or installing the file. */
export async function verifyUpdateFile(path:string,file:UpdatePayload['files'][number]){
 const metadata=await lstat(path);
 if(!metadata.isFile()||metadata.size!==file.bytes)throw Error('Update file size/type mismatch.');
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(path)){bytes+=chunk.length;hash.update(chunk);if(bytes>file.bytes)throw Error('Update exceeded its signed size.');}
 if(bytes!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('Update file checksum mismatch.');
}
