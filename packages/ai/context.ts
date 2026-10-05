// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {Message} from './index';

export type TokenCounter=(messages:Message[])=>Promise<number>;
export interface ContextPlan {messages:Message[];inputTokens:number;maxTokens:number;droppedTurns:number;safetyTokens:number;optionalContextIncluded:boolean}
/** Ollama has no chat-template tokenization endpoint. This is explicitly an estimate. */
export function estimateChatTokens(messages:Message[]){return messages.reduce((sum,message)=>sum+Math.ceil(new TextEncoder().encode(message.content).length/2.5)+48,16);}
function turnGroups(history:Message[]){
 const groups:Message[][]=[];
 for(const turn of history){if(turn.role==='user'||!groups.length)groups.push([]);groups.at(-1)!.push(turn);}
 return groups;
}
/** Keep complete recent turns; never clip a correction or the ending of played speech. */
export async function fitContext(system:string,history:Message[],request:string,count:TokenCounter,context:number,requestedOutput:number,safetyTokens=256,minimumOutput=64,optionalContext:string|string[]='',options:{fastPlanning?:boolean}={}):Promise<ContextPlan>{
 const mandatory:Message[]=[{role:'system',content:system},{role:'user',content:request}];
 const mandatoryTokens=await count(mandatory);
 const calibration=mandatoryTokens/estimateChatTokens(mandatory);
 const planningCount:TokenCounter=options.fastPlanning?async messages=>Math.ceil(estimateChatTokens(messages)*calibration):count;
 const available=context-mandatoryTokens-safetyTokens;
 if(available<minimumOutput)throw Error(`The current instructions and input exceed the ${context.toLocaleString('en-US')}-token context after reserving the response. Use fewer selected triggers or a larger context.`);
 const reserve=Math.min(requestedOutput,minimumOutput),inputLimit=context-reserve-safetyTokens;
 let selected:Message[]=[],inputTokens=mandatoryTokens;
 const groups=turnGroups(history).filter(group=>group[0]?.role==='user');
 let systemMessage=mandatory[0],optionalContextIncluded=false;
 const candidates=Array.isArray(optionalContext)?optionalContext:optionalContext?[optionalContext]:[];
 const included:string[]=[];
 // Reserve evidence alongside the latest two exchanges before filling older history.
 // Legacy single-string context keeps its previous lower-priority behavior.
 if(Array.isArray(optionalContext)){
  const newest=groups.slice(-2).flat();
  const baseline=await planningCount([mandatory[0],...newest,mandatory[1]]);
  const memoryLimit=Math.min(inputLimit,baseline+1536);
  for(const item of candidates){const candidate={role:'system' as const,content:system+'\n\n'+[...included,item].join('\n\n')};if(await planningCount([candidate,...newest,mandatory[1]])<=memoryLimit){included.push(item);systemMessage=candidate;optionalContextIncluded=true;}}
 }
 // At most log2(candidate exchanges) remote tokenizer calls; preserve a contiguous suffix.
 let low=0,high=groups.length;
 while(low<high){const middle=Math.ceil((low+high)/2),candidate=groups.slice(-middle).flat();const tokens=await planningCount([systemMessage,...candidate,mandatory[1]]);if(tokens<=inputLimit){low=middle;inputTokens=tokens;}else high=middle-1;}
 selected=low?groups.slice(-low).flat():[];
 inputTokens=await planningCount([systemMessage,...selected,mandatory[1]]);
 for(const item of Array.isArray(optionalContext)?[]:candidates){
  const withMemory:Message={role:'system',content:system+'\n\n'+[...included,item].join('\n\n')};
  const tokens=await planningCount([withMemory,...selected,mandatory[1]]);
  if(tokens<=inputLimit){included.push(item);systemMessage=withMemory;inputTokens=tokens;optionalContextIncluded=true;}
 }
 if(options.fastPlanning){
  // Calibrated estimates avoid many sequential network round trips. Verify the complete request exactly.
  inputTokens=await count([systemMessage,...selected,mandatory[1]]);
  while(inputTokens>inputLimit&&included.length){included.pop();systemMessage={role:'system',content:system+(included.length?'\n\n'+included.join('\n\n'):'')};inputTokens=await count([systemMessage,...selected,mandatory[1]]);}
  if(inputTokens>inputLimit){let fit=0,ceiling=low;while(fit<ceiling){const middle=Math.ceil((fit+ceiling)/2),candidate=groups.slice(-middle).flat();const tokens=await count([systemMessage,...candidate,mandatory[1]]);if(tokens<=inputLimit)fit=middle;else ceiling=middle-1;}selected=fit?groups.slice(-fit).flat():[];inputTokens=await count([systemMessage,...selected,mandatory[1]]);}
  optionalContextIncluded=included.length>0;
 }
 const maxTokens=Math.min(requestedOutput,context-inputTokens-safetyTokens);
 return {messages:[systemMessage,...selected,mandatory[1]],inputTokens,maxTokens,droppedTurns:history.length-selected.length,safetyTokens,optionalContextIncluded};
}
