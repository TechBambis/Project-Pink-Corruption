// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync,readFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {WebSocket} from 'ws';
import {z} from 'zod';
import {desktopAlpha,resourcePath} from '../../runtime/paths';
import {speechExecutable} from '../../runtime/executables';

const control=z.discriminatedUnion('type',[
 z.object({type:z.literal('start'),id:z.string().uuid()}).strict(),
 z.object({type:z.literal('finish'),id:z.string().uuid()}).strict(),
 z.object({type:z.literal('reset')}).strict(),
]);
const result=z.discriminatedUnion('type',[
 z.object({type:z.literal('ready')}),
 z.object({type:z.literal('partial'),id:z.string().uuid(),text:z.string().max(4000)}),
 z.object({type:z.literal('final'),id:z.string().uuid(),text:z.string().max(4000)}),
 z.object({type:z.literal('ack'),id:z.string().uuid(),bytes:z.number().int().min(4).max(16384)}),
 z.object({type:z.literal('error'),message:z.string().max(300)}),
]);

/** One resident CPU process, one microphone owner. No public service port or model downloads. */
export class StreamingSpeechService {
 private installed=false;
 get available(){if(!desktopAlpha)return this.installed;try{const manifest=JSON.parse(readFileSync(resourcePath('config/streaming-speech-model.json'),'utf8'));return manifest.files.every((file:{path:string;bytes:number})=>statSync(resolve(process.env.BAMBI_MODELS_ROOT!,'streaming',file.path)).size===file.bytes);}catch{return false;}}
 private child:ChildProcessWithoutNullStreams|null=null;private client:WebSocket|null=null;
 private ready=false;private current:string|null=null;private finishing=false;private samples=0;
 private deadline:ReturnType<typeof setTimeout>|null=null;private idle:ReturnType<typeof setTimeout>|null=null;
 constructor(private options:{root?:string;launch?:()=>ChildProcessWithoutNullStreams}={}){
  const root=options.root??process.cwd();
  try{
   const manifest=JSON.parse(readFileSync(resolve(root,'config/streaming-speech-model.json'),'utf8'));
   this.installed=!!options.launch||(existsSync(resolve(root,'.runtime/streaming-stt-venv/bin/python'))&&manifest.files.every((file:{path:string;bytes:number})=>statSync(resolve(root,'.runtime/streaming-speech/model',file.path)).size===file.bytes));
  }catch{this.installed=!!options.launch;}
 }
 private send(message:unknown){if(this.client?.readyState===WebSocket.OPEN)this.client.send(JSON.stringify(message));}
 private clearDeadline(){if(this.deadline)clearTimeout(this.deadline);this.deadline=null;}
 private command(message:unknown){
  if(!this.child||this.child.stdin.destroyed||this.child.stdin.writableLength>128*1024)throw Error('Speech recognition is overloaded.');
  this.child.stdin.write(JSON.stringify(message)+'\n');
 }
 private fail(message=desktopAlpha?'Local streaming speech is unavailable. Retry Setup or use text.':'Local streaming speech is unavailable. Whisper can still be used.'){
  this.send({type:'error',message});this.client?.close(1011,'Streaming speech unavailable');this.client=null;this.closeWorker();
 }
 private closeWorker(){this.clearDeadline();if(this.idle)clearTimeout(this.idle);this.idle=null;const child=this.child;this.child=null;this.ready=false;this.current=null;this.finishing=false;child?.stdin.end();child?.kill();}
 private startWorker(){
  if(this.child)return;
  const root=this.options.root??process.cwd();
  const launch=()=>{
   if(desktopAlpha)return spawn(speechExecutable(),['streaming'],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
   // Resolve directory symlinks while retaining the virtual environment's interpreter path.
   // A sandbox-private fixture cwd must never be passed to the host process launcher.
   const python=resolve(realpathSync(resolve(root,'.runtime/streaming-stt-venv')),'bin/python');
   const script=realpathSync(resolve(root,'packages/speech/streaming/worker.py')),cwd=dirname(script),args=['-I','-u',script];
   return existsSync('/.flatpak-info')
    ?spawn('/usr/bin/flatpak-spawn',['--host','--watch-bus','--directory='+cwd,python,...args],{stdio:['pipe','pipe','pipe']})
    :spawn(python,args,{cwd,stdio:['pipe','pipe','pipe']});
  };
  const child=this.options.launch?.()??launch();
  this.child=child;let buffer='';child.stderr.resume();
  child.stdin.on('error',()=>{if(this.child===child)this.fail();});
  child.on('error',()=>{if(this.child===child)this.fail();});
  child.on('exit',()=>{if(this.child===child)this.fail();});
  child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
   if(this.child!==child)return;buffer+=chunk;
   if(buffer.length>32768){this.fail();return;}
   let newline:number;
   while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    try{
     const message=result.parse(JSON.parse(line));
     if(message.type==='error'){this.fail();return;}
     if(message.type==='ready'){this.ready=true;this.clearDeadline();this.send({type:'ready',provider:'sherpa-onnx'});continue;}
     if(message.id!==this.current)continue;
     this.send(message);
     if(message.type==='final'){this.clearDeadline();this.current=null;this.finishing=false;}
    }catch{this.fail();return;}
   }
  });
  this.deadline=setTimeout(()=>this.fail('Local streaming speech took too long to load.'),15000);
 }
 attach(socket:WebSocket){
  if(!this.available||this.client){socket.send(JSON.stringify({type:'error',message:this.available?'Another microphone is using streaming speech.':'Streaming speech is not installed.'}));socket.close(1013);return;}
  this.client=socket;if(this.idle)clearTimeout(this.idle);this.idle=null;
  socket.on('error',()=>socket.terminate());
  socket.on('close',()=>{
   if(this.client!==socket)return;this.client=null;this.current=null;this.finishing=false;
   // Keep the model resident briefly for a rapid mute/unmute, then release CPU memory.
   if(this.ready){this.clearDeadline();try{this.command({type:'reset'});}catch{this.closeWorker();}}
   if(this.child)this.idle=setTimeout(()=>this.closeWorker(),60000);this.idle?.unref();
  });
  socket.on('message',(raw,binary)=>{
   if(this.client!==socket)return;
   try{
    if(!this.ready)throw Error('Recognition is not ready.');
    if(binary){
     if(!this.current||this.finishing||!Buffer.isBuffer(raw)||!raw.length||raw.length%4||raw.length>16384)throw Error('Invalid PCM frame.');
     this.samples+=raw.length/4;if(this.samples>16000*27)throw Error('Utterance is too long.');
     this.command({type:'audio',id:this.current,pcm:raw.toString('base64')});
    }else{
     const message=control.parse(JSON.parse(raw.toString()));
     if(message.type==='reset'){this.current=null;this.finishing=false;this.clearDeadline();this.command(message);return;}
     if(message.type==='start'){
      if(this.current)throw Error('An utterance is already active.');
      this.current=message.id;this.finishing=false;this.samples=0;this.deadline=setTimeout(()=>this.fail('Speech input exceeded its time limit.'),30000);
     }else{
      if(message.id!==this.current||this.finishing)throw Error('Invalid utterance completion.');
      this.finishing=true;this.clearDeadline();this.deadline=setTimeout(()=>this.fail('Speech recognition took too long to finish.'),5000);
     }
     this.command(message);
    }
   }catch{this.fail('Streaming speech could not accept this input. Retry the microphone or use Whisper.');}
  });
  if(this.ready)this.send({type:'ready',provider:'sherpa-onnx'});else try{this.startWorker();}catch{this.fail();}
 }
 close(){this.client?.close(1001,'Speech stopped');this.client=null;this.closeWorker();}
}
