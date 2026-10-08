// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {DeviceCommand,DeviceCueOrigin,DeviceSettings} from './commands';

/** Audio output delay already includes the browser's output latency. Motor lead is measured separately. */
export function devicePlaybackPlan(command:DeviceCommand,outputDelayMs:number,settings:DeviceSettings,origin?:DeviceCueOrigin){
 if(!Number.isFinite(outputDelayMs)||outputDelayMs<0)return [];
 if(origin==='speech'){
  if(!settings.speechAccents)return [];
  command={type:'device',channel:'vib',operation:'buzz',intensity:settings.accentIntensity,durationMs:settings.accentDurationMs};
 }
 // Keep the global halt semantics; motor lead must never split a stop into two resumable commands.
 if(command.channel==='both'&&command.operation==='off')return [{command,delayMs:outputDelayMs}];
 const channels=command.channel==='both'?['vib','rot'] as const:[command.channel];
 return channels.filter(channel=>channel!=='rot'||settings.rotationChannel!==0).map(channel=>({
  command:{...command,channel} as DeviceCommand,
  delayMs:Math.max(0,outputDelayMs-(channel==='vib'?settings.vibrationLeadMs:settings.rotationLeadMs)),
 }));
}
