// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {z} from 'zod';
import {InteractionContextSchema,type ScenePlan} from './plan';

export const ChallengeWindowSchema=z.object({
  context:InteractionContextSchema,fromMs:z.number().finite().min(0),toMs:z.number().finite().min(0),invitationEventId:z.string().min(1).max(100),responseEventId:z.string().min(1).max(100),invitation:z.string().min(1).max(240),
}).strict().refine(w=>w.toMs>w.fromMs&&w.toMs-w.fromMs<=20000,'Bounded listening window required');
export type ChallengeWindow=z.infer<typeof ChallengeWindowSchema>;

/** A real input turn, separate from imagined inner answers. Session time keeps
 * running. Capture belongs to its onset and has a bounded recognition grace. */
export class PlayfulInteraction {
  private window:ChallengeWindow|null=null;
  private captureUntil=0;
  private invited=false;
  get context(){return this.window?structuredClone(this.window.context):null;}
  get scheduled(){return this.window;}
  schedule(raw:ChallengeWindow){this.window=ChallengeWindowSchema.parse(raw);this.captureUntil=0;this.invited=false;}
  invitationScheduled(eventId:string){if(this.window?.invitationEventId===eventId)this.invited=true;}
  get capturing(){return this.captureUntil>0;}
  waiting(atMs:number){return this.invited&&!!this.window&&!this.window.context.response&&!this.window.context.timedOut&&atMs>=this.window.fromMs&&atMs<this.window.toMs;}
  get unresolved(){return !!this.window&&!this.window.context.response&&!this.window.context.timedOut;}
  begin(atMs:number){if(!this.waiting(atMs))return false;this.captureUntil=this.window!.toMs+30000;return true;}
  receive(text:string,atMs:number){
    if(!text.trim()||!this.window||this.window.context.response||this.window.context.timedOut||!this.waiting(atMs)&&!(this.captureUntil&&atMs<=this.captureUntil))return false;
    this.window.context.response=text.trim().slice(-2000);this.captureUntil=0;return true;
  }
  expire(atMs:number){
    if(!this.window||!this.unresolved||atMs<this.window.toMs||this.captureUntil&&atMs<this.captureUntil)return false;
    this.window.context.timedOut=true;this.captureUntil=0;return true;
  }
  resolve(plan:ScenePlan){if(plan.resolution?.outcome!=='retry')this.clear();}
  cancelCapture(){this.captureUntil=0;}
  clear(){this.window=null;this.captureUntil=0;this.invited=false;}
}
