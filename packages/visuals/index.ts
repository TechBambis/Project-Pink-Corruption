// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {BreathVisualState,BreathOverlay,emptyBreathFrame} from './breath-sync';
import type {BreathCue} from '../speech/breath';
import { StableSpiral, type StableSpiralSettings } from './stable';
import { clamp, sceneNames } from '../safety/actions';
import { TriggerVisualState, emptyTriggerFrame, triggerEffectFor, type TriggerEffect } from './trigger-effects';
import { TriggerOverlay } from './trigger-overlay';
import {DescentVisualState,DescentOverlay,emptyDescentFrame} from './descent';
import { CanvasRenderer } from './canvas-renderer';
import { visualResolution } from './resolution';
import { AudioReactivity, silentVisualSignal, type AudioVisualSignal } from './audio-reactivity';
import { ImmersiveSpiral } from './immersive';
export type Scene=typeof sceneNames[number];
const vertex=`attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment=`precision mediump float;varying vec2 uv;uniform vec2 resolution;uniform float time;uniform float intensity;uniform float audio;uniform float scene;uniform float density;uniform float pulse;uniform float effect;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);float r=length(p),a=atan(p.y,p.x);vec3 plum=vec3(.064,.028,.10),pink=vec3(.87,.34,.72),teal=vec3(.13,.57,.57);float glow=exp(-r*3.3);vec3 c=plum+mix(teal,pink,.5+.5*sin(a+time*.13))*glow*.25;
if(scene<.5||effect>0.5&&effect<1.5){float phase=a*2.+log(r+.09)*12.-time*(.22+intensity*.65);float ribbon=.5+.5*sin(phase);float edge=smoothstep(.55,.88,ribbon);float halo=pow(ribbon,7.);c+=mix(teal,pink,.5+.5*sin(phase+1.5))*(edge*.22+halo*.24)*exp(-r*.9)*(scene<.5?1.:pulse);c+=pink*pow(.5+.5*cos(phase+.8),24.)*.08*(scene<.5?1.:pulse);}
if(scene>.5&&scene<1.5){float tunnel=pow(.5+.5*sin(log(r+.06)*20.-time*(.3+intensity)),14.);float spokes=pow(.5+.5*cos(a*8.+time*.14),6.);c+=mix(teal,pink,.5+.5*sin(r*6.+time*.2))*tunnel*(.2+.15*spokes);}
if(scene>1.5&&scene<2.5){c+=pink*exp(-r*1.8)*(.12+.04*sin(time*.35));}
if(scene<3.5||effect>1.5){for(int i=0;i<40;i++){float fi=float(i);if(fi>(effect>1.5?pulse*40.:density*40.))break;vec2 seed=vec2(hash(vec2(fi,2.)),hash(vec2(fi,7.)));vec2 q=(seed-.5)*vec2(resolution.x/resolution.y,1.6);q.x+=sin(time*.08+fi)*.06;q.y=mod(q.y+time*.009*(.2+seed.x)+.8,1.6)-.8;float d=length(p-q);c+=mix(teal,pink,seed.x)*.005/(d*d*900.+.035);}}
c+=mix(pink,teal,.5)*exp(-r*6.)*(audio*.2+pulse*.08);if(scene>3.5&&scene<4.5)c=plum+mix(pink,teal,.5)*exp(-r*6.)*pulse*.05;c*=1.-smoothstep(.3,1.1,length(uv-.5));if(scene>5.5)c=vec3(.026,.015,.039);gl_FragColor=vec4(c,1.);}`;
export class VisualEngine {
 voiceSync=true;tickSync=true;reactionStrength=.65;reactiveAmount=0;
 private reactivity=new AudioReactivity();
 private immersive!:ImmersiveSpiral;
 fixation:'none'|'dot'|'heart'='none';
 private focusWell=document.createElement('div');
 private fixationLayer=document.createElement('div');
 stable!:StableSpiral;stableSettings:StableSpiralSettings={speed:1,complexity:1,alpha:1,colorA:'#c700c7',colorB:'#ff82ff',mode:'classic'};
 private lastPulseTime=0;private triggers=new TriggerVisualState();private overlay:TriggerOverlay;opacity=1;gl!:WebGLRenderingContext;private program!:WebGLProgram;private quad!:WebGLBuffer;scene:Scene='Spiral Focus';reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;quality=1;fps=60;private frames=0;private last=0;private sample=0;private frameMs=16.7;pulse=0;effect:'pulse'|'spiral'|'particles'='pulse';motion=1;density=.7;private observer:ResizeObserver;
 private breath=new BreathVisualState();private breathOverlay:BreathOverlay;
 private descent=new DescentVisualState();
 private descentOverlay:DescentOverlay;
 private fallback:CanvasRenderer|null=null;
 private failed=false;
 private slowSamples=0;private fastSamples=0;
 /** Share GPU time with local inference without changing the session/audio clocks. */
 busy=false;
 get backend(){return this.failed?'unavailable':this.fallback?'canvas2d':'webgl';}
 constructor(public canvas:HTMLCanvasElement, effectHost?:HTMLElement){
  this.breathOverlay=new BreathOverlay(canvas);
  this.descentOverlay=new DescentOverlay(canvas);
  this.overlay=new TriggerOverlay(canvas,effectHost);
  canvas.parentElement?.style.setProperty('--heart-clear-size','clamp(144px,20vmin,216px)');
  this.focusWell.dataset.focusWell='heart';this.focusWell.setAttribute('aria-hidden','true');
  this.focusWell.style.cssText='position:absolute;left:50%;top:50%;width:var(--heart-clear-size,clamp(144px,20vmin,216px));height:var(--heart-clear-size,clamp(144px,20vmin,216px));display:none;pointer-events:none;z-index:3;transform:translate(-50%,-50%);background:radial-gradient(circle closest-side,#140c1d 0 68%,#140c1d00 100%);';
  canvas.parentNode?.appendChild(this.focusWell);
  this.fixationLayer.dataset.fixationLayer='focus';this.fixationLayer.setAttribute('aria-hidden','true');
  this.fixationLayer.style.cssText='position:absolute;left:50%;top:50%;width:clamp(88px,12vmin,128px);height:clamp(88px,12vmin,128px);display:none;align-items:center;justify-content:center;line-height:1;color:#ff87ce;text-shadow:0 0 24px #ff39b7;pointer-events:none;z-index:3;transform:translate(-50%,-50%);';
  canvas.parentNode?.appendChild(this.fixationLayer);
  this.observer=new ResizeObserver(()=>this.resize());
  try{
   const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});
   if(!gl)throw Error('WebGL unavailable');
   this.gl=gl;this.stable=new StableSpiral(canvas,gl);this.immersive=new ImmersiveSpiral(gl);this.program=this.create(vertex,fragment);this.quad=gl.createBuffer()!;
   gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
   canvas.dataset.renderer='webgl';
  }catch(error){this.useFallback(error);}
  this.observer.observe(this.canvas);this.resize();
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(!this.fallback&&!this.failed)this.useFallback('WebGL context lost');});
 }
 private useFallback(reason:unknown){
  // A canvas with a WebGL context cannot subsequently acquire a 2D context.
  const previous=this.canvas,next=previous.cloneNode(false) as HTMLCanvasElement;
  try{
   this.fallback=new CanvasRenderer(next);previous.replaceWith(next);this.canvas=next;
   next.dataset.renderer='canvas2d';next.dataset.rendererReason=String(reason);
   this.overlay.setCanvas(next);this.observer.unobserve(previous);this.observer.observe(next);
   this.enabled=this.visible;this.resize();
  }catch(error){this.failed=true;previous.dataset.renderer='unavailable';previous.dataset.rendererReason=String(error);this.enabled=false;}
 }
 private create(vs:string,fs:string){const gl=this.gl;const shader=(type:number,code:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Shader error');return s;};const p=gl.createProgram()!;gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'Shader link failed');return p;}
 resize(){const rect=this.canvas.getBoundingClientRect();const limit=this.backend==='webgl'?Math.min(8192,...this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS)):8192;const size=visualResolution(rect.width,rect.height,devicePixelRatio,this.quality,limit);if(this.canvas.width!==size.width||this.canvas.height!==size.height){this.canvas.width=size.width;this.canvas.height=size.height;}if(this.backend==='webgl')this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}
 private wasFullscreen=false;
 private visible=true;
 get enabled(){return this.visible;}
 set enabled(value:boolean){value=value&&!this.failed;if(value!==this.visible||!value){this.pulse=0;this.clearVoiceReaction();this.clearTrigger();this.clearDescent();this.clearBreath();}this.visible=value;this.canvas.style.visibility=value?'visible':'hidden';if(!value){this.fixationLayer.style.display='none';this.focusWell.style.display='none';if(this.canvas.parentElement)this.canvas.parentElement.dataset.centerFocus='none';this.canvas.style.maskImage='none';this.canvas.style.setProperty('-webkit-mask-image','none');}}
 render(time:number,intensity:number,audio:number,wall:number,effectTime=time,descentTime=effectTime,signal:AudioVisualSignal=silentVisualSignal){const fullscreen=!!document.fullscreenElement&&document.fullscreenElement===this.canvas.parentElement;if(fullscreen!==this.wasFullscreen){this.wasFullscreen=fullscreen;this.resize();}if(!this.enabled){this.lastPulseTime=time;this.last=wall;this.sample=wall;this.frames=0;this.slowSamples=this.fastSamples=0;return;}const targetFps=this.busy?30:60;if(wall-this.last<1000/targetFps-1)return;const breathing=this.breath.frame(descentTime,this.reduced);this.breathOverlay.update(breathing);this.descentOverlay.update(this.descent.frame(descentTime,this.reduced));const trigger=this.triggers.frame(effectTime,this.reduced);this.overlay.update(trigger);const decay=Math.exp(-Math.max(0,time-this.lastPulseTime)*3.7);this.lastPulseTime=time;this.pulse*=decay;this.canvas.style.setProperty('--visual-opacity',String(clamp(this.opacity)));this.frameMs=this.frameMs*.95+(wall-this.last)*.05;this.last=wall;if(!this.sample)this.sample=wall;this.frames++;if(wall-this.sample>=1000){this.fps=this.frames*1000/(wall-this.sample);this.frames=0;this.sample=wall;this.slowSamples=this.fps<targetFps*.7?this.slowSamples+1:0;this.fastSamples=this.fps>=targetFps*.92?this.fastSamples+1:0;if(this.slowSamples>=3&&this.quality>.5){this.quality=Math.max(.5,this.quality-.15);this.slowSamples=0;this.resize();}else if(this.fastSamples>=5&&this.quality<1){this.quality=Math.min(1,this.quality+.15);this.fastSamples=0;this.resize();}}
 const gl=this.gl;const t=this.reduced?0:time*this.motion;const scene=sceneNames.indexOf(this.scene);const combinedPulse=this.reduced?0:Math.max(this.pulse,trigger.impulse);
 this.reactiveAmount=this.reactivity.frame(signal,this.reactionStrength,this.voiceSync,this.tickSync,this.reduced);
 const visualAmount=scene===0&&this.stableSettings.style==='orb'?this.reactiveAmount:this.reactivity.voiceAmount;
 // Voice changes light, never the scene's scale. Tick/trigger geometry stays separate.
 const reaction=this.reduced?0:clamp((scene===0&&this.stableSettings.style==='orb'?this.reactivity.tickAmount:0)+combinedPulse*clamp(this.reactionStrength)*.5);
 const voiceLight=this.reduced?0:this.reactivity.voiceAmount;
 this.canvas.style.filter=`brightness(${1+voiceLight*.28})`;
 this.fixationLayer.style.filter=`brightness(${1+voiceLight*.4})`;
 const focusReaction=this.reduced?0:clamp((this.fixation==='heart'?this.reactivity.tickAmount:0)+combinedPulse*clamp(this.reactionStrength)*.5);
 const scenePulse=Math.max(combinedPulse,visualAmount*.65);
 this.fixationLayer.style.display=this.fixation!=='none'&&this.scene!=='Audio Only'&&!breathing.active?'flex':'none';
 const heart=this.fixation==='heart'&&this.scene!=='Audio Only'&&!breathing.active;
 this.focusWell.style.display=heart?'block':'none';
 if(this.canvas.parentElement)this.canvas.parentElement.dataset.centerFocus=this.scene==='Audio Only'||breathing.active?'none':this.fixation;
 const focusMask=heart?'radial-gradient(circle at center,transparent calc(var(--heart-clear-size,clamp(144px,20vmin,216px)) * .34),#000 calc(var(--heart-clear-size,clamp(144px,20vmin,216px)) * .5))':'none';
 this.canvas.style.maskImage=focusMask;this.canvas.style.setProperty('-webkit-mask-image',focusMask);
 this.fixationLayer.textContent=this.fixation==='heart'?'♥':'•';this.fixationLayer.style.fontSize=this.fixation==='heart'?'clamp(48px,7vmin,72px)':'30px';
 this.fixationLayer.style.transform=`translate(-50%,-50%) scale(${1+focusReaction*(this.fixation==='heart'?.45:.18)})`;
 if(!this.fallback&&gl.isContextLost())this.useFallback('WebGL context lost');
 if(this.failed)return;
 if(this.fallback){this.fallback.render(this.scene,scene===0?time:t,this.stableSettings,this.reduced,this.density*this.quality,scene===0?combinedPulse:scenePulse,clamp(audio),reaction);return;}
 try{
 if(scene===1||scene===0&&this.stableSettings.style&&this.stableSettings.style!=='original'){this.immersive.render(this.canvas.width,this.canvas.height,this.reduced?0:time,scene===1?{...this.stableSettings,style:'tunnel'}:this.stableSettings,this.reduced,reaction,this.quality);return;}
 if(scene===0){this.stable.configure(this.stableSettings,this.reduced,reaction);this.stable.frame(this.reduced?0:time+combinedPulse*.5);return;}gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);let attr=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);gl.uniform2f(gl.getUniformLocation(this.program,'resolution'),this.canvas.width,this.canvas.height);for(const [key,value] of Object.entries({time:t,intensity:clamp(intensity),audio:clamp(audio),scene,density:this.reduced?0:this.density*this.quality,pulse:scenePulse,effect:scenePulse>0?['pulse','spiral','particles'].indexOf(this.effect):-1}))gl.uniform1f(gl.getUniformLocation(this.program,key),value);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
 }catch(error){this.useFallback(error);const renderer=this.fallback as CanvasRenderer|null;renderer?.render(this.scene,scene===0?time:t,this.stableSettings,this.reduced,this.density*this.quality,scene===0?combinedPulse:scenePulse,clamp(audio),reaction);}

 }
 startBreath(cue:BreathCue,time:number){if(this.enabled)this.breath.schedule(cue,time);}
 clearBreath(){this.breath.clear();this.breathOverlay.update({...emptyBreathFrame});}
 startDescent(time:number,duration=6){if(this.enabled&&!this.reduced)this.descent.start(time,duration);}
 clearDescent(){this.descent.clear();this.descentOverlay.update({...emptyDescentFrame});}
 triggerPulse(time:number,effect:TriggerEffect=triggerEffectFor('')){if(this.enabled)this.triggers.start(time,effect,this.reduced);}
 pinkPulse(time:number){if(this.enabled)this.triggers.pinkPulse(time,this.reduced);}
 clearTrigger(preserveEye=false){this.triggers.clear(preserveEye);if(!preserveEye)this.overlay.update({...emptyTriggerFrame});}
 clearVoiceReaction(){this.reactivity.clear();this.reactiveAmount=0;this.canvas.style.filter='brightness(1)';this.fixationLayer.style.filter='brightness(1)';}
 stop(){this.clearTrigger();this.enabled=false;this.pulse=0;if(this.fallback)this.fallback.clear();else if(this.backend==='webgl'){this.gl.clearColor(.025,.015,.035,1);this.gl.clear(this.gl.COLOR_BUFFER_BIT);}}
}
