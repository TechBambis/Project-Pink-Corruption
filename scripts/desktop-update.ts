// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {generateKeyPairSync,createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,statSync,createReadStream} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalUpdate,updateKeyId,type UpdatePayload} from '../packages/runtime/update-manifest';
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

const [command,requested,keyPath,...extra]=process.argv.slice(2);
const project=resolve(fileURLToPath(new URL('../',import.meta.url)));
if(command==='--help'){console.log('node --import tsx scripts/desktop-update.ts create-key OUTSIDE_DIRECTORY | sign PACKAGE_DIRECTORY PRIVATE_KEY');process.exit(0);}
if(extra.length||!requested)throw Error('Supply create-key or sign and the required paths.');
const directory=resolve(requested);
if(command==='create-key'){
 const local=relative(project,directory);
 if(keyPath||local===''||!local.startsWith('..')&&!isAbsolute(local)||existsSync(directory))throw Error('Choose a fresh private directory outside the source tree.');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const keys=generateKeyPairSync('ed25519');
 writeFileSync(join(directory,'update-private.pem'),keys.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 const publicKey=keys.publicKey.export({type:'spki',format:'pem'}) as string;
 writeFileSync(join(directory,'update-public.pem'),publicKey,{flag:'wx',mode:0o644});
 console.log('Created update keys outside the repository. Public key ID: '+updateKeyId(publicKey));
}else if(command==='sign'&&keyPath){
 const runtime=JSON.parse(readFileSync(join(directory,'RUNTIME-MANIFEST.json'),'utf8'));
 if(!runtime.release?.applicationDigest)throw Error('Build through the shared source/release pipeline first.');
 if(runtime.architecture!=='x64'||!['linux','win32'].includes(runtime.platform))throw Error('Update signing currently supports Linux/Windows x64 only.');
 const target=(runtime.platform==='win32'?'windows':runtime.platform==='darwin'?'macos':runtime.platform)+'-'+runtime.architecture;
 const filename=runtime.platform==='win32'?`bambi-local-${runtime.version}-x64.exe`:`bambi-local-${runtime.version}-x86_64.AppImage`;
 const key=createPrivateKey(readFileSync(resolve(keyPath)));if(key.asymmetricKeyType!=='ed25519')throw Error('Use an Ed25519 key.');
 const publicKey=createPublicKey(key).export({type:'spki',format:'pem'}) as string;
 const issuedAt=new Date(),expiresAt=new Date(issuedAt.getTime()+14*24*60*60*1000);
 const payload={schema:1,product:'bambi-local',channel:runtime.phase??(runtime.version.includes('-alpha.')?'alpha':'smoke'),version:runtime.version,target,
  applicationDigest:runtime.release.applicationDigest,issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString(),
  files:[{filename,bytes:statSync(join(directory,filename)).size,sha256:await hashFile(join(directory,filename))}]} as UpdatePayload;
 const canonical=canonicalUpdate(payload);
 writeFileSync(join(directory,'SIGNED-UPDATE.json'),JSON.stringify({payload:JSON.parse(canonical),keyId:updateKeyId(publicKey),signature:sign(null,Buffer.from(canonical),key).toString('base64')},null,2)+'\n',{flag:'wx'});
 console.log('Signed update metadata locally; no upload or installation performed.');
}else throw Error('Use create-key OUTSIDE_DIRECTORY or sign PACKAGE_DIRECTORY PRIVATE_KEY.');
