// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface SpeechSocket {
 readyState:number;bufferedAmount:number;
 send(data:string|ArrayBufferView):void;close():void;
 onmessage:((event:MessageEvent)=>void)|null;onclose:((event:CloseEvent)=>void)|null;onerror:((event:Event)=>void)|null;
}
interface Segment {id:string;epoch:number;ending:boolean;endedAt:number;fallback:(()=>void)|null;timer:ReturnType<typeof setTimeout>|null;finishedAt:number}
/** Partial hypotheses stay transient. Only one explicit final can commit an utterance. */
export class StreamingSpeech {
 private socket:SpeechSocket|null=null;private ready=false;private ring:Float32Array[]=[];
 private segment:Segment|null=null;private inFlightBytes=0;
 private cancelConnect:(()=>void)|null=null;
 get pending(){return !!this.segment?.ending;}
 constructor(private hooks:{partial:(text:string,epoch:number)=>void;final:(text:string,endedAt:number,latencyMs:number,epoch:number)=>void;changed:()=>void;failed:(error:unknown)=>void},private now=()=>performance.now()){}
 connect(socket:SpeechSocket){
  this.close();this.socket=socket;
  return new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('Streaming speech took too long to load.'));if(this.socket===socket)this.close();},16000);
   this.cancelConnect=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
   const fail=()=>{clearTimeout(timer);reject(Error('Local streaming speech is unavailable.'));if(this.socket===socket){this.ready=false;this.fallback();this.socket=null;socket.close();}};
   socket.onclose=fail;socket.onerror=fail;
   socket.onmessage=({data})=>{
    if(this.socket!==socket)return;
    try{
     const message=JSON.parse(String(data));
     if(message.type==='ready'){clearTimeout(timer);this.cancelConnect=null;this.ready=true;resolve();return;}
     if(message.type==='error'){fail();return;}
     const current=this.segment;if(!current||message.id!==current.id)return;
     if(message.type==='ack'){
      if(!Number.isInteger(message.bytes)||message.bytes<4||message.bytes>16384)throw Error('Invalid speech acknowledgement');
      this.inFlightBytes=Math.max(0,this.inFlightBytes-message.bytes);return;
     }
     if(!['partial','final'].includes(message.type)||typeof message.text!=='string'||message.text.length>4000)throw Error('Invalid speech result');
     if(message.type==='partial'){if(!current.ending)this.hooks.partial(message.text,current.epoch);return;}
     if(!current.ending)throw Error('Speech ended before input completion');
     if(current.timer)clearTimeout(current.timer);this.segment=null;this.inFlightBytes=0;
     this.hooks.final(message.text,current.endedAt,Math.max(0,this.now()-current.finishedAt),current.epoch);this.hooks.changed();
    }catch(error){this.hooks.failed(error);fail();}
   };
  });
 }
 private send(message:unknown){this.socket?.send(JSON.stringify(message));}
 private audio(pcm:Float32Array){
  if(!this.ready||!this.socket||this.socket.readyState!==1||this.inFlightBytes+pcm.byteLength>65536||this.socket.bufferedAmount>65536){this.fallback();this.close();return;}
  this.inFlightBytes+=pcm.byteLength;this.socket.send(pcm);
 }
 frame(pcm:Float32Array){
  if(this.segment&&!this.segment.ending){this.audio(pcm);return;}
  this.ring.push(pcm);if(this.ring.length>28)this.ring.shift();
 }
 begin(epoch:number){
  const onset=this.ring;
  if(this.segment){if(this.segment.epoch===epoch&&this.segment.ending)this.fallback();else this.reset();}
  if(!this.ready)return;
  this.segment={id:crypto.randomUUID(),epoch,ending:false,endedAt:0,fallback:null,timer:null,finishedAt:0};
  this.send({type:'start',id:this.segment.id});
  this.ring=[];for(const pcm of onset)this.audio(pcm);
 }
 finish(endedAt:number,epoch:number,fallback:()=>void){
  this.ring=[];
  const segment=this.segment;
  if(!segment||segment.epoch!==epoch||!this.ready){this.reset();return false;}
  segment.ending=true;segment.endedAt=endedAt;segment.fallback=fallback;segment.finishedAt=this.now();
  this.send({type:'finish',id:segment.id});segment.timer=setTimeout(()=>this.fallback(),6000);this.hooks.changed();return true;
 }
 private fallback(){const segment=this.segment;this.reset();segment?.fallback?.();this.hooks.changed();}
 reset(){
  if(this.segment?.timer)clearTimeout(this.segment.timer);
  if(this.segment&&this.ready&&this.socket?.readyState===1)this.send({type:'reset'});
  this.segment=null;this.ring=[];this.inFlightBytes=0;
 }
 close(){this.cancelConnect?.();this.cancelConnect=null;this.reset();this.ready=false;const socket=this.socket;this.socket=null;if(socket){socket.onmessage=null;socket.onclose=null;socket.onerror=null;socket.close();}}
}
