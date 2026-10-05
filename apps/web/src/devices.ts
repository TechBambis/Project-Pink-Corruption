// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {AudioEngine} from '../../../packages/audio';
import {DeviceSettingsSchema,type DeviceSettings} from '../../../packages/devices/commands';

export const devicePreferenceIds=['device-bridge','device-address','device-write-char','device-auto-connect','device-vib-channel','device-rot-channel','device-vib-max','device-rot-max','device-phase-defaults','device-random-rotation'];
export const deviceBooleanPreferenceIds=['device-auto-connect','device-phase-defaults','device-random-rotation'];
export function initDeviceControls(send:(message:unknown)=>void,audio:()=>AudioEngine|null,session:()=>{running:boolean;paused:boolean;elapsed:number;duration:number},engineEvents:()=>boolean=()=>false){
 const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 const value=(id:string)=>element<HTMLInputElement>(id).value;
 let configuredEventMode=false;
 let enabled=false,lastBeat=-Infinity,lastPoll=-Infinity,lastStatus:any={};
 const bindAudio=()=>{const engine=audio();if(engine)engine.onDeviceCue=(command,time)=>{const state=session();if(!enabled||!state.running||state.paused)return;send({type:'device-session',session:state});send({type:'device-command',command,delayMs:time===undefined?0:engine.outputDelayMs(time)});};};
 const settings=():DeviceSettings=>DeviceSettingsSchema.parse({enabled,bridge:value('device-bridge'),vibrationChannel:Number(value('device-vib-channel')),rotationChannel:Number(value('device-rot-channel')),vibrationMax:Number(value('device-vib-max')),rotationMax:Number(value('device-rot-max')),phaseDefaults:!engineEvents()&&element<HTMLInputElement>('device-phase-defaults').checked,randomRotation:!engineEvents()&&element<HTMLInputElement>('device-random-rotation').checked});
 const labels=()=>{element('device-vib-label').textContent=Math.round(Number(value('device-vib-max'))*100)+'%';element('device-rot-label').textContent=Math.round(Number(value('device-rot-max'))*100)+'%';};
 const message=(text:string)=>{element('device-message').textContent=text;};
 const configure=()=>{labels();try{send({type:'device-config',settings:settings()});configuredEventMode=engineEvents();send({type:'device-session',session:session()});}catch{message('Choose two different motor channels.');}};
 const stop=()=>{enabled=false;element<HTMLInputElement>('device-enabled').checked=false;send({type:'device-stop'});};
 element<HTMLInputElement>('device-enabled').onchange=()=>{enabled=element<HTMLInputElement>('device-enabled').checked;configure();};
 for(const id of devicePreferenceIds.filter(id=>!['device-address','device-write-char','device-auto-connect'].includes(id)))element(id).addEventListener('change',configure);
 for(const id of ['device-vib-max','device-rot-max'])element(id).addEventListener('input',configure);
 element('device-stop').onclick=stop;
 element('device-resume').onclick=()=>{if(enabled)configure();else element('device-message').textContent='Enable device control first.';};
 element('device-scan').onclick=async()=>{const button=element<HTMLButtonElement>('device-scan');button.disabled=true;element('device-message').textContent='Looking for Bluetooth devices …';
  try{const response=await fetch('/api/devices/scan');const data=await response.json();if(!response.ok)throw Error(data.error);const list=element<HTMLSelectElement>('device-discovered');list.replaceChildren();
   for(const device of [...data.devices].sort((a:any,b:any)=>Number(/pearlconch|joyhub/i.test(b.name))-Number(/pearlconch|joyhub/i.test(a.name)))){const option=document.createElement('option');option.value=device.address;option.textContent=(device.name||'Unnamed device')+' · '+device.address+' · '+device.rssi+' dBm';list.append(option);}
   if(list.options.length){element<HTMLInputElement>('device-address').value=list.value;element('device-address').dispatchEvent(new Event('change'));}
   element('device-message').textContent=list.options.length?'Choose your device, then press Connect.':'No BLE devices found.';
  }catch(error){element('device-message').textContent=String(error);}finally{button.disabled=false;}
 };
 element<HTMLSelectElement>('device-discovered').onchange=()=>{element<HTMLInputElement>('device-address').value=value('device-discovered');element('device-address').dispatchEvent(new Event('change'));};
 element('device-connect').onclick=async()=>{const button=element<HTMLButtonElement>('device-connect');button.disabled=true;stop();element('device-message').textContent='Connecting to BLE …';
  try{const response=await fetch('/api/devices/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:value('device-address'),...(value('device-write-char').trim()?{writeChar:value('device-write-char').trim()}:{})})});const data=await response.json();if(!response.ok)throw Error(data.error);element('device-message').textContent='Bridge started · waiting for BLE.';}catch(error){element('device-message').textContent=String(error);}finally{button.disabled=false;}
 };
 element('device-disconnect').onclick=async()=>{stop();element<HTMLInputElement>('device-auto-connect').checked=false;element('device-auto-connect').dispatchEvent(new Event('change'));try{const response=await fetch('/api/devices/disconnect',{method:'POST'});if(!response.ok)throw Error('Could not disconnect BLE.');message('BLE disconnected.');}catch(error){message(String(error));}};
 const test=(channel:number)=>{try{if(!channel){message('This motor has no assigned channel yet.');return;}send({type:'device-test',settings:settings(),channel,intensity:Number(value('device-test-intensity'))});message('Requesting a channel test …');}catch{message('Choose two different motor channels.');}};
 element('device-test').onclick=()=>test(Number(value('device-test-channel')));
 element('device-test-vibration').onclick=()=>test(Number(value('device-vib-channel')));
 element('device-test-rotation').onclick=()=>test(Number(value('device-rot-channel')));
 element('device-command-run').onclick=()=>{if(!enabled){element('device-message').textContent='Enable device control first.';return;}send({type:'device-session',session:session()});send({type:'device-command',command:{type:'device',channel:value('device-manual-channel'),operation:'pattern',pattern:value('device-manual-pattern')}});};
 const updateStatus=(data:any)=>{
  lastStatus=data;if(data.owned!==undefined){enabled=data.owned===true;element<HTMLInputElement>('device-enabled').checked=enabled;}
  const connection=data.connected===true?'BLE connected':data.bridge==='upstream'?'External UDP bridge · connection status unreported':data.delivery?.error?'BLE error: '+data.delivery.error:data.bridgeProcess?.error?'BLE error: '+data.bridgeProcess.error:data.bridgeAvailable?'Local bridge ready · BLE disconnected':data.bridgeProcess?.connecting?'Connecting to BLE':data.bridgeProcess?.error?'BLE error: '+data.bridgeProcess.error:'Local BLE bridge unavailable';
  if(data.testResult)message(data.testResult.ok?'Test command for channel '+data.testResult.channel+' sent · 0.5 s, then automatically off. Check movement on the device.':'Test skipped. Check BLE and whether another page owns device control.');
  else if(data.ok===false)message('Command skipped. Check the connection, channel mapping and session.');
  element('device-status').textContent=(data.ok===false?'Command skipped · ':'')+(enabled?(data.automationPaused?'Patterns paused · ':'Control enabled · '):'Control off · ')+connection;
  element('device-delivery').textContent=data.delivery&&data.connected?'BLE writes: '+data.delivery.writeCount+(data.delivery.lastNonzeroPacket?' · last motor command: '+data.delivery.lastNonzeroPacket:' · only stop / zero values so far')+' · The device does not report physical movement.':'';
  const channels=Array.isArray(data.channels)?data.channels:[0,0,0,0];element('device-levels').textContent='Vibration '+(channels[Number(value('device-vib-channel'))-1]??0)+'% · Rotation '+(channels[Number(value('device-rot-channel'))-1]??0)+'%';
 };
 labels();
 return {
  tick(wall:number){bindAudio();
   if(wall-lastBeat>=500){lastBeat=wall;if(enabled)send({type:'device-session',session:session()});}
   if(wall-lastPoll>=1000){lastPoll=wall;send({type:'device-status'});}
  },
  message(data:any){if(data.type==='device-status'){updateStatus(data);return true;}return false;},
  sync(){if(enabled){if(configuredEventMode!==engineEvents())configure();else send({type:'device-session',session:session()});}},
  bindAudio,clear(){if(enabled)send({type:'device-clear'});},stop,
  disconnected(){enabled=false;element<HTMLInputElement>('device-enabled').checked=false;updateStatus({...lastStatus,owned:false,connected:false,bridgeAvailable:false});},
 };
}
