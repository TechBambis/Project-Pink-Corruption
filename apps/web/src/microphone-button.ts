// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export type MicrophoneState='muted'|'starting'|'ready'|'listening'|'transcribing'|'waiting';
export type MicrophoneActivity='idle'|'preparing'|'thinking'|'speaking';
export const microphoneStatus:Record<MicrophoneState,string>={
 muted:'Mic off',starting:'Getting ready',ready:'Ready to listen',
 listening:'Listening',transcribing:'Recognizing speech',waiting:'Waiting for playback',
};

/** A stable button DOM keeps keyboard focus and the listening animation intact. */
export function renderMicrophoneButton(button:HTMLElement,state:MicrophoneState,activity:MicrophoneActivity='idle'){
 if(!button.classList.contains('voice-toggle')){
  button.classList.add('voice-toggle');
  button.innerHTML='<span class="voice-toggle-icon" aria-hidden="true"><svg class="voice-toggle-mic-on" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg><svg class="voice-toggle-mic-off" viewBox="0 0 24 24"><path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.11 1.23M12 19v3M8 22h8"/></svg></span><span class="voice-toggle-copy"><span class="voice-toggle-action"></span><span class="voice-toggle-state"></span></span><span class="voice-toggle-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
  const status=button.querySelector<HTMLElement>('.voice-toggle-state')!;
  status.id=button.id+'-state';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  button.setAttribute('aria-describedby',status.id);
 }
 if(button.dataset.captureState===state&&button.dataset.activity===activity)return;
 const enabled=state!=='muted';
 const display=['starting','listening','transcribing'].includes(state)?state:activity!=='idle'?activity:state;
 const text=display==='speaking'?'Speaking':display==='thinking'?'Thinking':display==='preparing'?'Preparing':microphoneStatus[state];
 button.dataset.captureState=state;button.dataset.activity=activity;
 button.dataset.state=display;button.classList.toggle('listening',state==='listening');
 button.setAttribute('aria-pressed',String(enabled));
 button.setAttribute('aria-label',enabled?'Mute microphone':'Turn microphone on');
 button.setAttribute('aria-busy',String(state==='starting'||state==='transcribing'||display==='thinking'||display==='preparing'));
 button.title=text+'. '+(enabled?'Microphone on. Click to mute.':'Microphone off. Click to unmute.');
 button.querySelector('.voice-toggle-action')!.textContent=enabled?'Mute':'Unmute';
 button.querySelector('.voice-toggle-state')!.textContent=text;
}
