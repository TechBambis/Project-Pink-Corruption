// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {createHash} from 'node:crypto';
import {copyFileSync,createReadStream,createWriteStream,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),model=JSON.parse(readFileSync(resolve(root,'config/memory-model.json'),'utf8'));
if(process.argv.includes('--help')){console.log('Usage: npm run setup:memory\nDownload and verify the pinned multilingual CPU embedding model.\nRuntime loads local files only; no conversation text is sent to the model host.');process.exit(0);}
const target=resolve(root,'.runtime/memory-models',model.model);mkdirSync(target,{recursive:true});rmSync(resolve(target,'READY.json'),{force:true});
async function matches(path,file){if(!existsSync(path))return false;const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(path)){size+=chunk.length;hash.update(chunk);}return size===file.bytes&&hash.digest('hex')===file.sha256;}
for(const file of model.files){
 const destination=resolve(target,file.path);if(await matches(destination,file)){console.log('Verified '+file.path);continue;}
 mkdirSync(dirname(destination),{recursive:true});const temporary=destination+'.partial';
 try{
  const response=await fetch(`https://huggingface.co/${model.model}/resolve/${model.revision}/${file.path}`,{signal:AbortSignal.timeout(300000)});if(!response.ok||!response.body)throw Error('Model download HTTP '+response.status);
  const hash=createHash('sha256');let bytes=0;const verify=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>file.bytes){callback(Error('Model exceeds its pinned size'));return;}hash.update(chunk);callback(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),verify,createWriteStream(temporary));
  if(bytes!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('Model checksum mismatch: '+file.path);
  renameSync(temporary,destination);console.log('Installed '+file.path);
 }finally{rmSync(temporary,{force:true});}
}
const sourceURL=`https://huggingface.co/${model.source}/resolve/${model.sourceRevision}/README.md`;
const source=await fetch(sourceURL,{signal:AbortSignal.timeout(30000)});if(!source.ok)throw Error('Source attribution download failed');
writeFileSync(resolve(target,'SOURCE_CARD.md'),await source.text());
if(model.license==='apache-2.0')copyFileSync(resolve(root,'docs/licenses/KOKORO-APACHE-2.0.txt'),resolve(target,'LICENSE'));
writeFileSync(resolve(target,'PROVENANCE.json'),JSON.stringify(model,null,2)+'\n');
writeFileSync(resolve(target,'READY.json'),JSON.stringify({model:model.model,revision:model.revision,installed:new Date().toISOString()})+'\n');
console.log('Local multilingual memory ready. Restart the app to load the new retrieval code.');
