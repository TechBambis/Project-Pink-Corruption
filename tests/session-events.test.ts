// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventSchema, ProgramSchema, layerCount, eventDurationMs, parentPhaseMs } from '../packages/session-director/events/contract';
import { createReferenceProgram, withProgramTriggers, withHapticMappings } from '../packages/session-director/events/program';
import { EventRuntime, compileEvent, parseEngineMarker, TriggerLifecycle } from '../packages/session-director/events/runtime';
import { presentationAt, stateGains } from '../packages/session-director/events/presentation';
import { EventSpeechRequestSchema, renderEventSpeech, wavDurationMs, joinWav, validateEventText, validatePresentationText, SpeechWindowError, eventTextGrammar } from '../packages/session-director/events/speech';
import { Kokoro } from '../packages/speech/tts';
import { LlamaBackend } from '../packages/ai';
import { InferenceQueue } from '../packages/ai/inference';

const program = () => createReferenceProgram(300000, .85);
const event = (type: ReturnType<typeof program>['events'][number]['type']) => structuredClone(program().events.find(e => e.type === type)!);
function wav(ms: number) {
  const rate = 24000, samples = Math.round(rate * ms / 1000), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40); return buffer;
}
test('the five authoritative parent proportions remain 24/16/40/10/10 at every duration', () => {
  for (const duration of [60000, 300000, 1200000, 3600000]) {
    const p = createReferenceProgram(duration), runtime = new EventRuntime(p);
    for (const e of p.events) {
      const bounds = parentPhaseMs(e.phase, duration);
      assert.ok(e.atMs >= bounds.start); assert.ok(e.atMs + eventDurationMs(e) <= bounds.end + .001);
    }
    assert.deepEqual(['induction', 'deepening', 'conditioning', 'anchor', 'awakening'].map(phase => {
      const { start, end } = parentPhaseMs(phase as never, duration); return Math.round((end - start) / duration * 100);
    }), [24, 16, 40, 10, 10]);
    assert.equal(runtime.compiled.at(-1)!.event.type, 'soft_return');
  }
});
test('long main-phase passages keep returning to audible/visual contrast inside the fixed parent', () => {
  const p=createReferenceProgram(1200000), r=new EventRuntime(withProgramTriggers(p,{conditioning:['Good Girl']}));
  const main=p.events.filter(e=>e.phase==='conditioning'), contrast=main.filter(e=>e.type!=='layer_shift');
  assert.ok(contrast.some(e=>e.atMs>=780000),'Contrasts continue beyond minute 13');
  const lastPeak=main.filter(e=>e.type==='peak').at(-1)!;
  assert.ok(lastPeak.atMs>660000,'A later peak interrupts the recurring motif');
  const silence=main.find(e=>e.type==='silence')!, at=silence.atMs+100;
  assert.equal(presentationAt(r.snapshot(at),r.compiled.find(c=>c.event.id===silence.id),at).gains.AI_VOICE,0);
  const recall=main.find(e=>e.type==='motif_recall')!, recallAt=recall.atMs+100;
  const recalled=presentationAt(r.snapshot(recallAt),r.compiled.find(c=>c.event.id===recall.id),recallAt);
  assert.equal(recalled.motif,1);assert.equal(recalled.scanner,undefined,'Recall deliberately rests the moving light');
  let continuous=0;
  for(const e of main){continuous=e.type==='layer_shift'?continuous+eventDurationMs(e):0;assert.ok(continuous<=60000);}
});
test('layer identity/foreground validation and density are independent', () => {
  const e = event('peak'); assert.equal(e.state.foreground, 'main_voice'); assert.equal(layerCount(e.state), 5);
  assert.equal(e.state.density.intensity, .85); assert.equal(e.state.density.effectDensity, .7);
  e.state.foreground = 'noise'; assert.equal(EventSchema.safeParse(e).success, false);
  e.state.foreground = 'main_voice'; e.state.activeLayers.push('main_voice'); assert.equal(EventSchema.safeParse(e).success, false);
  const blank = event('silence').state; assert.notEqual(blank.visualState, 'black'); assert.equal(stateGains(blank).AI_VOICE, 0);
  const black = event('fractionation').fractionation!.stateA; assert.equal(black.visualState, 'black'); assert.equal(stateGains(black).AI_VOICE, 1); assert.ok(stateGains(black).drone! > 0);
});
test('fractionation cycles have ordered explicit A/B dwells, shorter later periods, and bounded text slots', () => {
  const e = program().events.filter(e => e.type === 'fractionation')[1], c = compileEvent(e);
  assert.deepEqual(c.frames.map(f => [f.atMs - e.atMs, f.marker]), [[0, '[frac:on]'], [9000, '[frac:off]'], [17000, '[frac:on]'], [23000, '[frac:off]']]);
  assert.deepEqual(c.speech.map(s => s.atMs - e.atMs), [1000, 10000, 18000, 24000]);
  const malformed = structuredClone(e); malformed.fractionation!.cycles[1].aMs = 11000;
  assert.equal(EventSchema.safeParse(malformed).success, false);
});
test('Blink shows two readable cues on the retained ring; longer eye rest is a separate state', () => {
  const e = event('blink_trigger'), c = compileEvent(e);
  assert.deepEqual(c.frames.map(f => [f.atMs - e.atMs, f.label]), [[0, 'blink:lead'], [250, 'blink:cue'], [750, 'blink:open'], [2000, 'blink:lead'], [2250, 'blink:cue'], [2750, 'blink:open'], [4000, 'blink:long_close'], [5000, 'blink:stay_closed'], [7000, 'blink:reopen']]);
  const runtime = new EventRuntime(program());
  const at = (offset: number) => presentationAt(runtime.snapshot(e.atMs + offset), c, e.atMs + offset);
  for (const offset of [250, 749, 2250, 2749]) {
    assert.equal(at(offset).blinkCue, 'BLINK'); assert.equal(at(offset).motif, 1); assert.equal(at(offset).black, 0);
  }
  for (const offset of [0, 750, 2750, 5000]) assert.equal(at(offset).blinkCue, undefined);
  assert.equal(at(4000).blinkCue, 'CLOSE'); assert.equal(at(4000).black, 1);
  assert.equal(at(7000).blinkCue, 'OPEN'); assert.equal(at(7000).motif, 1);
  assert.equal(presentationAt(runtime.snapshot(e.atMs + 8000), undefined, e.atMs + 8000).blinkCue, undefined);
  assert.equal(c.speech.length, 2);assert.equal(c.speech[0].payloadId,c.speech[1].payloadId); e.blink!.steps.pop(); assert.equal(EventSchema.safeParse(e).success, false);
});
test('spoken Blink is engine-owned cached text, word aligned, with no LLM generation', async()=>{
  const e=event('blink_trigger'), slot=compileEvent(e).speech[0];let generated=0;
  const input=EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[]});
  const dependencies={knownTriggers:[],generate:async()=>{generated++;return 'Unexpected.';},render:async(text:string)=>{assert.equal(text,'Blink');return{bytes:wav(750),words:[{word:'Blink',atMs:80}]};}};
  const rendered=await renderEventSpeech(input,dependencies,new AbortController().signal);
  assert.equal(generated,0);assert.equal(rendered.textAttempts,0);assert.equal(rendered.cueOffsetMs,80);assert.equal(slot.speech.cueAtMs,250);
  assert.deepEqual(rendered.words,[{word:'Blink',atMs:80}]);
  await assert.rejects(renderEventSpeech(input,{...dependencies,render:async()=>({bytes:wav(750),words:[]})},new AbortController().signal),/word timing/);
});
test('moving motif begins with its authored narration window and is deterministic across seek and pause', () => {
  const p = createReferenceProgram(1200000), r = new EventRuntime(p), onset = p.baseline.motifMotion!.startMs;
  const intro = r.compiled.find(c => c.event.atMs === onset)!;
  assert.equal(intro.speech[0].atMs,onset);
  const at = (time: number) => presentationAt(r.snapshot(time),r.compiled.find(c=>c.event.id===r.snapshot(time).eventId),time);
  assert.equal(at(onset-1).scanner,undefined);
  const a = at(onset+2500).scanner!, b = at(onset+7500).scanner!;
  assert.ok(a.opacity>0); assert.ok(Math.abs(a.offset-b.offset)<1e-9);
  r.tick(onset+2500); r.pause(); assert.deepEqual(at(onset+2500).scanner,a); r.resume();r.seek(onset+2500);assert.deepEqual(at(onset+2500).scanner,a);
  const blank = p.events.find(e=>e.type==='mindwipe')!;assert.equal(at(blank.atMs+blank.timing.prepMs+1000).scanner,undefined);
});
test('narration cannot claim absent motion, visible imagery in black, or unscheduled audio', () => {
  const state=program().baseline;
  assert.throws(()=>validatePresentationText('The pink ring is pulsing.',state,false,true),/Unscheduled/);
  assert.doesNotThrow(()=>validatePresentationText('The pink ring is pulsing.',state,true,true));
  assert.throws(()=>validatePresentationText('Watch the pink ring.',state,false,false),/dark/);
  assert.throws(()=>validatePresentationText('Hear the snap.',state,false,true),/sound/);
});
test('Mindwipe preparation, blank and reanchor have separate windows; blank cannot render text', async () => {
  const e = event('mindwipe'), c = compileEvent(e), calls: string[] = [];
  assert.deepEqual(c.frames.map(f => [f.atMs - e.atMs, f.marker]), [[0, '[mindwipe:start]'], [8000, '[mindwipe:blank]'], [11100, '[mindwipe:reanchor]']]);
  assert.deepEqual(c.speech.map(s => [s.atMs - e.atMs, s.endMs - e.atMs]), [[0, 6000], [11100, 15100]]);
  await assert.rejects(renderEventSpeech(EventSpeechRequestSchema.parse({ event: e, payloadId: `${e.id}:blank`, allowedTriggers: [] }), {
    generate: async () => { calls.push('LLM'); return 'Quiet.'; }, render: async () => { calls.push('TTS'); return { bytes: wav(200) }; }, knownTriggers: [],
  }, new AbortController().signal), /No LLM generation/);
  assert.deepEqual(calls, []);
  const runtime = new EventRuntime(program()); const blank = runtime.tick(e.atMs + 9000);
  assert.equal(blank.snapshot.state.narrationState, 'paused'); assert.deepEqual(blank.speech, []);
});
test('Reset completes after its active section and restores the authored presentation baseline', () => {
  const e = event('reset'), c = compileEvent(e);
  assert.deepEqual(c.frames.map(f => [f.atMs - e.atMs, f.marker]), [[0, '[reset:begin]'], [1000, '[reset:begin]'], [8800, '[reset:complete]']]);
  const r = new EventRuntime(program()); r.tick(e.atMs); const result = r.tick(e.atMs + 8800);
  assert.equal(result.snapshot.label, 'reset:complete');
  assert.deepEqual(result.snapshot.state, e.baseline);
});
test('Original/Old Self referent is canonical; authored legacy OS alias cannot become computer control', () => {
  const e = event('original_self'); assert.equal(e.originalSelf, 'original'); assert.equal(parseEngineMarker('[os:init]'), '[self:original]');
  assert.equal(parseEngineMarker('[blink:start]'), '[blink:start]'); assert.equal(parseEngineMarker('[mantra:loop:17]'), undefined);
  assert.throws(() => validateEventText('Reboot the operating system.', e), /narrative perspective/);
  assert.equal(new EventRuntime(program()).snapshot(e.atMs).originalSelf, 'original');
});
test('one generated and rendered mantra payload is reused for exactly N explicit loop slots', async () => {
  const e = event('mantra'), slots = compileEvent(e).speech; let generated = 0, rendered = 0;
  const cache = new Map<string, Awaited<ReturnType<typeof renderEventSpeech>>>();
  for (const slot of slots) if (!cache.has(slot.payloadId)) cache.set(slot.payloadId, await renderEventSpeech(EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[]}), {
    generate: async () => { generated++; return 'Quiet light.'; }, render: async () => { rendered++; return {bytes:wav(1000)}; }, knownTriggers: [],
  }, new AbortController().signal));
  assert.equal(slots.length, 3); assert.equal(generated, 1); assert.equal(rendered, 1); assert.equal(cache.size, 1);
  assert.deepEqual(slots.map(s => s.atMs - e.atMs), [0, 5400, 10800]);
});
test('measured WAV duration enforces the speech budget without extending or regenerating an event', async () => {
  const e = event('mantra'), slot = compileEvent(e).speech[0]; let count = 0;
  await assert.rejects(renderEventSpeech(EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[]}), {
    generate: async () => { count++; return 'Quiet light.'; }, render: async () => ({bytes:wav(2000)}), knownTriggers: [],
  }, new AbortController().signal), error => error instanceof SpeechWindowError && error.targetMs === 1600 && error.durationMs === 2000);
  assert.equal(count, 1); assert.equal(e.timing.activeMs, 16200);
  assert.equal(wavDurationMs(joinWav([wav(200),wav(300)])), 500);
  assert.throws(() => wavDurationMs(wav(200).subarray(0,45)), /Truncated/);
});
test('required triggers are once in the final clause, word-timed, and aligned to an engine firing offset', async () => {
  const p = withProgramTriggers(program(), { deepening: ['Bambi Sleep'] }), e = p.events.find(e => e.phase === 'deepening' && e.fractionation)!;
  assert.equal(e.fractionation!.stateA.visualState,'motif','Sleep begins on a visible scene for the spoken eyelid cue');
  assert.ok(e.fractionation!.stateA.activeLayers.includes('motif_visual'));
  const slot = compileEvent(e).speech[0]; const request = EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:['Bambi Sleep']});
  const response = await renderEventSpeech(request, { generate: async () => 'Bambi Sleep.', render: async () => ({bytes:wav(2000),words:[{word:'Bambi',atMs:0},{word:'Sleep',atMs:900}]}), knownTriggers:['Bambi','Bambi Sleep','Other Cue'] },new AbortController().signal);
  assert.equal(response.triggerOffsetMs, 0); assert.equal(slot.speech.triggerAtMs, 1500);
  assert.deepEqual(response.words,[{word:'Bambi',atMs:0},{word:'Sleep',atMs:900}]);
  assert.throws(() => validateEventText('Bambi Sleep. Bambi Sleep.', e, 'Bambi Sleep'), /once/);
  assert.throws(() => validateEventText('Other Cue. Bambi Sleep.', e, 'Bambi Sleep', ['Other Cue']), /Unscheduled/);
  await assert.rejects(renderEventSpeech(request,{generate:async()=>'Bambi Sleep.',render:async()=>({bytes:wav(1000),words:[{word:'Bambi',atMs:NaN},{word:'Sleep',atMs:500}]}),knownTriggers:[]},new AbortController().signal), /word-timed/);
});
test('reserved catalog cues reach generation and nested cues cannot reject an authorized full phrase', async () => {
  const e = event('mantra'), slot = compileEvent(e).speech[0]; let instruction = '', rendered = 0;
  const request = EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[],username:'Bambi'});
  await renderEventSpeech(request, {
    generate: async prompt => { instruction = prompt; return 'Quiet light.'; },
    render: async () => { rendered++; return {bytes:wav(1000)}; }, knownTriggers:['Bambi','Bambi Sleep','Good Girl'],
  },new AbortController().signal);
  assert.match(instruction,/Reserved cue phrases: \["Bambi Sleep","Good Girl"\]/);
  assert.match(instruction,/restrictions override persona examples and listener names/);
  assert.ok(instruction.indexOf('Persona:') < instruction.indexOf('Reserved cue phrases:'));
  assert.ok(instruction.includes('Listener label'), 'Bambi is available as an ordinary listener name');
  assert.match(instruction,/At most 2 words TOTAL/);
  assert.match(instruction,/One short phrase only/);
  assert.ok(!instruction.includes('pink-orb'), 'Internal motif identifiers are not spoken-narration context');
  assert.ok(!instruction.includes('activeLayers'), 'The model receives narration context, not renderer layer identities');
  assert.equal(rendered,1);
  assert.equal(validateEventText('Quiet. Bambi Sleep.',e,'Bambi Sleep',['Bambi','Bambi Reset']),'Quiet. Bambi Sleep.');
  assert.equal(validateEventText('Bambi, quiet. Bambi Sleep.',e,'Bambi Sleep',['Bambi']),'Bambi, quiet. Bambi Sleep.');
  assert.throws(()=>validateEventText('Bambi Sleep. Bambi.',e,'Bambi',['Bambi Sleep']),/once/);
  assert.throws(()=>validateEventText('Bambi Sleep.',e,'Bambi',['Bambi Sleep']),/final clause/);
  await assert.rejects(renderEventSpeech(request,{
    generate:async()=>'Bambi Reset.',render:async()=>{rendered++;return {bytes:wav(1000)};},knownTriggers:['Bambi','Bambi Reset'],
  },new AbortController().signal),/Unscheduled/);
  assert.equal(rendered,1,'Invalid speech never reaches TTS');
});
test('short scheduled cue windows budget the required phrase and forbid descriptive expansion', async () => {
  const p = withProgramTriggers(program(), { deepening: ['Bambi Sleep'] });
  const e = p.events.find(e => e.phase === 'deepening' && e.fractionation)!;
  e.fractionation!.speechA.wordTarget = 1; // A pace estimate cannot exclude the required words.
  const slot = compileEvent(e).speech[0]; let budget = 0, instruction = '';
  const response = await renderEventSpeech(EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:['Bambi Sleep']}), {
    generate: async (prompt, _signal, words) => { budget = words; instruction = prompt; return 'Bambi Sleep.'; },
    render: async () => ({bytes:wav(1000),words:[{word:'Bambi',atMs:0},{word:'Sleep',atMs:500}]}),
    knownTriggers:['Bambi','Bambi Sleep'],
  },new AbortController().signal);
  assert.equal(budget,2); assert.match(instruction,/At most 2 words TOTAL/);
  assert.ok(!instruction.includes('at most 1 words'), 'All budget instructions include the required phrase');
  assert.match(instruction,/Prefer the required phrase alone: "Bambi Sleep"/);
  assert.match(instruction,/at most 0 words/); assert.equal(response.triggerOffsetMs,0);
  assert.equal(slot.speech.triggerAtMs,1500); assert.equal(response.targetMs,4000);
});
test('event speech exposes only measured spoken pink positions without a trigger', async () => {
  const e=event('layer_shift'), slot=compileEvent(e).speech[0];
  const response=await renderEventSpeech(EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[]}),{
    generate:async()=>'Pink, pinkish, pink.', render:async()=>({bytes:wav(1000),words:[{word:'Pink,',atMs:100},{word:'pinkish',atMs:300},{word:'pink',atMs:700}]}),knownTriggers:[],
  },new AbortController().signal);
  assert.deepEqual(response.pinkOffsetsMs,[100,700]);assert.equal(response.triggerOffsetMs,undefined);
  const untimed=await renderEventSpeech(EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[]}),{
    generate:async()=>'Pink.',render:async()=>({bytes:wav(1000)}),knownTriggers:[],
  },new AbortController().signal);
  assert.equal(untimed.pinkOffsetsMs,undefined,'No inferred flash timing from text alone');
});
test('final return gives closing and ordinary-awareness instructions without recalling the fictional motif', async () => {
  const p = program(), e = p.events.at(-1)!, slot = compileEvent(e).speech[0]; let instruction = '';
  const response = await renderEventSpeech(EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[],motif:p.motifs[0]}), {
    generate: async prompt => { instruction = prompt; return 'The session is ending. Notice your surroundings. Move freely; natural blinking is welcome.'; },
    render: async () => ({bytes:wav(4000)}), knownTriggers:[],
  },new AbortController().signal);
  assert.match(instruction,/Clearly say the session is ending/);
  assert.match(instruction,/ordinary surroundings, freedom to move and natural blinking/);
  assert.ok(!instruction.includes('Established original motif'));
  assert.equal(response.targetMs,slot.speech.targetMs); assert.equal(e.timing.activeMs,30000);
});
test('invalid event text has one bounded correction before a single render; cancellation and repeated failure stop it', async () => {
  const e = event('mantra'), slot = compileEvent(e).speech[0]; let generated = 0, rendered = 0;
  const request = EventSpeechRequestSchema.parse({event:e,payloadId:slot.payloadId,allowedTriggers:[]});
  const response = await renderEventSpeech(request, {
    generate: async prompt => { generated++; if (generated===1) return 'Pet, quiet.'; assert.match(prompt,/ONE CORRECTION/); return 'Quiet light.'; },
    render: async () => { rendered++; return {bytes:wav(1000)}; }, knownTriggers:['Bambi'],
  },new AbortController().signal);
  assert.equal(generated,2); assert.equal(rendered,1); assert.equal(response.textAttempts,2);
  generated=0;rendered=0;
  await assert.rejects(renderEventSpeech(request,{
    generate:async()=>{generated++;return 'Far too many words in this short window.';},
    render:async()=>{rendered++;return {bytes:wav(1000)};},knownTriggers:[],
  },new AbortController().signal),/word limit/);
  assert.equal(generated,2);assert.equal(rendered,0);
  const stop=new AbortController();generated=0;
  await assert.rejects(renderEventSpeech(request,{
    generate:async()=>{generated++;stop.abort(Error('Stopped'));return 'Bambi';},
    render:async()=>{rendered++;return {bytes:wav(1000)};},knownTriggers:['Bambi'],
  },stop.signal),/Stopped/);
  assert.equal(generated,1);assert.equal(rendered,0);
});
test('engine word/cue grammars reach native event decoding without changing ordinary conversation requests', async () => {
  const grammar = eventTextGrammar(16), exact = eventTextGrammar(2,'Bambi Sleep');
  assert.equal(eventTextGrammar(16,undefined,['Bambi']),grammar,'A listener name must not be blocked by the native word grammar');
  assert.match(grammar,/\{0,15\}/); assert.equal(exact,'root ::= "Bambi Sleep" [.!?]?');
  assert.throws(()=>eventTextGrammar(0),/word budget/);
  assert.throws(()=>eventTextGrammar(1,'Bambi Sleep'),/exact event phrase/);
  const original=globalThis.fetch, requests:any[]=[];
  globalThis.fetch=async (_url,init)=>{
    requests.push(JSON.parse(String(init?.body)));
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Quiet.'}}]})+'\n');
  };
  try {
    const queue=new InferenceQueue(), backend=new LlamaBackend('http://127.0.0.1:18080'),signal=new AbortController().signal;
    for await (const _ of queue.stream(backend,[],'fixture',signal,4096,64,'qwen')) {}
    for await (const _ of queue.stream(backend,[],'fixture',signal,4096,64,'qwen',grammar)) {}
    assert.ok(!('grammar' in requests[0]));assert.equal(requests[1].grammar,grammar);
  } finally {globalThis.fetch=original;}
});
test('trigger introduction, reinforcement, establishment, cooldown and teardown are deterministic', () => {
  const t = new TriggerLifecycle(); t.plan('cue',1000,'deepening');
  assert.equal(t.snapshot(0)[0].status,'planned'); assert.equal(t.fire('cue',0),true);
  assert.equal(t.snapshot(500)[0].status,'cooldown'); assert.equal(t.fire('cue',999),false);
  assert.equal(t.snapshot(1000)[0].status,'introduced'); assert.equal(t.fire('cue',1000),true);
  assert.equal(t.snapshot(2000)[0].status,'reinforcing'); assert.equal(t.fire('cue',2000),true);
  assert.equal(t.snapshot(3000)[0].status,'established_for_session'); assert.deepEqual(t.snapshot(3000)[0].preferredPhases,['deepening']);
  t.clear(); assert.deepEqual(t.snapshot(4000),[]);
  const p = withProgramTriggers(program(),{deepening:['cue']}); p.events.find(e=>e.fractionation)!.fractionation!.speechA.triggerCooldownMs=30000;
  assert.throws(()=>new EventRuntime(p),/cooldown/);
});
test('Pause freezes event state and delivery; seeking cannot replay expired slots or queued haptics', () => {
  const r = new EventRuntime(withHapticMappings(program())), e = event('fractionation');
  r.tick(e.atMs + 1000); r.pause();
  assert.equal(r.tick(e.atMs + 10000).snapshot.label,'narrow:0'); assert.deepEqual(r.tick(e.atMs + 10000).speech,[]);
  r.resume(); r.seek(e.atMs + 10000); assert.deepEqual(r.tick(e.atMs + 10000).speech,[]); assert.deepEqual(r.tick(e.atMs + 10000).haptics,[]);
  assert.equal(r.tick(e.atMs + 17000).snapshot.label,'narrow:1');
});

test('speech haptics use compiled word times in every fractionation and motif recall, including each Blink',()=>{
 const p=withHapticMappings(withProgramTriggers(program(),{deepening:['test cue'],conditioning:['test cue'],anchor:['test cue']}));
 let recalls=0,blinkCues=0;
 for(const e of p.events){
  const compiled=compileEvent(e);
  for(const slot of compiled.speech.filter(s=>s.speech.requiredTrigger||s.speech.fixedCue)){
   const actions=e.haptics.filter(a=>a.speechSlotId===slot.id);assert.equal(actions.length,1);
   assert.equal(e.atMs+actions[0].offsetMs,slot.atMs+(slot.speech.triggerAtMs??slot.speech.cueAtMs!));
   if(e.type==='motif_recall')recalls++;
   if(slot.speech.fixedCue)blinkCues++;
  }
 }
 assert.ok(recalls>0);assert.equal(blinkCues,2);
 const fraction=p.events.find(e=>e.fractionation&&e.phase==='deepening')!;
 assert.equal(fraction.haptics[0].offsetMs,2500,'Includes the transition before speech and the cue inside speech');
 const runtime=new EventRuntime(p);runtime.tick(fraction.atMs);runtime.tick(fraction.atMs+1000);
 assert.deepEqual(runtime.tick(fraction.atMs+2500).haptics,[],'A timer cannot fire a cue when narration was not played');
 const invalid=structuredClone(fraction);invalid.haptics[0].speechSlotId='missing';assert.throws(()=>compileEvent(invalid),/Speech-bound/);
 invalid.haptics[0].speechSlotId=fraction.haptics[0].speechSlotId;invalid.haptics[0].offsetMs=0;assert.throws(()=>compileEvent(invalid),/Speech-bound/);
});
test('final return withdraws layers before completion and clears all temporary mechanism flags', () => {
  const p = withHapticMappings(program()), r = new EventRuntime(p), e = p.events.at(-1)!;
  const counts = e.softReturn!.steps.map(s=>s.state.activeLayers.length); assert.deepEqual(counts,[3,3,2,1]);
  assert.equal(r.snapshot(e.atMs + e.timing.activeMs*.8).state.narrationState,'paused');
  const end = r.tick(p.durationMs).snapshot;
  for (const key of ['fractionation','blink','mindwipe','reset','mantra','peak'] as const) assert.equal(end[key],false);
  assert.equal(end.originalSelf,null); assert.equal(end.complete,true); assert.deepEqual(end.state,p.baseline);
  assert.equal(r.motifs.size,0); assert.deepEqual(r.triggers.snapshot(p.durationMs),[]);
  assert.deepEqual(r.tick(p.durationMs+100).haptics,[]);
});
test('Hard Stop cancels every future event, speech slot, loop, motif and actuator action', () => {
  const r = new EventRuntime(withHapticMappings(program())); r.tick(0); const revision=r.revision; r.stop();
  assert.ok(r.revision>revision);
  for (let time=1000;time<=300000;time+=1000) { const out=r.tick(time); assert.deepEqual(out.speech,[]); assert.deepEqual(out.haptics,[]); assert.deepEqual(out.frames,[]); assert.equal(out.snapshot.complete,true); }
  assert.equal(r.motifs.size,0);
});
test('motif introduction and recalls retain one identity and update session-local recurrence history', () => {
  const r=new EventRuntime(program()); r.tick(0);
  assert.equal(r.motifs.get('pink-orb')!.useCount,1); assert.equal(r.motifs.get('pink-orb')!.lastUsedAtMs,0);
  const recall=event('motif_recall'); r.tick(recall.atMs);
  assert.equal(r.motifs.get('pink-orb')!.lastUsedAtMs,recall.atMs);
  assert.equal(r.motifs.get('pink-orb')!.textAnchor,program().motifs[0].textAnchor);
  r.stop(); assert.equal(r.motifs.size,0);
});
test('event TTS isolates one voice and removes preset-managed pause/side/echo layers', async () => {
  const original=globalThis.fetch; let body:any;
  globalThis.fetch=async(_url,input)=>{body=JSON.parse(input!.body as string);return new Response(JSON.stringify({audio:Buffer.from(wav(500)).toString('base64'),timestamps:[],text:'Quiet.'})+'\n');};
  try {
    for await(const _ of new Kokoro().speak('Quiet.','af_heart',.78,new AbortController().signal,'bambi_classic',[],true)) {}
    assert.equal(body.overrides.processing.echoEnabled,false); assert.equal(body.overrides.layers.left_voice.enabled,false);
    assert.deepEqual(body.overrides.timing,{normal:0,short:0,medium:0,long:0,transition:0});
    assert.equal(body.trigger,undefined);
  } finally {globalThis.fetch=original;}
});
test('crossfade/audio-first/visual-first envelopes have explicit ordering and independent silence dimensions', () => {
  const e = event('fractionation'), c = compileEvent(e), r = new EventRuntime(program());
  const b = c.frames[1]; b.transition={kind:'audio_first',durationMs:1000,subtitle:'clear'};
  let projection=presentationAt(r.snapshot(b.atMs+250),c,b.atMs+250);
  assert.ok(projection.gains.drone!>0); assert.equal(projection.motif,0); assert.equal(projection.black,1);
  b.transition.kind='visual_first'; projection=presentationAt(r.snapshot(b.atMs+250),c,b.atMs+250);
  assert.equal(projection.motif,.5); assert.equal(projection.black,.5);
  b.transition.kind='blur'; assert.equal(presentationAt(r.snapshot(b.atMs+500),c,b.atMs+500).blurPx,8);
  b.transition.kind='zoom'; assert.equal(presentationAt(r.snapshot(b.atMs+500),c,b.atMs+500).zoom,1.1);
  const silence = event('silence'); silence.audio.push({offsetMs:0,bus:'AI_VOICE',gain:1,durationMs:0});
  const silentCompiled=compileEvent(silence), snapshot={...r.snapshot(silence.atMs),state:silence.state};
  assert.equal(presentationAt(snapshot,silentCompiled,silence.atMs).gains.AI_VOICE,0);
});
test('a prepared peak introduces its declared layers during entry instead of cutting them all in after preparation', () => {
  const e=event('peak'); e.timing.prepMs=1000; e.entry={kind:'visual_first',durationMs:1000,subtitle:'clear'};
  e.state.activeLayers.push('noise'); const c=compileEvent(e);
  const snapshot={...new EventRuntime(program()).snapshot(e.atMs),state:c.frames[0].state};
  const early=presentationAt(snapshot,c,e.atMs+250);
  assert.equal(early.canvas,.5); assert.equal(early.gains.noise,0);
  const late=presentationAt(snapshot,c,e.atMs+750);
  assert.equal(late.canvas,1); assert.ok(late.gains.noise!>0);
  assert.equal(c.speech[0].atMs,e.atMs+1000);
});
test('invalid phase crossings, duplicate/overlapping events and speech across closing blank are rejected', () => {
  const p=program(); p.events[0].timing.activeMs=80000; assert.equal(ProgramSchema.safeParse(p).success,false);
  const duplicate=program(); duplicate.events.push(duplicate.events[0]); assert.equal(ProgramSchema.safeParse(duplicate).success,false);
  const closing=event('soft_return'); // local return remains legal; final return must fit its own silent stage.
  const final=program().events.at(-1)!; final.speech.targetMs=final.timing.activeMs;
  assert.throws(()=>compileEvent(final),/engine-only/);
  closing.state.activeLayers.push('haptics'); closing.haptics.push({offsetMs:closing.timing.activeMs-50,command:{type:'device',channel:'vib',operation:'buzz',intensity:.1,durationMs:150}});
  assert.equal(EventSchema.safeParse(closing).success,false);
});
