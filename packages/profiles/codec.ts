// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';
import {ProfileDocumentSchema,BackupSchema,MAX_PROFILE_BYTES,MAX_BACKUP_BYTES,checkedSize,type ProfileDocument,type ProfileBackup} from './schema';
import {portablePreferences} from './preferences';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function stableJSON(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(stableJSON).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+stableJSON(v)).join(',')+'}';
 return JSON.stringify(value);
}
export async function digest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(stableJSON(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function base64url(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unbase64(value:string,limit:number){
 if(value.length>Math.ceil(limit*4/3)+4||!value||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('Invalid or oversized profile encoding');
 const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 if(bytes.length>limit||base64url(bytes)!==value)throw Error('Invalid profile encoding');return bytes;
}
async function streamBytes(stream:ReadableStream<Uint8Array>,limit:number){
 const reader=stream.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Expanded profile exceeds the supported size');parts.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result;
}
export async function profileFile(document:ProfileDocument){const data=ProfileDocumentSchema.parse(document);checkedSize(data,MAX_PROFILE_BYTES);if(data.kind==='preset'&&stableJSON(portablePreferences(data.settings,true))!==stableJSON(data.settings))throw Error('Shared preset contains computer-specific settings');return JSON.stringify({document:data,sha256:await digest(data)},null,2);}
export async function readProfileFile(text:string){
 if(encoder.encode(text).length>MAX_PROFILE_BYTES*2)throw Error('Profile file is too large');
 const envelope=z.object({document:ProfileDocumentSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(JSON.parse(text));
 checkedSize(envelope.document,MAX_PROFILE_BYTES);if(await digest(envelope.document)!==envelope.sha256)throw Error('Profile checksum does not match. Copy or export it again.');
 if(envelope.document.kind==='preset'&&stableJSON(portablePreferences(envelope.document.settings,true))!==stableJSON(envelope.document.settings))throw Error('Shared preset contains computer-specific settings');
 return envelope.document;
}
export async function shareCode(document:ProfileDocument){
 if(document.kind!=='preset')throw Error('Only shared settings can become a code');
 const file=await profileFile(document),compressed=await streamBytes(new Blob([file]).stream().pipeThrough(new CompressionStream('gzip')),MAX_PROFILE_BYTES*2);
 return 'BAMBI1.'+base64url(compressed);
}
export async function readShareCode(raw:string){
 if(raw.length>MAX_PROFILE_BYTES*3)throw Error('Setting code is too large');
 const code=raw.replace(/\s/g,'');if(!code.startsWith('BAMBI1.'))throw Error('Use a BAMBI1 setting code. A newer code may require a newer app.');
 const compressed=unbase64(code.slice(7),MAX_PROFILE_BYTES*2);
 const document=await readProfileFile(decoder.decode(await streamBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_PROFILE_BYTES*2)));
 if(document.kind!=='preset')throw Error('Only shared settings can be imported as a code');return document;
}
const encryptionSchema=z.object({format:z.literal('bambi-encrypted-backup'),version:z.literal(1),cipher:z.literal('AES-256-GCM'),kdf:z.literal('PBKDF2-SHA256'),iterations:z.literal(600000),salt:z.string().max(32),iv:z.string().max(24),data:z.string().max(Math.ceil((MAX_BACKUP_BYTES+16)*4/3))}).strict();
const aad=encoder.encode('bambi-encrypted-backup:1:AES-256-GCM:PBKDF2-SHA256:600000');
async function key(password:string,salt:Uint8Array){
 if(password.length<8||password.length>1024)throw Error('Use a backup password of 8–1024 characters.');
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(salt),iterations:600000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptBackup(raw:ProfileBackup,password:string){
 const backup=BackupSchema.parse(raw);checkedSize(backup,MAX_BACKUP_BYTES);
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),encoder.encode(JSON.stringify(backup)));
 return JSON.stringify({format:'bambi-encrypted-backup',version:1,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:600000,salt:base64url(salt),iv:base64url(iv),data:base64url(new Uint8Array(data))});
}
export async function decryptBackup(text:string,password:string){
 if(encoder.encode(text).length>MAX_BACKUP_BYTES*1.4)throw Error('Backup file is too large');
 const envelope=encryptionSchema.parse(JSON.parse(text)),salt=unbase64(envelope.salt,16),iv=unbase64(envelope.iv,12);
 if(salt.length!==16||iv.length!==12)throw Error('Invalid backup header');
 let plain:ArrayBuffer;
 try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),unbase64(envelope.data,MAX_BACKUP_BYTES+16));}catch{throw Error('Incorrect password or damaged backup. Nothing was changed.');}
 return BackupSchema.parse(JSON.parse(decoder.decode(plain)));
}
