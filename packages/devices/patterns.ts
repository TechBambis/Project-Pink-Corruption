// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {DeviceCommand} from './commands';
export interface ActuatorState{level:number;pattern:DeviceCommand['pattern'];started:number;bpm?:number;expires?:number;fade?:{from:number;to:number;seconds:number}}
export const offState=(now=0):ActuatorState=>({level:0,pattern:'constant',started:now});
export function actuatorValue(state:ActuatorState,now:number){
 if(state.expires!==undefined&&now>=state.expires)return 0;
 const t=Math.max(0,now-state.started);
 if(state.fade)return Math.max(0,Math.min(1,state.fade.from+(state.fade.to-state.fade.from)*Math.min(1,t/state.fade.seconds)));
 const cycle=(seconds:number)=>(1-Math.cos(2*Math.PI*t/seconds))/2;
 const period=state.bpm?60/state.bpm:1.2;
 const multiplier=state.pattern==='breathe'?.1+.9*cycle(6):state.pattern==='wave'?.15+.85*cycle(4):state.pattern==='pulse'?(t%period<(state.bpm?Math.min(.3,period/2):.6)?1:0):state.pattern==='strobe'?(t%.5<.25?1:0):state.pattern==='ramp_up'?Math.min(1,t/10):1;
 return Math.max(0,Math.min(1,state.level*multiplier));
}
export function applyDeviceCommand(state:ActuatorState,command:DeviceCommand,now:number,defaultLevel=.3):ActuatorState{
 if(command.operation==='off')return offState(now);
 if(command.operation==='on')return {level:command.intensity!,pattern:'constant',started:now};
 if(command.operation==='pattern')return {level:state.level||defaultLevel,pattern:command.pattern!,started:now-(command.phaseMs??0)/1000,...(command.bpm?{bpm:command.bpm}:{})};
 if(command.operation==='buzz')return {level:command.intensity!,pattern:'constant',started:now,expires:now+command.durationMs!/1000};
 return {level:command.intensity!,pattern:'constant',started:now,fade:{from:actuatorValue(state,now),to:command.intensity!,seconds:(command.durationMs??5000)/1000}};
}
