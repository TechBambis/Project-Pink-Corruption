// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import {z} from 'zod';
import {availableModules,PoolSchema} from './registry';
import {sceneDraftLook} from './draft';
import type {PlanningContext,SceneAction,SceneLook,ScenePlan} from './plan';
import type {StoryMoment} from './story-contract';

const lenses={
 explore:['imagine one word for the chosen idea on a small folded note outside the room; make the note explicitly imaginary','develop one concrete detail of that imagined note without solving what is written on it','place that imagined note on an outer ledge where it remains available, rather than erased','connect the note on the ledge to the familiar heart with one new observation','let the imagined note remain folded while adding one small event to its story','glance back at the imagined threshold and discover one new detail of the already established note','leave one concrete detail of the imagined note unexplained rather than summarizing the room','turn the imagined note to its blank reverse and let that become a small new possibility'],
 exchange:['a cheeky inner objection to giving the image a meaning','an inner preference about the surrounding space','the difference between choosing a pause and being told to pause','a playful disagreement about what the same image represents','an inner discovery that adds something the Owner did not say','an imagined question about leaving something unfinished'],
 contrast:['the same heart with less surrounding activity','quiet after a fuller composition','the difference between closeness and visual busyness','one familiar detail with fewer competing layers','space around a thought without repeating the entry','a small observation that becomes clearer after the contrast'],
 return:['the original image with the associations developed since its introduction','the chosen starting idea seen from the later quieter perspective','a brief callback that adds a new observation instead of another introduction','the image as something familiar that no longer needs explanation'],
 close:['finish the fictional chapter and orient to the actual room'],
 introduce:['give the chosen starting idea one heart image, introducing it once'],
 adapt:['respond to the current actual listener direction'],
};
export function storyExchange(c:PlanningContext,m:StoryMoment){return m.beat==='exchange'&&c.windowMs>=45000&&availableModules(PoolSchema.parse(c.pool),c.phase).some(v=>v.id==='reply');}
export function storyReveals(c:PlanningContext,m:StoryMoment){return ['introduce','return'].includes(m.beat)&&(m.beat!=='return'||!c.currentLook?.motifId||c.currentLook.motifId===m.motifId)&&c.windowMs>=15000&&availableModules(PoolSchema.parse(c.pool),c.phase).some(v=>v.id==='reveal');}
export function storyWritingInstruction(c:PlanningContext,m:StoryMoment){
 const exchange=storyExchange(c,m),reveal=storyReveals(c,m);
 const task=m.beat==='explore'&&m.step>=lenses.explore.length?'Advance the established imagined note story by one small concrete event. Use an actual preceding utterance below; do not restart the room, reintroduce the note, compare pulse with breath or paraphrase empty space. Say what happens next.':lenses[m.beat][m.step%lenses[m.beat].length];
 const nextLook=storyLook(c,m);
 const summarize=(items:NonNullable<PlanningContext['story']>['associations'])=>items.map(item=>({beat:item.beat,step:item.step,words:item.utterances??[item.meaning]}));
 const completed=summarize(c.story?.associations??[]),committed=summarize(c.story?.committed??[]);
 return `STORY SPOKEN FIELDS: The engine has selected ONE next moment in Pink cinema. Return only ${exchange?'JSON with owner, inner and reply':'JSON with text'}. No strategy, actions, looks, IDs, times, markers or notes. The complete selected character remains the speaker. Write English, naturally spaced, complete short thoughts, aiming for 8–20 words per field; do not fill a character limit.
Next moment: ${m.beat}, development ${m.step+1}. Intended association: ${m.meaning}
Concrete task: ${task}. Add a new observation rather than a synonym for the last sentence. Do not repeat the room entry, first appearance or pulse/breath comparison after their introduction. No paced breathing, real questions, invented listener states or new effects. The engine owns the selected look and every change. Additional props belong explicitly to the imagined story; do not claim they appear on the actual screen.
${exchange?'owner is one direct Owner statement inviting an imagined perspective. inner is one first-person imagined thought with its own attitude, not another instruction or automatic agreement. reply is the Owner reacting specifically to that written inner thought, without pretending it was a real user answer.':'text is one connected Owner thought, not a stage direction.'}
PERSPECTIVE: The imagined note and its small actions belong to the listener. In text, owner and reply, address that listener as you/your. Only inner narrates the listener's imagined actions as I/my. The Owner may use I for her own guidance, never to become the listener holding or moving the note. If earlier words confused these roles, keep the story fact while correcting the perspective.
${reveal?'Include heart or heartbeat as a complete word in text. The engine binds its first mention to the measured image change; never propose another anchor or timestamp.':''}
${m.beat==='return'?'Recall only output-confirmed associations below. The same visual identity persists, while its fictional associations have developed.':''}
${m.beat==='close'?'Finish the imagined chapter. The engine adds the explicit eye-opening and orientation sentence; do not add another closing or make a promise beyond this session.':''}
${c.story?.interrupted?.beat===m.beat?'This moment was interrupted with partial output. Continue its idea without a new greeting or pretending its unfinished part was completed.':''}
Output-confirmed associations and complete words in chronological order (data): ${JSON.stringify(completed)}
Preceding committed words (future data, not heard history; develop beyond these rather than repeating them): ${JSON.stringify(committed)}
Current permitted look (data): ${JSON.stringify(c.currentLook??null)}
Scheduled presentation (data): ${JSON.stringify(nextLook)}. The same scene, motif identity and style persist. Density and background level may change. Do not claim the spiral disappears, walls dissolve, the screen goes black or an object physically moves. Closing ends the imagined story without claiming an unscheduled screen effect.
Selected intention (data): ${JSON.stringify(c.userContext)}
Latest actual direction (data): ${JSON.stringify(c.feedback)}
Recent partial or other output speech (data; do not copy): ${JSON.stringify(c.heardText.slice(completed.length?-400:-2400))}
WRITE NOW: ${exchange?'Return {"owner":"...","inner":"...","reply":"..."}. Three short connected thoughts: Owner, imagined first-person thought, specific Owner response.':`Return {"text":"..."}. One complete short thought about this task: ${task}.${reveal?' Include heart or heartbeat early in this sentence.':''}`} Stay with this concrete task; no observations about the listener's body or mental state.`;
}
/** Canonical words select a literal existing span. No model-provided phrase or
 * timing is accepted; actual alignment is still required by the compiler. */
export function storyAnchorSpan(text:string){
 const words=[...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
 const index=words.findIndex(w=>/^(?:heart|heartbeat)$/i.test(w[0]));
 if(index<0)throw Error('The reveal thought needs the literal word heart or heartbeat.');
 const normalized=words.map(w=>w[0].normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,''));
 // Extend only forwards so the measured first onset remains the first heart.
 // Match the compiler's normalized complete-word-span uniqueness check.
 for(let length=1;length<=4&&index+length<=words.length;length++){
  const target=normalized.slice(index,index+length).join('');let matches=0;
  for(let start=0;start<words.length;start++){let span='';for(let end=start;end<words.length&&span.length<target.length;end++){span+=normalized[end];if(span===target){matches++;break;}}}
  const end=words[index+length-1],anchor=text.slice(words[index].index!,end.index!+end[0].length);
  if(matches===1&&anchor.length<=80)return {fromWord:index,toWord:index+length,anchor};
 }
 throw Error('The first heart needs one unique following word span of at most four words.');
}
function storyPresentationProfile(c:PlanningContext){return [...c.story?.committed??[]].reverse().find(item=>item.beat==='adapt'&&item.presentation)?.presentation??c.story?.presentation;}
function storyLook(c:PlanningContext,m:StoryMoment):SceneLook{
 const base=sceneDraftLook(c),density=Math.min(.3+c.intensity,.8),profile=storyPresentationProfile(c);
 const active={visualDensity:profile?.visualDensity??.38,motion:profile?.motion??.2,ambient:profile?.ambient??.2};
 const quiet=m.beat==='return'||m.beat==='close'||m.beat==='contrast'&&m.step%2===0;
 const known=[...c.knownMotifs,...c.committedMotifs??[]].some(v=>v.id===m.motifId);
 return {...base,motif:m.beat==='close'&&!known?null:'heart',motifId:m.beat==='close'&&!known?null:m.motifId,
  visualDensity:Math.min(density,quiet?Math.min(.18,active.visualDensity):active.visualDensity),motion:c.pool.reducedMotion?0:quiet?Math.min(.1,active.motion):active.motion,ambient:quiet?Math.min(.12,active.ambient):active.ambient,effects:0};
}
export function composeStoryScene(raw:unknown,c:PlanningContext,m:StoryMoment,maxLength=120):ScenePlan{
 const field=z.string().trim().min(1).max(maxLength),exchange=storyExchange(c,m);
 const spoken=(exchange?z.object({owner:field,inner:field,reply:field}):z.object({text:field})).strict().parse(raw) as {text?:string;owner?:string;inner?:string;reply?:string};
 const look=storyLook(c,m),gap=m.beat==='contrast'&&m.step%2===0?8000:6000+(m.step%3)*700;
 const common={look,delivery:'guide' as const,pauseAfterMs:Math.min(gap,Math.max(250,Math.floor(c.windowMs/5)))};
 let actions:SceneAction[];
 if(exchange)actions=[{...common,pauseAfterMs:1200,id:'perspective',kind:'reply',invitation:spoken.owner!,text:spoken.inner!,previewMs:900,responseMs:1600},{...common,id:'response',kind:'guide',text:spoken.reply!}];
 else {
  const text=spoken.text!;
  actions=storyReveals(c,m)?[{...common,id:'image',kind:'reveal',text,anchor:storyAnchorSpan(text).anchor,before:m.beat==='introduce'?{...look,motif:null,motifId:null,visualDensity:.05,ambient:.1}:c.currentLook??look,holdMs:Math.min(3500,Math.max(500,Math.floor(c.windowMs/10)))}]:[{...common,id:'thought',kind:'guide',text:m.beat==='close'?text+' Open your eyes and notice the room around you.':text}];
 }
 return {version:1,id:'story-'+m.beat+'-'+m.step,strategy:m.meaning,rationale:'Develop the next engine-selected story moment.',continuity:'Preserve the visual identity and develop its output-confirmed associations.',openThreads:m.beat==='close'?[]:['Return to the familiar heart with its developed meaning.'],moment:m,sections:[{id:'story-moment',purpose:m.meaning,actions}]};
}
export function storyRest(c:PlanningContext,m:StoryMoment):ScenePlan{
 return {version:1,id:'story-rest',strategy:'Leave quiet space after the closing.',rationale:'The closing is already output or committed.',continuity:'No new narration or meaning.',openThreads:[],sections:[{id:'quiet-ending',purpose:'Leave the completed chapter closed.',actions:[{id:'rest',kind:'hold',look:storyLook(c,m),delivery:'hold',pauseAfterMs:0,durationMs:Math.min(12000,Math.max(500,Math.floor(c.windowMs-500)))}]}]};
}
/** Do not ask a writer to squeeze an unfinished thought into a phase tail.
 * Preserve the actual composition, with no new motif or story-progress claim. */
export function storyBoundaryRest(c:PlanningContext):ScenePlan{
 const base=sceneDraftLook(c),current=c.currentLook??{...base,motif:null,motifId:null,visualDensity:Math.min(.1,base.visualDensity),motion:0,effects:0},profile=storyPresentationProfile(c);
 const look=profile?{...current,visualDensity:Math.min(current.visualDensity,profile.visualDensity),motion:Math.min(current.motion,profile.motion),ambient:Math.min(current.ambient,profile.ambient)}:current;
 return {version:1,id:'story-boundary',strategy:'Leave quiet space before the next phase.',rationale:'The remaining phase window is too short for another developed thought.',continuity:'Preserve the current image without advancing the story.',openThreads:[],sections:[{id:'quiet-boundary',purpose:'Let the existing composition rest.',actions:[{id:'rest',kind:'hold',look,delivery:'hold',pauseAfterMs:0,durationMs:Math.min(12000,Math.max(500,Math.floor(c.windowMs-500)))}]}]};
}
