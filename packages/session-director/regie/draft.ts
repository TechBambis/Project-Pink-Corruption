// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {z} from 'zod';
import {ScenePlanSchema,LookSchema,PlanningContextSchema,type PlanningContext,type SceneLook} from './plan';

type Schema={type?:string;properties?:Record<string,Schema>;required?:string[];items?:Schema;anyOf?:Schema[];[key:string]:unknown};
/** Remove engine bookkeeping, retaining the same admitted action variants. */
export function sceneDraftSchema(full:Schema,maxActions=4,requirePresentation=false):Schema{
 const variants=full.properties!.sections.items!.properties!.actions.items!.anyOf!;
 return {type:'object',additionalProperties:false,required:['strategy','actions'],properties:{
  strategy:{type:'string',minLength:1,maxLength:120},
  actions:{type:'array',minItems:1,maxItems:maxActions,items:{anyOf:variants.map(variant=>{
   const properties={...variant.properties};delete properties.id;
   for(const [key,field] of Object.entries(properties))if(typeof field.pattern==='string'&&field.pattern.endsWith('[.!?]$')){
    const normalLimit=key==='phrase'||key==='text'&&['reply','repeat'].includes(String(properties.kind.const))?200:240;
    // A narrower full-schema bound belongs to the remaining phase window.
    // Draft expansion must not restore the normal composition allowance.
    const maxLength=typeof field.maxLength==='number'&&field.maxLength<120?field.maxLength:normalLimit;
    properties[key]={...field,maxLength,pattern:field.pattern.replace(/\{(\d+),(\d+)\}/g,`{0,${maxLength-1}}`)};
    // Keep normal spaces available through the entire thought. A hard grammar
    // word cap encouraged the model to glue its remaining words together.
    // The planner validates lexical word count before any speech is rendered;
    // measured PCM remains the final duration limit.
   }
   properties.look={...properties.look,required:requirePresentation?['visualDensity','motion','ambient']:[]};
   if(properties.kind.const==='reveal'){
    const before={...properties.before.properties};delete before.motif;delete before.motifId;
    properties.before={...properties.before,properties:before,required:[]};
   }
   return {...variant,properties,required:variant.required!.filter(key=>!['id',...(requirePresentation?[]:['look']),'delivery','pauseAfterMs'].includes(key))};
  })}},
  openThreads:{type:'array',maxItems:2,items:{type:'string',minLength:1,maxLength:120}},
  resolution:full.properties!.resolution,
 }};
}
function initialLook(c:ReturnType<typeof PlanningContextSchema.parse>):SceneLook{
 const p=c.pool,motif=p.visuals?p.motifs[0]??null:null;
 return {scene:p.scenes.includes('Soft Pink')?'Soft Pink':p.scenes[0],motif,motifId:motif?'focus-'+motif:null,
  style:p.visuals?p.styles.includes('loop')?'loop':p.styles[0]??null:null,
  visualDensity:p.visuals?Math.min(.3,.3+c.intensity):0,motion:p.visuals&&!p.reducedMotion?.2:0,ambient:.2,effects:.2};
}
export function sceneDraftLook(context:PlanningContext){const c=PlanningContextSchema.parse(context);return c.currentLook??initialLook(c);}
/** The model never supplies IDs or transport state. Every expanded action still
 * passes the existing complete plan validation, duration checks and compiler. */
export function expandSceneDraft(raw:unknown,context:PlanningContext){
 const c=PlanningContextSchema.parse(context);
 const draft=z.object({strategy:z.string().trim().min(1).max(120),actions:z.array(z.object({kind:z.string(),look:LookSchema.partial().optional(),delivery:z.enum(['guide','settle','drive','hold','return']).optional(),pauseAfterMs:z.number().int().min(0).max(8000).optional()}).passthrough()).min(1).max(4),
  openThreads:z.array(z.string().min(1).max(120)).max(2).default([]),resolution:ScenePlanSchema.shape.resolution,
 }).strict().parse(raw);
 let look=c.currentLook??initialLook(c);
 const actions=draft.actions.map((action,index)=>{
  look=LookSchema.parse({...look,...action.look});
  const before=action.kind==='reveal'?LookSchema.omit({motif:true,motifId:true}).partial().strict().parse(action.before):undefined;
  return {...action,...(before?{before:{...look,...before,motif:null,motifId:null}}:{}),id:'action-'+index,look:{...look},delivery:action.delivery??'guide',pauseAfterMs:action.pauseAfterMs??250};
 });
 return ScenePlanSchema.parse({version:1,id:'scene-draft',strategy:draft.strategy,rationale:draft.strategy,continuity:draft.strategy,openThreads:draft.openThreads,resolution:draft.resolution,sections:[{id:'section',purpose:draft.strategy,actions}]});
}

export function draftFormatDescription(schema:Schema){
 return schema.properties!.actions.items!.anyOf!.map(action=>{
  const kind=action.properties!.kind.const;
  return kind+': '+action.required!.filter(key=>key!=='kind').join(', ');
 }).join('; ');
}
