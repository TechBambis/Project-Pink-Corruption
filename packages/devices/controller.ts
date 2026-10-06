// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import dgram from 'node:dgram';
import {DeviceCommandSchema,DeviceSettingsSchema,DeviceSessionSchema,type DeviceSettings,type DeviceSession,type DeviceCommand} from './commands';
import {actuatorValue,applyDeviceCommand,offState,type ActuatorState} from './patterns';
import {sessionPhaseAt,type SessionPhase} from '../session-director/phases';
import {devicePhaseDefaults,deviceTiming} from '../../config/device-control';

export interface DeviceTransport{send(packet:string):void;close():void}
/** Only the documented local four-channel motor protocol is emitted. */
export class JoyhubUDP implements DeviceTransport{
 private socket=dgram.createSocket('udp4');private closed=false;
 constructor(private response:(status:Record<string,unknown>)=>void){
  this.socket.on('error',()=>{});
  this.socket.on('message',(bytes,peer)=>{if(peer.address!=='127.0.0.1'||peer.port!==8888||bytes.length>2048)return;try{const data=JSON.parse(bytes.toString());if(data.protocol==='bambi-joyhub/1'&&typeof data.connected==='boolean')this.response(data);}catch{}});
  this.socket.bind(0,'127.0.0.1',()=>this.socket.unref());
 }
 send(packet:string){if(!this.closed)this.socket.send(packet,8888,'127.0.0.1',()=>{});}
 close(){this.closed=true;try{this.socket.close();}catch{}}
}

export class DeviceController{
 settings:DeviceSettings=DeviceSettingsSchema.parse({});
 private owner:object|null=null;private seen=0;private session:DeviceSession={running:false,paused:false,elapsed:0,duration:1200};
 private states={vib:offState(),rot:offState()};private phase:SessionPhase|null=null;private blocked=false;
 private accent:ActuatorState|null=null;
 private nextRotation:number|null=null;private rotationEnd:number|null=null;private phaseFade=false;private manualRotation=false;private deepRotationStarted=false;
 private transport:DeviceTransport;private timer:ReturnType<typeof setInterval>|undefined;private bridgeSeen=-Infinity;private connected=false;private device='';private delivery:Record<string,unknown>={};
 private lastPacket='';private sentAt=-Infinity;private pingAt=-Infinity;private test:{channel:number;end:number;level:number;disarm?:boolean}|null=null;
 private sent=[0,0,0,0];
 private pausedAt:number|null=null;
 private pending:{command:DeviceCommand;time:number}[]=[];
 private get elapsed(){return Math.min(this.session.duration,this.session.elapsed+(this.session.running&&!this.session.paused?Math.max(0,this.now()-this.seen):0));}
 constructor(transport?:DeviceTransport,private now=()=>performance.now()/1000,private random=()=>Math.random(),autoTick=true){
  this.transport=transport??new JoyhubUDP(status=>this.bridgeStatus(status));
  if(autoTick){this.timer=setInterval(()=>this.tick(),deviceTiming.tickMs);this.timer.unref();}
 }
 bridgeStatus(status:Record<string,unknown>){this.bridgeSeen=this.now();this.delivery={error:typeof status.error==='string'?status.error.slice(0,300):'',writeCount:typeof status.writeCount==='number'?status.writeCount:0,lastNonzeroPacket:typeof status.lastNonzeroPacket==='string'?status.lastNonzeroPacket.slice(0,14):null,lastNonzeroAgeSeconds:typeof status.lastNonzeroAgeSeconds==='number'?status.lastNonzeroAgeSeconds:null};this.connected=status.connected===true;this.device=typeof status.device==='string'?status.device.slice(0,100):'';if(!this.connected)this.stop(false);}
 get status(){const bridgeAlive=this.now()-this.bridgeSeen<deviceTiming.bridgeTimeoutMs/1000;return {enabled:this.settings.enabled,automationPaused:this.settings.enabled&&(this.blocked||this.session.paused),bridge:this.settings.bridge,bridgeAvailable:bridgeAlive,connected:this.settings.bridge==='local'?bridgeAlive&&this.connected:null,device:this.device,delivery:bridgeAlive?this.delivery:null,channels:this.sent,phase:this.phase,settings:this.settings};}
 configure(owner:object,input:unknown,restart=false){const result=DeviceSettingsSchema.safeParse(input);if(!result.success)return false;if(this.owner&&this.owner!==owner)return false;
  const next=result.data;
  if(!restart&&this.owner===owner&&this.settings.enabled&&next.enabled&&(['bridge','vibrationChannel','rotationChannel','phaseDefaults','randomRotation'] as const).every(key=>this.settings[key]===next[key])){
   if((['speechAccents','accentIntensity','accentDurationMs','vibrationLeadMs','rotationLeadMs'] as const).some(key=>this.settings[key]!==next[key])){this.pending=[];this.accent=null;}
   this.settings=next;this.seen=this.now();return true;
  }
  this.stop(false);this.settings=result.data;this.owner=this.settings.enabled?owner:null;this.seen=this.now();this.blocked=false;this.phase=null;
  if(this.settings.enabled){this.transport.send('STOP');this.transport.send(JSON.stringify({status:true}));}return true;
 }
 heartbeat(owner:object,input:unknown){if(this.owner!==owner)return;const parsed=DeviceSessionSchema.safeParse(input);if(!parsed.success)return;
  this.seen=this.now();const previous=this.session;this.session=parsed.data;
  if(!this.session.running){if(previous.running)this.stop(false);this.phase=null;return;}
  if(this.session.paused){
   if(this.pausedAt===null){this.pausedAt=this.now();this.pending=[];this.accent=null;this.sent=[0,0,0,0];this.transport.send('STOP');this.transport.send('{"vibe":[0,0,0,0]}');this.lastPacket='';}
   return;
  }
  if(this.pausedAt!==null){
   const delay=this.now()-this.pausedAt;this.pausedAt=null;
   for(const state of Object.values(this.states)){state.started+=delay;if(state.expires!==undefined)state.expires+=delay;if(state.transition)state.transition.started+=delay;}
  }
  if(!previous.running){this.blocked=false;this.phase=null;}
 }
 command(owner:object,input:unknown,delayMs=0){if(this.owner!==owner||!this.settings.enabled||!Number.isFinite(delayMs)||delayMs<0||delayMs>120000)return false;const parsed=DeviceCommandSchema.safeParse(input);if(!parsed.success)return false;
  if(delayMs>0){if(!this.session.running||this.session.paused||!this.canWrite()||this.pending.length>=64)return false;this.pending.push({command:parsed.data,time:this.now()+delayMs/1000});this.pending.sort((a,b)=>a.time-b.time);return true;}
  if(parsed.data.operation==='off'&&parsed.data.channel==='both'){this.stop(false);return true;}
  if(!this.session.running||this.session.paused||!this.canWrite())return false;
  const command=parsed.data,time=this.now();this.blocked=false;this.automate();
  if(command.operation==='off'||command.operation==='fade')this.pending=this.pending.filter(cue=>cue.command.operation==='off'||cue.command.operation==='fade'&&cue.command.intensity===0||cue.command.channel!=='both'&&cue.command.channel!==command.channel&&command.channel!=='both');
  if(command.operation==='buzz'){this.accent=applyDeviceCommand(offState(time),command,time);return true;}
  for(const channel of command.channel==='both'?['vib','rot'] as const:[command.channel]){
   if(channel==='rot'&&!this.settings.rotationChannel)continue;
   const current=this.output(channel,time);
   if(channel==='vib')this.accent=null;
   this.states[channel]=applyDeviceCommand(command.operation==='fade'?{level:current,pattern:'constant',started:time}:this.states[channel],command,time,devicePhaseDefaults[sessionPhaseAt(this.elapsed,this.session.duration).phase][channel==='vib'?'vibration':'rotation']||.3);
  }
  if(command.channel==='rot'||command.channel==='both'){this.manualRotation=true;this.rotationEnd=null;this.nextRotation=null;}
  return true;
 }
 testChannel(owner:object,channel:number,intensity=.1){if(this.owner!==owner||!this.settings.enabled||!Number.isInteger(channel)||channel<1||channel>4||!Number.isFinite(intensity)||intensity<=0||intensity>.3||!this.canWrite())return false;
  const cap=this.channelCap(channel);
  this.stop(false);this.test={channel,end:this.now()+.5,level:Math.min(intensity,cap)};return true;
 }
 preview(owner:object,input:unknown,channel:number,intensity=.1){const parsed=DeviceSettingsSchema.safeParse(input);if(!parsed.success||!Number.isInteger(channel)||channel<1||channel>4||!Number.isFinite(intensity)||intensity<=0||intensity>.3||this.owner&&this.owner!==owner)return false;
  const available=parsed.data.bridge==='upstream'||this.now()-this.bridgeSeen<deviceTiming.bridgeTimeoutMs/1000&&this.connected;if(!available)return false;
  if(!this.configure(owner,{...parsed.data,enabled:true}))return false;
  if(!this.testChannel(owner,channel,intensity)){this.stop();return false;}
  this.test!.disarm=true;return true;
 }
 stop(disarm=true){this.pausedAt=null;this.pending=[];this.accent=null;this.states={vib:offState(),rot:offState()};this.nextRotation=null;this.rotationEnd=null;this.test=null;this.phaseFade=false;this.blocked=true;this.sent=[0,0,0,0];
  if(this.owner||this.settings.enabled){this.transport.send('STOP');this.transport.send('{"vibe":[0,0,0,0]}');}
  this.lastPacket='';if(disarm){this.settings={...this.settings,enabled:false};this.owner=null;this.phase=null;}
 }
 release(owner:object){if(this.owner===owner)this.stop();}
 halt(owner:object){if(this.owner===owner)this.stop(false);}
 isEnabled(owner:object){return this.owner===owner&&this.settings.enabled;}
 isPaused(owner:object){return this.owner===owner&&this.session.running&&this.session.paused;}
 /** Discard unheard narration commands while retaining the running session pattern. */
 cancelQueuedPlayback(owner:object){if(!this.isEnabled(owner)||!this.session.running)return false;this.pending=[];this.accent=null;return true;}
 private canWrite(){return this.settings.bridge==='upstream'||this.now()-this.bridgeSeen<deviceTiming.bridgeTimeoutMs/1000&&this.connected;}
 private channelCap(channel:number){return channel===this.settings.vibrationChannel?this.settings.vibrationMax:channel===this.settings.rotationChannel?this.settings.rotationMax:Math.min(this.settings.vibrationMax,this.settings.rotationMax);}
 private output(channel:'vib'|'rot',now=this.now()){
  if(this.accent&&now>=this.accent.expires!)this.accent=null;
  return Math.min(channel==='vib'?this.settings.vibrationMax:this.settings.rotationMax,actuatorValue(channel==='vib'&&this.accent?this.accent:this.states[channel],now));
 }
 private transition(channel:'vib'|'rot',state:ActuatorState){
  const from=this.output(channel);this.states[channel]={...state,...(this.settings.transitionMs?{transition:{from,seconds:this.settings.transitionMs/1000,started:this.now()}}:{})};
 }
 private applyPhase(phase:SessionPhase){const defaults=devicePhaseDefaults[phase],now=this.now();
  if(phase!=='awakening'){
   this.transition('vib',{level:defaults.vibration,pattern:defaults.vibrationPattern,started:now-(defaults.vibrationPattern==='pulse'?(this.session.tickPhaseMs??0)/1000:0),...(defaults.vibrationPattern==='pulse'&&this.session.tickBpm?{bpm:this.session.tickBpm}:{})});
   this.transition('rot',{level:phase==='deepening'?0:defaults.rotation,pattern:defaults.rotationPattern,started:now});
  }
  this.phaseFade=false;this.manualRotation=false;this.deepRotationStarted=false;this.rotationEnd=null;this.nextRotation=null;
  if(phase==='conditioning'&&this.settings.randomRotation)this.nextRotation=this.elapsed+deviceTiming.randomMinSeconds+this.random()*(deviceTiming.randomMaxSeconds-deviceTiming.randomMinSeconds);
 }
 private automate(){const {phase,progress}=sessionPhaseAt(this.elapsed,this.session.duration);
  if(phase!==this.phase){this.phase=phase;if(this.settings.phaseDefaults&&!this.blocked)this.applyPhase(phase);}
  if(!this.settings.phaseDefaults||this.blocked)return;
  if(phase==='deepening'&&progress>=.5&&!this.manualRotation&&!this.deepRotationStarted){this.deepRotationStarted=true;this.transition('rot',{level:.2,pattern:'slow',started:this.now()});}
  if(phase==='conditioning'&&!this.manualRotation&&this.settings.randomRotation&&this.settings.rotationChannel){
   if(this.rotationEnd!==null&&this.elapsed>=this.rotationEnd){this.states.rot=offState();this.rotationEnd=null;this.nextRotation=this.elapsed+deviceTiming.randomMinSeconds+this.random()*(deviceTiming.randomMaxSeconds-deviceTiming.randomMinSeconds);}
   if(this.rotationEnd===null&&this.nextRotation!==null&&this.elapsed>=this.nextRotation){this.transition('rot',{level:deviceTiming.randomRotationIntensity,pattern:'slow',started:this.now()});this.rotationEnd=this.elapsed+deviceTiming.rotationMinSeconds+this.random()*(deviceTiming.rotationMaxSeconds-deviceTiming.rotationMinSeconds);}
  }
  if(phase==='awakening'&&!this.phaseFade){const seconds=Math.min(deviceTiming.awakeningFadeSeconds,Math.max(.1,this.session.duration-this.elapsed));this.phaseFade=true;
   const now=this.now();
   for(const channel of ['vib','rot'] as const)this.states[channel]=applyDeviceCommand({level:this.output(channel,now),pattern:'constant',started:now},{type:'device',channel,operation:'fade',intensity:0,durationMs:Math.round(seconds*1000)},now);
   this.accent=null;this.pending=[];
  }
 }
 tick(){const now=this.now();
  // Polling does not actuate anything and lets the UI distinguish missing BLE from UDP delivery.
  if(now-this.pingAt>=1){this.pingAt=now;this.transport.send('{"status":true}');}
  if(!this.owner||!this.settings.enabled)return;
  if(now-this.seen>deviceTiming.heartbeatTimeoutMs/1000){this.stop();return;}
  if(!this.canWrite()){if(!this.blocked||this.test||this.pending.length)this.stop(false);return;}
  if(this.session.running&&!this.session.paused&&this.elapsed>=this.session.duration){this.stop();return;}
  while(this.pending.length&&this.pending[0].time<=now){const cue=this.pending.shift()!;if(now-cue.time<=.15||cue.command.operation==='off'||cue.command.operation==='fade')this.command(this.owner,cue.command);}
  const channels=[0,0,0,0];
  if(this.test){if(now>=this.test.end){const disarm=this.test.disarm;this.test=null;this.stop(disarm===true);}else channels[this.test.channel-1]=Math.round(Math.min(this.test.level,this.channelCap(this.test.channel))*100);}
  else if(this.session.running&&!this.session.paused){this.automate();channels[this.settings.vibrationChannel-1]=Math.round(this.output('vib',now)*100);if(this.settings.rotationChannel)channels[this.settings.rotationChannel-1]=Math.round(this.output('rot',now)*100);}
  this.sent=channels;const packet=JSON.stringify({vibe:channels});
  if(packet!==this.lastPacket||now-this.sentAt>.3){this.lastPacket=packet;this.sentAt=now;this.transport.send(packet);}
 }
 close(){this.stop();if(this.timer)clearInterval(this.timer);this.transport.close();}
}
