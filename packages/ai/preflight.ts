// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {fitContext,ContextOverflowError,type TokenCounter} from './context';
import {buildReplyPrompt} from './prompt';
import {snapshotSession} from './session-state';
import {sessionPhases} from '../session-director/phases';
import {devicePrompt} from '../devices/commands';
import type {Interaction} from './request';

export interface PreflightSettings {
 context:number;maxTokens:number;safetyTokens:number;soundDesign:boolean;
 selectedTriggers:string[];narration:boolean;
 tokenCount:'exact'|'estimate';
 checkpointPrefix?:string;
 interaction?:Interaction;dualVoice?:boolean;
}
export interface PreflightBudget {mode:'conversation'|'narration';phase:string;inputTokens:number;maxTokens:number;historyRoomTokens:number}
/** Check actual reply instructions before warming. Counts use the already selected backend/template.
 * Representative phases have no history; changed inputs are still checked at generation time. */
export async function preflightReplyContext(base:string,settings:PreflightSettings,count:TokenCounter):Promise<PreflightBudget[]>{
 const budgets:PreflightBudget[]=[];
 for(const mode of settings.narration?['conversation','narration'] as const:['conversation'] as const){
  for(const phase of mode==='narration'?sessionPhases:['induction'] as const){
   const session={...snapshotSession({elapsedSeconds:0,totalSeconds:1200,scene:'Spiral Focus',intensityPercent:45,activeTriggers:settings.selectedTriggers,lastTrigger:null}),phase};
   const narration=mode==='narration',request=narration?'Hello Bambi.':'Please explain the current session.';
   const system=buildReplyPrompt(base,request,narration&&settings.soundDesign,devicePrompt(false),session,'',!narration,narration,settings.interaction,'',settings.dualVoice);
   try{
    const plan=await fitContext(system,[],request,count,settings.context,settings.maxTokens,settings.safetyTokens,narration&&settings.interaction!=='situational'?2048:Math.min(512,settings.maxTokens),'',{checkpointPrefix:settings.checkpointPrefix});
    budgets.push({mode,phase,inputTokens:plan.inputTokens,maxTokens:plan.maxTokens,historyRoomTokens:Math.max(0,settings.context-plan.inputTokens-settings.safetyTokens-plan.maxTokens)});
   }catch(error){
    if(!(error instanceof ContextOverflowError))throw error;
    const reason=settings.tokenCount==='estimate'?'The estimated budget leaves too little context':'The selected model has too little context';
    throw Error(`${reason} for ${mode}${narration?' ('+phase+')':''} with these settings. Select a model with more context${narration?', disable automatic narration':''}, or use fewer triggers. The full authored prompt has been preserved.`,{cause:error});
   }
  }
 }
 return budgets;
}
