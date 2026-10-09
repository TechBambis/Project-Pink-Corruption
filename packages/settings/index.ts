// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import {z} from 'zod';
import {sceneNames} from '../safety/actions';
import {sessionDirections} from '../session-director/direction';
import {TriggerTimingSchema,defaultTriggerTiming} from '../session-director/trigger-timing';
import {migrateVisualPreferences} from '../visuals/preferences';

export type SettingValue=string|number|boolean;
export type Settings=Record<string,SettingValue>;
export type SettingCategory='portable'|'personal'|'machine-specific'|'runtime-only';
export const sectionLabels={audio:'Audio & voice',visuals:'Visuals',triggers:'Trigger timing & effects',session:'Session & conversation',personal:'Personal text',machine:'This machine'} as const;
export type SettingsSection=keyof typeof sectionLabels;
const numericChoice=(min:number,max:number,step?:number)=>z.union([z.string().min(1).refine(v=>v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max,'Outside setting range'),z.number().finite().min(min).max(max)]).refine(value=>step===undefined||Math.abs((Number(value)-min)/step-Math.round((Number(value)-min)/step))<1e-6,'Use a supported setting increment').transform(value=>String(Number(value)));
const voiceReference=z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/);
const logicalReference=z.string().min(1).max(160).regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/).refine(v=>!v.includes('..'),'Use a logical model identifier');
const jsonSetting=(schema:z.ZodTypeAny)=>z.string().max(16000).transform((value,ctx)=>{try{return JSON.stringify(schema.parse(JSON.parse(value)));}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid structured setting'});return z.NEVER;}});
export interface SettingDefinition {schema:z.ZodTypeAny;default:SettingValue;category:SettingCategory;section:SettingsSection;transfer?:boolean}
const field=(schema:z.ZodTypeAny,defaultValue:SettingValue,category:SettingCategory,section:SettingsSection,transfer=true):SettingDefinition=>({schema,default:defaultValue,category,section,transfer});
/** The authoritative inventory: validation, UI persistence and transfer use these same definitions. */
export const settingsRegistry:Record<string,SettingDefinition>={
  "guided-style":field(z.string().max(300),"Soft, playful, dreamy and affectionate","personal","personal"),
  "conversation-style":field(z.enum(["situational", "reactive"]),"reactive","portable","session"),
  "bambicloud-cues":field(z.boolean(),true,"portable","session"),
  "player-cue-markers":field(z.boolean(),true,"portable","session"),
  "session-events":field(z.boolean(),true,"portable","session"),
  "event-haptics":field(z.boolean(),false,"portable","session"),
  "narration-enabled":field(z.boolean(),true,"portable","session"),
  "adaptive-delivery":field(z.boolean(),true,"portable","session"),
  "spiral-style":field(z.enum(["tunnel", "loop", "fractal", "original", "vortex", "infinity", "prism", "orb"]),"tunnel","portable","visuals"),
  "spiral-depth":field(numericChoice(0,1,0.01),"0.8","portable","visuals"),
  "visual-journey":field(z.boolean(),true,"portable","visuals"),
  "visual-fixation":field(z.enum(["none", "dot", "heart"]),"none","portable","visuals"),
  "visual-focus-words":field(z.boolean(),false,"portable","visuals"),
  "sampling-profile":field(z.enum(["qwen", "creative"]),"qwen","portable","session"),
  "visual-voice-sync":field(z.boolean(),true,"portable","visuals"),
  "visual-tick-sync":field(z.boolean(),true,"portable","visuals"),
  "visual-reactivity":field(numericChoice(0,100,1),"65","portable","visuals"),
  "voice-echoes":field(z.boolean(),true,"portable","audio"),
  "dual-voice":field(z.boolean(),false,"portable","audio"),
  "trigger-timing-config":field(jsonSetting(TriggerTimingSchema),JSON.stringify(defaultTriggerTiming()),"portable","triggers"),
  "breath-visuals":field(z.boolean(),true,"portable","visuals"),
  "breath-sound":field(z.boolean(),true,"portable","audio"),
  "sound-design":field(z.boolean(),true,"portable","audio"),
  "sound-defaults":field(z.boolean(),true,"portable","audio"),
  "sound-bass-fallback":field(z.boolean(),false,"portable","audio"),
  "tick-enabled":field(z.boolean(),true,"portable","audio"),
  "tick-defaults":field(z.boolean(),true,"portable","audio"),
  "tick-dives":field(z.boolean(),false,"portable","audio"),
  "visuals-enabled":field(z.boolean(),true,"portable","visuals"),
  "mode":field(z.enum(["local", "conversation", "hybrid", "official"]),"conversation","portable","session"),
  "scene":field(z.enum(sceneNames),"Spiral Focus","portable","visuals"),
  "phase-visuals":field(z.boolean(),true,"portable","visuals"),
  "visual-opacity":field(numericChoice(0,1,0.01),"1","portable","visuals"),
  "intensity":field(numericChoice(0,100),"45","portable","session"),
  "duration":field(numericChoice(60,7200).or(z.literal('unlimited')),"unlimited","portable","session"),
  "curve":field(z.enum(["slow-build", "wave", "peak-and-cool", "linear"]),"slow-build","portable","session"),
  "ai-mode":field(z.enum(["off", "text", "voice", "ambient", "interactive"]),"voice","portable","session"),
  "model":field(logicalReference,"bambi-qwen35-9b-hauhau:q4_k_m","portable","session"),
  "voice":field(voiceReference,"af_heart","portable","audio"),
  "voice2":field(voiceReference.or(z.literal('')),"","portable","audio"),
  "voice-mix":field(numericChoice(0,1,0.05),"0.25","portable","audio"),
  "audio-preset":field(z.enum(["bambi_local_clean", "bambi_classic", "bambi_classic_deep", "bambi_voice_test"]),"bambi_local_clean","portable","audio"),
  "mic-recognizer":field(z.enum(["auto", "whisper", "streaming"]),"auto","machine-specific","machine"),
  "mic-playback-mode":field(z.enum(["speakers", "headphones"]),"headphones","machine-specific","machine"),
  "mic-sensitivity":field(z.enum(["low", "balanced", "sensitive"]),"balanced","portable","session"),
  "mic-interruptible":field(z.boolean(),true,"portable","session"),
  "conversation-policy":field(z.enum(["adapt", "interrupt"]),"adapt","portable","session"),
  "mic-turn-pause":field(z.enum(["650", "1100", "450"]),"650","portable","session"),
  "mic-smart-turns":field(z.boolean(),false,"portable","session"),
  "speed":field(numericChoice(0.5,1.5,0.01),"0.78","portable","audio"),
  "performance":field(z.enum(["auto", "latency", "balanced", "quality"]),"auto","machine-specific","machine"),
  "persona":field(z.string().max(300),"","personal","personal"),
  "motion":field(numericChoice(0,1,0.05),"0.6","portable","visuals"),
  "density":field(numericChoice(0,1,0.05),"0.7","portable","visuals"),
  "reduced":field(z.boolean(),false,"portable","visuals"),
  "subtitles":field(z.boolean(),true,"portable","visuals"),
  "master":field(numericChoice(0,1,0.01),"0.7","portable","audio"),
  "bus-session":field(numericChoice(0,1,0.01),"0.8","portable","audio"),
  "bus-voice":field(numericChoice(0,1,0.01),"0.85","portable","audio"),
  "bus-ambient":field(numericChoice(0,0.5,0.01),"0","portable","audio"),
  "bus-effects":field(numericChoice(0,1,0.01),"0.2","portable","audio"),
  "prompt-template":field(z.enum(["bambisleep-classic", "gentle-induction", "custom"]),"bambisleep-classic","portable","session"),
  "bambi-name":field(z.string().max(50),"Bambi","personal","personal"),
  "trigger-selection":field(jsonSetting(z.array(z.string().min(1).max(100)).max(100)),"[]","portable","triggers"),
  "triggers-enabled":field(z.boolean(),true,"portable","triggers"),
  "trigger-sound":field(z.boolean(),true,"portable","triggers"),
  "trigger-snap":field(z.boolean(),true,"portable","triggers"),
  "trigger-moan":field(z.boolean(),true,"portable","triggers"),
  "trigger-extra-effects":field(z.boolean(),true,"portable","triggers"),
  "trigger-wiper-seconds":field(numericChoice(5,20,1),"5","portable","triggers"),
  "trigger-bubble-inflate":field(z.boolean(),true,"portable","triggers"),
  "trigger-bubble-squeak":field(z.boolean(),true,"portable","triggers"),
  "trigger-bubble-gap":field(numericChoice(0,1.5,0.1),"0.4","portable","triggers"),
  "trigger-inflate-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-squeak-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-tick-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-snap-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-moan-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-wiper-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-pop-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-bell-db":field(numericChoice(-24,12,1),"0","portable","triggers"),
  "trigger-pop-variant":field(z.enum(["pop_ccp", "pop_ccp_alt", "pop_ccp_soft", "pop_smack", "pop", "pop_alt"]),"pop_ccp","portable","triggers"),
  "trigger-moan-variant":field(z.enum(["random", "moan", "moan_alt", "moan_third"]),"random","portable","triggers"),
  "trigger-wiper-variant":field(z.enum(["wiper", "wiper_alt", "wiper_rain"]),"wiper","portable","triggers"),
  "trigger-effect-pause":field(numericChoice(0,10,0.5),"2.5","portable","triggers"),
  "trigger-plain-pause":field(numericChoice(0,10,0.5),"5","portable","triggers"),
  "original-sounds":field(z.boolean(),true,"portable","audio"),
  "collar-enabled":field(z.boolean(),false,"portable","triggers"),
  "collar-name":field(z.string().max(4000),"","personal","personal"),
  "response-length":field(z.enum(["220", "600", "2048", "8192"]),"8192","portable","session"),
  "spiral-mode":field(z.enum(["classic", "breathe", "drift", "colorCycle", "strobe"]),"classic","portable","visuals"),
  "spiral-speed":field(numericChoice(0.01,5,0.01),"1","portable","visuals"),
  "spiral-complexity":field(numericChoice(0.1,1.5,0.01),"1","portable","visuals"),
  "spiral-alpha":field(numericChoice(0.01,1,0.001),"1","portable","visuals"),
  "spiral-color-a":field(z.string().regex(/^#[0-9a-fA-F]{6}$/),"#c700c7","portable","visuals"),
  "spiral-color-b":field(z.string().regex(/^#[0-9a-fA-F]{6}$/),"#ff82ff","portable","visuals"),
  "brainwave-enabled":field(z.boolean(),false,"portable","audio"),
  "brainwave-preset":field(z.enum(['Deep Sleep','Light Sleep','Meditation','Focus','Alert','Lucid Dream','Study']),"Deep Sleep","portable","audio"),
  "brainwave-volume":field(numericChoice(0,1,0.01),"0.1","portable","audio"),
  "device-bridge":field(z.enum(["local", "upstream"]),"local","machine-specific","machine"),
  "device-address":field(z.string().regex(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$|^$/),"","machine-specific","machine"),
  "device-write-char":field(z.string().uuid().or(z.literal('')),"","machine-specific","machine"),
  "device-auto-connect":field(z.boolean(),true,"machine-specific","machine",false),
  "device-vib-channel":field(z.enum(["1", "2", "3", "4"]),"2","machine-specific","machine"),
  "device-rot-channel":field(z.enum(["0", "1", "2", "3", "4"]),"1","machine-specific","machine"),
  "device-vib-max":field(numericChoice(0,1,0.01),"0.3","machine-specific","machine"),
  "device-rot-max":field(numericChoice(0,1,0.01),"0.3","machine-specific","machine"),
  "device-phase-defaults":field(z.boolean(),true,"machine-specific","machine"),
  "device-random-rotation":field(z.boolean(),false,"machine-specific","machine"),
  "device-speech-accents":field(z.boolean(),true,"machine-specific","machine"),
  "device-accent-intensity":field(numericChoice(0,1,0.01),"0.1","machine-specific","machine"),
  "device-accent-duration":field(numericChoice(100,2000,10),"150","machine-specific","machine"),
  "device-vib-lead":field(numericChoice(0,1000,10),"0","machine-specific","machine"),
  "device-rot-lead":field(numericChoice(0,1000,10),"0","machine-specific","machine"),
  "device-transition":field(numericChoice(0,2000,10),"250","machine-specific","machine"),
  "session-direction":field(z.enum(['custom',...sessionDirections.map(style=>style.id)] as [string,...string[]]),"balanced","portable","session"),
  "direction-contrast":field(numericChoice(0,100),"50","portable","session"),
  "direction-repetition":field(numericChoice(0,100),"50","portable","session"),
  "direction-rhythm":field(z.enum(["expressive", "slow", "driving"]),"expressive","portable","session"),
  "direction-motifs":field(z.enum(["mixed", "ring", "heart", "gears"]),"mixed","portable","session"),
  "direction-theme":field(z.enum(["varied", "attention", "imagination", "perspective", "ease"]),"varied","portable","session"),
  "direction-blink":field(z.boolean(),true,"portable","session"),
  "direction-fractionation":field(z.boolean(),true,"portable","session"),
  "direction-mindwipe":field(z.boolean(),true,"portable","session"),
  "direction-reset":field(z.boolean(),true,"portable","session"),
  "direction-self":field(z.boolean(),true,"portable","session"),
  "direction-mantra":field(z.boolean(),true,"portable","session"),
  "direction-peak":field(z.boolean(),true,"portable","session"),
  "narration-pause-induction":field(numericChoice(0,30,0.5),"4","portable","session"),
  "narration-pause-deepening":field(numericChoice(0,30,0.5),"5","portable","session"),
  "narration-pause-conditioning":field(numericChoice(0,30,0.5),"6","portable","session"),
  "narration-pause-anchor":field(numericChoice(0,30,0.5),"4","portable","session"),
  "narration-pause-awakening":field(numericChoice(0,30,0.5),"8","portable","session"),
  "background-drone":field(z.boolean(),true,"portable","audio"),
  "background-drone-db":field(numericChoice(-60,-12,1),"-24","portable","audio"),
  "background-noise":field(z.boolean(),true,"portable","audio"),
  "background-noise-db":field(numericChoice(-60,-12,1),"-34","portable","audio"),
  "background-noise-type":field(z.enum(["pink", "white", "brown"]),"pink","portable","audio"),
};
const settingLabels:Record<string,string>={
 'guided-style':'Guided narration style','persona':'Chat personality','bambi-name':'Companion name','collar-name':'Collar text',
 'model':'AI model','ai-mode':'Voice output','mode':'Session experience','speed':'Voice speed','master':'Master volume',
 'voice':'Main voice','voice2':'Second voice','voice-mix':'Second voice blend','audio-preset':'Audio preset',
 'trigger-timing-config':'Phase trigger categories','trigger-selection':'Selected triggers','response-length':'Reply length',
 'bus-session':'Session audio volume','bus-voice':'Voice volume','bus-ambient':'Ambience volume','bus-effects':'Effects volume',
 'device-auto-connect':'Automatic device reconnect',
};
export const settingLabel=(id:string)=>settingLabels[id]??id.split('-').map(word=>word==='mic'?'Microphone':word==='db'?'dB':word.charAt(0).toUpperCase()+word.slice(1)).join(' ');
export const preferenceIds=Object.keys(settingsRegistry);
export const booleanPreferenceIds=preferenceIds.filter(id=>typeof settingsRegistry[id].default==='boolean');
export const SettingsSchema=z.object(Object.fromEntries(preferenceIds.map(id=>[id,settingsRegistry[id].schema.optional()]))).strict();
export const settingsDefaults=():Settings=>Object.fromEntries(preferenceIds.map(id=>[id,settingsRegistry[id].default]));
export function validateSettings(value:unknown):Settings {return SettingsSchema.parse(value) as Settings;}
/** Legacy storage is migrated field by field; malformed/retired fields never enter application code. */
export function migrateStoredSettings(value:Record<string,unknown>):Settings {
 if(!Object.keys(value).length)return {};
 const stored=migrateVisualPreferences({...value});
 if(stored['duration-version']!==1&&(stored.duration===undefined||String(stored.duration)==='1200'))stored.duration='unlimited';
 if(stored['guided-style']===undefined)stored['guided-style']=typeof stored.persona==='string'?stored.persona:settingsRegistry['guided-style'].default;
 if(stored['dialogue-version']!==1)Object.assign(stored,{'mic-playback-mode':'headphones','mic-interruptible':true,'mic-turn-pause':'650'});
 const result:Settings={};
 for(const id of preferenceIds){const parsed=settingsRegistry[id].schema.safeParse(stored[id]);if(parsed.success&&parsed.data!==undefined)result[id]=parsed.data;}
 return result;
}
export const profileMetadata={'duration-version':1,'dialogue-version':1,'visuals-version':2,'sampling-version':2};
export const runtimeSettingsInventory={
 'device-enabled':'Transient arming; never persisted or transferred',
 'device-test-intensity':'Transient device preview', 'device-test-channel':'Transient device preview',
 'device-manual-channel':'Transient manual actuation', 'device-manual-pattern':'Transient manual actuation',
 'voice-read-aloud':'Derived from ai-mode','voice-occasional':'Derived from ai-mode', 'experience-join':'Derived from mode',
 'trigger-timing-enabled':'Stored within trigger-timing-config','trigger-reinforcement-start':'Stored within trigger-timing-config',
 'trigger-test-phase':'Transient cue preview','trigger-test-category':'Transient cue preview','trigger-test-word':'Transient cue preview','trigger-preview-word':'Transient cue preview',
 'seek':'Transport position','chat-input':'Conversation input','event-program-file':'Authored session package owner',
 'files':'Media library owner','timeline-file':'Media/timeline owner','analysis-transcript':'Transient media analysis',
 'bambicloud-url':'Media library import','library-filter':'Transient library search',
 'memory-key':'Memory owner','memory-value':'Memory owner','library-notes-text':'Media library owner','library-notes-tags':'Media library owner',
 'device-discovered':'Transient BLE scan','settings-search-input':'Transient UI search',
};
