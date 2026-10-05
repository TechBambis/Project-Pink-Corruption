// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { AudioPreset } from './preset';

/** Continuous generated bed, independent from each queued narration chunk. */
export class BackgroundBed {
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private signature = '';
  private noiseCache = new Map<string, AudioBuffer>();
  private originalDrone: AudioBuffer | null = null;
  private useOriginal = true;
  private originalGain = 1;
  private configuredGains={drone:0,noise:0};
  get gains(){return this.configuredGains;}
  constructor(private context:AudioContext, private droneBus:GainNode, private noiseBus:GainNode) {}
  setOriginalDrone(buffer:AudioBuffer|null,gainDb=0){this.originalDrone=buffer;this.originalGain=10**(gainDb/20);this.signature='';}
  useOriginalDrone(enabled:boolean){this.useOriginal=enabled;}

  start(config:AudioPreset) {
    const original = this.useOriginal && this.originalDrone && ['bambi_classic','bambi_classic_deep'].includes(config.id);
    const signature = JSON.stringify([config.drone,config.noise,config.mix.drone,config.mix.noise,!!original]);
    if (this.signature===signature) return;
    this.stop(); this.signature=signature;
    this.droneBus.gain.value=10**(config.mix.drone/20)*(original?this.originalGain:1);
    this.noiseBus.gain.value=10**(config.mix.noise/20);
    this.configuredGains={drone:this.droneBus.gain.value,noise:this.noiseBus.gain.value};
    if(config.drone.enabled&&original){
      const source=this.context.createBufferSource();source.buffer=this.originalDrone;source.loop=true;
      source.connect(this.droneBus);this.sources.push(source);this.nodes.push(source);source.start();
    }else if(config.drone.enabled){
      const merger=this.context.createChannelMerger(2);merger.connect(this.droneBus);this.nodes.push(merger);
      for(const [channel,ear] of ['left','right'].entries())for(const band of ['low','high']){
        const oscillator=this.context.createOscillator(),amplitude=this.context.createGain();
        oscillator.frequency.value=config.drone[ear as 'left'|'right'][band==='low'?'lowHz':'highHz'];
        const depth=config.drone.modDepth,mod=config.drone[band==='low'?'lowModHz':'highModHz'];
        amplitude.gain.value=.5*(1-depth/2);oscillator.connect(amplitude);amplitude.connect(merger,0,channel);
        this.nodes.push(oscillator,amplitude);this.sources.push(oscillator);oscillator.start();
        if(mod>0&&depth>0){const lfo=this.context.createOscillator(),gain=this.context.createGain();lfo.frequency.value=mod;gain.gain.value=depth/4;lfo.connect(gain);gain.connect(amplitude.gain);this.nodes.push(lfo,gain);this.sources.push(lfo);lfo.start();}
      }
    }
    // A recorded drone already contains its own noise. Avoid doubling that bed.
    if(config.noise.enabled&&!(config.drone.enabled&&original)){
      const key=JSON.stringify([config.noise.type,config.noise.width,this.context.sampleRate]);
      let buffer=this.noiseCache.get(key);
      if(!buffer){buffer=this.context.createBuffer(2,this.context.sampleRate*8,this.context.sampleRate);
        const raw=[new Float32Array(buffer.length),new Float32Array(buffer.length)];
        for(const data of raw){let brown=0,b0=0,b1=0,b2=0;for(let i=0;i<data.length;i++){const white=Math.random()*2-1;
          if(config.noise.type==='white')data[i]=white;
          else if(config.noise.type==='brown'){brown=(brown+.02*white)/1.02;data[i]=brown;}
          else{b0=.99765*b0+.099046*white;b1=.963*b1+.2965164*white;b2=.57*b2+1.0526913*white;data[i]=(b0+b1+b2+.1848*white)*.05;}}
          const rms=Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length)||1;for(let i=0;i<data.length;i++)data[i]*=.22/rms;
        }
        // Crossfade end to start so repeated noise has no boundary click.
        const fade=Math.round(this.context.sampleRate*.05);
        for(let channel=0;channel<2;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<data.length;i++){const mid=(raw[0][i]+raw[1][i])/2;data[i]=mid*(1-config.noise.width)+raw[channel][i]*config.noise.width;}for(let i=0;i<fade;i++){const t=i/(fade-1);data[data.length-fade+i]=data[data.length-fade+i]*(1-t)+data[i]*t;}}
        this.noiseCache.set(key,buffer);if(this.noiseCache.size>8)this.noiseCache.delete(this.noiseCache.keys().next().value!);
      }
      const source=this.context.createBufferSource(),filter=this.context.createBiquadFilter();source.buffer=buffer;source.loop=true;source.loopStart=.05;source.loopEnd=buffer.duration;filter.type='lowpass';filter.frequency.value=config.noise.lowpassHz;source.connect(filter);filter.connect(this.noiseBus);this.nodes.push(source,filter);this.sources.push(source);source.start();
    }
  }
  stop(){for(const source of this.sources){try{source.stop();}catch{}}for(const node of this.nodes)node.disconnect();this.sources=[];this.nodes=[];this.signature='';}
}
