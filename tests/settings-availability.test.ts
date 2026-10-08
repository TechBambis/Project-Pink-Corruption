// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsAvailability, type SettingsContext} from '../apps/web/src/settings-availability';

function context(overrides: Partial<SettingsContext> = {}, disabled: string[] = [], values: Record<string, string> = {}): SettingsContext {
  return {file:false, events:false, narration:true, sceneTimeline:false, scene:'Particle Drift',
    originalDroneAvailable:true, cloudCuesAvailable:false,
    on:id=>!disabled.includes(id), value:id=>values[id]??({'voice2':'af_sarah', 'audio-preset':'bambi_classic', 'device-rot-channel':'1', 'device-bridge':'local', 'prompt-template':'bambisleep-classic', 'ai-mode':'voice'}[id]??''),
    ...overrides};
}

test('Guided ownership blocks legacy overrides but preserves real spiral, voice and device controls', () => {
  const reasons=settingsAvailability(context({events:true}, ['reduced']));
  for(const id of ['scene','visual-opacity','motion','density','dual-voice','adaptive-delivery','tick-enabled','sound-defaults','device-phase-defaults','trigger-effect-pause']) assert.ok(reasons[id],id);
  for(const id of ['spiral-speed','spiral-style','voice2','voice-mix','speed','guided-style','trigger-snap-db','event-haptics','device-vib-max','device-rot-max','device-speech-accents','reduced','subtitles']) assert.equal(reasons[id],undefined,id);
  assert.match(reasons.persona,/Choose Custom/);
});

test('Files disable generated audio without disabling original audio or companion voice settings', () => {
  const reasons=settingsAvailability(context({file:true, narration:false}, ['reduced']));
  for(const id of ['tick-enabled','brainwave-enabled','trigger-sound','breath-sound','bus-effects','bus-ambient','duration','background-drone']) assert.match(reasons[id],/Files|file|playlist/,id);
  for(const id of ['bus-session','bus-voice','voice','mic-playback-mode','subtitles','visuals-enabled','device-vib-max']) assert.equal(reasons[id],undefined,id);
});

test('Prerequisites unlock dependent controls without changing checked values', () => {
  const disabled=['reduced','trigger-snap','trigger-moan','tick-enabled','brainwave-enabled','device-speech-accents','trigger-timing-enabled'];
  const blocked=settingsAvailability(context({},disabled,{'voice2':''}));
  for(const id of ['trigger-snap-db','trigger-moan-variant','tick-defaults','brainwave-volume','device-accent-duration','trigger-stage-groups','voice-mix']) assert.ok(blocked[id],id);
  for(const id of ['trigger-snap','trigger-moan','tick-enabled','brainwave-enabled','device-speech-accents','trigger-timing-enabled','voice2']) assert.equal(blocked[id],undefined,id);
  const restored=settingsAvailability(context({},['reduced']));
  for(const id of ['trigger-snap-db','trigger-moan-variant','tick-defaults','brainwave-volume','device-accent-duration','trigger-stage-groups','voice-mix']) assert.equal(restored[id],undefined,id);
});

test('Gentle motion and spiral renderer disable ineffective generic animation controls', () => {
  const still=settingsAvailability(context({scene:'Spiral Focus'}));
  for(const id of ['motion','density','spiral-speed','visual-reactivity']) assert.ok(still[id],id);
  const moving=settingsAvailability(context({scene:'Spiral Focus'},['reduced']));
  assert.ok(moving.motion);assert.ok(moving.density);assert.equal(moving['spiral-speed'],undefined);
  const particles=settingsAvailability(context({},['reduced']));
  assert.equal(particles.motion,undefined);assert.equal(particles.density,undefined);
});

test('Visuals off preserves captions and an available way to enable visuals', () => {
  const reasons=settingsAvailability(context({},['visuals-enabled','reduced']));
  assert.ok(reasons['spiral-style']);assert.ok(reasons['breath-visuals']);
  assert.equal(reasons['visuals-enabled'],undefined);assert.equal(reasons.subtitles,undefined);
});

test('Imported scene timeline blocks manual presentation but not captions or safety settings', () => {
  const reasons=settingsAvailability(context({sceneTimeline:true},['reduced']));
  assert.match(reasons.scene,/timeline/);assert.ok(reasons['phase-visuals']);
  assert.ok(reasons['spiral-style']);assert.ok(reasons['immersive-presets']);
  assert.equal(reasons.reduced,undefined);assert.equal(reasons.subtitles,undefined);
});

test('Recorded noise locks generated noise controls only when the original recording actually exists', () => {
  assert.match(settingsAvailability(context({},['reduced']))['background-noise-type'],/recorded/);
  const generated=settingsAvailability(context({originalDroneAvailable:false},['reduced']));
  assert.equal(generated['background-noise-type'],undefined);assert.match(generated['original-sounds'],/not installed/);
});

test('Unassigned rotation and UDP bridge leave limits editable while disabling inapplicable options', () => {
  const reasons=settingsAvailability(context({},['reduced'],{'device-rot-channel':'0','device-bridge':'upstream'}));
  assert.ok(reasons['device-random-rotation']);assert.ok(reasons['device-write-char']);
  for(const id of ['device-rot-channel','device-rot-max','device-vib-max','device-enabled']) assert.equal(reasons[id],undefined,id);
});

test('Chat custom text and Guided style have independent applicability', () => {
  const chat=settingsAvailability(context({},['reduced'],{'prompt-template':'custom'}));
  assert.equal(chat.persona,undefined);assert.ok(chat['guided-style']);
  const guided=settingsAvailability(context({events:true},['reduced'],{'prompt-template':'gentle-induction'}));
  assert.ok(guided.persona);assert.equal(guided['guided-style'],undefined);
  const silent=settingsAvailability(context({events:true},['reduced'],{'ai-mode':'text'}));
  assert.match(silent['guided-style'],/Read replies aloud/);
});
