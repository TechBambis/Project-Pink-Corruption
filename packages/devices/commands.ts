// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {z} from 'zod';

export const devicePatterns=['breathe','pulse','wave','strobe','constant','ramp_up','slow','steady'] as const;
export const DeviceCommandSchema=z.object({
 type:z.literal('device'),channel:z.enum(['vib','rot','both']),
 operation:z.enum(['on','off','pattern','buzz','fade']),
 intensity:z.number().finite().min(0).max(1).optional(),
 pattern:z.enum(devicePatterns).optional(),
 durationMs:z.number().int().min(100).max(10000).optional(),
 bpm:z.number().int().min(20).max(120).optional(),
 phaseMs:z.number().finite().min(0).max(3000).optional(),
}).strict().superRefine((command,context)=>{
 if(command.channel==='both'&&!['off','fade'].includes(command.operation))context.addIssue({code:'custom',message:'Both supports only off/fade'});
 if(['on','buzz','fade'].includes(command.operation)&&command.intensity===undefined)context.addIssue({code:'custom',message:'Intensity required'});
 if(command.operation==='pattern'&&!command.pattern)context.addIssue({code:'custom',message:'Pattern required'});
 if(command.operation==='buzz'&&(command.channel!=='vib'||!command.durationMs))context.addIssue({code:'custom',message:'Buzz requires vibration and duration'});
 if((command.bpm!==undefined||command.phaseMs!==undefined)&&(command.channel!=='vib'||command.operation!=='pattern'||command.pattern!=='pulse'))context.addIssue({code:'custom',message:'Tick sync is for vibration pulse only'});
 if(command.phaseMs!==undefined&&(command.bpm===undefined||command.phaseMs>=60000/command.bpm))context.addIssue({code:'custom',message:'Pulse phase must be within the beat interval'});
 if(command.channel==='rot'&&command.pattern&&['breathe','wave','constant'].includes(command.pattern))context.addIssue({code:'custom',message:'Unknown rotation pattern'});
 if(command.channel==='vib'&&command.pattern&&['slow','steady'].includes(command.pattern))context.addIssue({code:'custom',message:'Unknown vibration pattern'});
});
export type DeviceCommand=z.infer<typeof DeviceCommandSchema>;
/** Recognize a bounded protocol, never raw BLE hex or executable expressions. */
export function parseDeviceMarker(marker:string):DeviceCommand|undefined{
 const match=/^\[(vib|rot|both):([^\]]{1,80})\]$/i.exec(marker);if(!match)return;
 const parts=match[2].toLowerCase().split(':');let channel=match[1].toLowerCase(),[operation,argument,duration]=parts;
 if(parts.length>(['buzz','fade'].includes(operation)?3:operation==='off'?1:2))return;
 if(channel==='vib'&&operation==='rotate'){channel='rot';operation='on';}
 const command={type:'device',channel,operation,...(operation==='pattern'?{pattern:argument}:{}),...(['on','buzz','fade'].includes(operation)?{intensity:argument!==undefined&&argument.trim()!==''?Number(argument):NaN}:{}),...(operation==='buzz'?{durationMs:Number(duration)}:{}),...(operation==='fade'?{durationMs:duration===undefined?channel==='both'?10000:5000:Number(duration)}:{})};
 const parsed=DeviceCommandSchema.safeParse(command);return parsed.success?parsed.data:undefined;
}

export const DeviceSettingsSchema=z.object({
 enabled:z.boolean().default(false),bridge:z.enum(['local','upstream']).default('local'),
 vibrationChannel:z.number().int().min(1).max(4).default(2),rotationChannel:z.number().int().min(0).max(4).default(1),
 vibrationMax:z.number().finite().min(0).max(1).default(.3),rotationMax:z.number().finite().min(0).max(1).default(.3),
 phaseDefaults:z.boolean().default(true),randomRotation:z.boolean().default(false),
 speechAccents:z.boolean().default(true),accentIntensity:z.number().finite().min(0).max(1).default(.1),accentDurationMs:z.number().int().min(100).max(2000).default(150),
 vibrationLeadMs:z.number().int().min(0).max(1000).default(0),rotationLeadMs:z.number().int().min(0).max(1000).default(0),
 transitionMs:z.number().int().min(0).max(2000).default(250),
}).strict().refine(s=>!s.rotationChannel||s.rotationChannel!==s.vibrationChannel,{message:'Actuator channels must differ'});
export type DeviceSettings=z.infer<typeof DeviceSettingsSchema>;
export type DeviceCueOrigin='speech';

export const DeviceSessionSchema=z.object({running:z.boolean(),paused:z.boolean(),elapsed:z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),duration:z.number().finite().min(1).max(86400),continuous:z.boolean().optional(),tickBpm:z.number().finite().min(0).max(120).optional(),tickPhaseMs:z.number().finite().min(0).max(3000).optional()}).strict();
export type DeviceSession=z.infer<typeof DeviceSessionSchema>;

export function devicePrompt(enabled:boolean){return enabled?[
 'LOCAL DEVICE METADATA: Optional hardware cues are playback metadata, not spoken words.',
 'Two independent actuator channels: vib and rot. Connection, mapping and limits are controlled by the user.',
 'Vibration: [vib:on:0.3], [vib:off], [vib:pattern:breathe|pulse|wave|strobe|constant|ramp_up] (choose one name), [vib:buzz:0.2:1000], [vib:fade:0].',
 'Rotation: [rot:on:0.2], [rot:off], [rot:pattern:slow|steady|pulse|strobe|ramp_up] (choose one name), [rot:fade:0].',
 '[both:off] stops both channels. [both:fade:0] fades both to zero over ten seconds.',
 'Place cues immediately before the corresponding spoken unit. Never claim device execution or connection; unavailable/unmapped channels are ignored.',
 'Do not invent raw commands. The user can interrupt, pause, disable or change actuator limits at any time.',
].join('\n'):'LOCAL DEVICE METADATA: Do not add device-control cues; device control is disabled.';}
