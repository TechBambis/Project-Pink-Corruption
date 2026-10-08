// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp, SPIRAL_COMPLEXITY_MAX } from '../safety/actions';
import type { StableSpiralSettings } from './stable';
import { qualityFragment } from './shader-quality';

export const spiralStyles = ['original', 'vortex', 'infinity', 'prism', 'orb', 'tunnel', 'loop', 'fractal'] as const;
export type SpiralStyle = typeof spiralStyles[number];
export const spiralStyleName = (style?: string) => ({ original: 'Original spiral', vortex: 'Deep Vortex', infinity: 'Infinity Coil', prism: 'Prismatic', orb: 'Focus Orb', tunnel: 'Deep Tunnel', loop: 'Endless Loop', fractal: 'Fractal Bloom' }[style ?? 'original'] ?? 'Original spiral');
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision mediump float;
varying vec2 uv;uniform vec2 resolution;uniform float time;uniform float complexity;uniform float depth;uniform float reaction;uniform float alpha;uniform float style;uniform vec3 colorA;uniform vec3 colorB;
void main(){
 vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
 p/=1.+reaction*.16;
 // Crop into Vortex/Prismatic; their ribbons continue beyond every viewport edge.
 if(style<2.5)p/=1.8;
 float r=length(p),a=atan(p.y,p.x),z=log(r+.025),aa=3./min(resolution.x,resolution.y);
 vec3 ink=vec3(.018,.008,.035),c=ink;
 if(style>3.5){
  float travel=time*.24, ringPhase=z*(6.+depth*4.)-travel*6.2831853;
  float flow=a+z*.45+time*.06;
  float shape=r;
  if(style>4.5&&style<5.5){
   float rotation=time*.10+z*.16;
   vec2 q=mat2(cos(rotation),-sin(rotation),sin(rotation),cos(rotation))*p;
   shape=mix(length(q),max(abs(q.x),abs(q.y)),.76);
   ringPhase=log(shape+.018)*(6.+depth*4.)-travel*6.2831853;
  }
  float footprint=pixelWidth(ringPhase,(6.+depth*4.)/max(r,.025)/resolution.y);
  float ring=pow(filteredWave(ringPhase,footprint),18.);
  float edge=pow(filteredWave(ringPhase+.28,footprint),60.);
  vec3 tint=mix(colorA,colorB,.5+.5*sin(flow*2.));
  c+=tint*ring*.65+mix(colorB,vec3(1.),.6)*edge*.5;
  c+=colorA*pow(.5+.5*cos(a*(8.+2.*floor(complexity))+z*4.-time*.4),20.)*.16;
  if(style>5.5){
   float sector=1.04719755;
   float folded=abs(mod(a+time*.04+sector*.5,sector)-sector*.5);
   vec2 q=vec2(cos(folded),sin(folded))*r; float petals=0.; float strength=.5;
   for(int i=0;i<5;i++){
    q=abs(q); float turn=.48+time*.025+float(i)*.10;
    q=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*q*1.65-vec2(.24,.20);
    float distance=abs(length(q)-.23);
    float ridge=exp(-distance*(26.+depth*18.));
    ridge*=1.-smoothstep(.015,.08,pixelWidth(distance,1./resolution.y));
    petals+=ridge*strength;strength*=.68;
   }
   c=c*.42+mix(colorA,colorB,.5+.5*sin(a*6.+time*.2))*petals*.8;
   c+=colorB*petals*petals*.28;
  }
  // Log-polar cells make points move outward with the tunnel, without a particle loop.
  vec2 cell=vec2((a+3.14159265)/6.2831853*48.,z*9.-travel*4.);
  vec2 seed=floor(cell),local=fract(cell)-.5;
  float star=step(.96,fract(sin(dot(seed,vec2(12.9898,78.233)))*193.7));
  c+=colorB*star*exp(-dot(local,local)*180.)*.45;
  c*=smoothstep(.008,.055,r)*(1.-smoothstep(.60,1.6,r)*.35);
  c+=colorB*exp(-r*65.)*.2;
  gl_FragColor=vec4(clamp(c,0.,1.)*alpha,1.);return;
 }
 if(style>2.5){
  float radius=.30+reaction*.035+sin(time*.6)*.007;
  float oval=mix(1.,.58,.5+.5*sin(time*.55));
  float meridianDistance=abs(length(vec2(p.x/oval,p.y))-radius);
  float meridian=exp(-meridianDistance*100.);
  float edgeDistance=abs(r-radius);
  float edge=1.-smoothstep(pixelWidth(edgeDistance,1./resolution.y),.004+pixelWidth(edgeDistance,1./resolution.y),edgeDistance);
  float halo=exp(-abs(r-radius)*(16.+depth*12.));
  vec3 glass=mix(colorA,colorB,.5+.5*cos(a+time*.08));
  c+=glass*halo*.25+mix(glass,vec3(1.),.65)*edge*.65;
  c+=mix(glass,vec3(1.),.7)*meridian*.35*(1.-smoothstep(radius,radius+.02,r));
  c+=glass*pow(clamp(r/radius,0.,1.),5.)*.12*(1.-smoothstep(radius,radius+.01,r));
  gl_FragColor=vec4(c*alpha,1.);return;
 }
 float arms=3.+floor(complexity*2.);
 float phase=a*arms+z*(9.+depth*13.)-time*2.;
 if(style>1.5){
  float folds=6.+2.*floor(complexity*2.);
  float sector=6.2831853/folds;
  float folded=abs(mod(a+time*.065+sector*.5,sector)-sector*.5);
  phase=folded*folds*2.+z*(11.+depth*13.)-time*1.65;
  phase+=sin(r*10.-time*.35)*(.7+depth);
 }
 float band=.5+.5*sin(phase),back=.5+.5*sin(-a*(arms+1.)+z*(7.+depth*7.)+time*.7);
 float width=pixelWidth(band,max(.0003,aa*.25/max(r,.035)));
 float ribbon=smoothstep(.42-width,.42+width,band);
 float bevel=pow(band,10.)*.45+pow(max(0.,1.-abs(band-.43)*20.),3.)*.45;
 float palette=.5+.5*sin(a+z*1.8+time*.13);
 vec3 tint=mix(colorA,colorB,palette);
 c+=mix(ink,tint,.75)*ribbon*(.32+.40*pow(band,2.));
 c+=mix(tint,vec3(1.,.86,.97),.55)*bevel*(.5+.5*depth);
 c+=colorB*pow(back,18.)*(.10+.10*depth)*(1.-ribbon*.6);
 float ringPhase=z*(13.+depth*8.)-time*1.1;
 float rings=pow(filteredWave(ringPhase,pixelWidth(ringPhase,(13.+depth*8.)/max(r,.025)/resolution.y)),24.);
 c+=mix(colorA,colorB,.6)*rings*.12;
 c*=smoothstep(.004,.025,r);
 c+=mix(colorA,colorB,.5)*exp(-r*45.)*(.15+reaction*.4);
 gl_FragColor=vec4(clamp(c,0.,1.)*alpha,1.);
}`;

const meshVertex = `precision mediump float;attribute vec2 center;attribute vec2 offset;attribute float tone;attribute float clipped;
uniform vec2 resolution;uniform float time;uniform float expansion;uniform vec3 colorA;uniform vec3 colorB;
varying vec3 tint;varying float mask;
void main(){float a=time*.6;vec2 p=(center+mat2(cos(a),sin(a),-sin(a),cos(a))*offset)*expansion;
gl_Position=vec4(p/resolution*2.,0.,1.);tint=tone<0.?vec3(.025,.009,.045):mix(colorA,colorB,.5+.5*sin(tone+time*.12));mask=clipped;}`;
const meshFragment = `precision mediump float;varying vec3 tint;varying float mask;uniform float alpha;uniform vec2 resolution;uniform float time;uniform float radius;uniform float box;
void main(){if(mask>.5){vec2 p=gl_FragCoord.xy-resolution*.5-vec2(0.,radius);float a=time*.6;
p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;if(max(abs(p.x),abs(p.y))>box*.5)discard;}
gl_FragColor=vec4(tint*alpha,1.);}`;

/** Original rendering, inspired by Hypnos' overlapping geometric loop and layered spiral art. */
export class ImmersiveSpiral {
  private program: WebGLProgram;
  private meshProgram: WebGLProgram;
  private buffer: WebGLBuffer;
  private meshBuffer: WebGLBuffer;
  private meshKey = ''; private meshCount = 0;
  constructor(private gl: WebGLRenderingContext) {
    this.program = this.create(vertex, fragment); this.meshProgram = this.create(meshVertex, meshFragment);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.meshBuffer = gl.createBuffer()!;
  }
  private create(vertex: string, fragment: string) {
    const gl = this.gl, program = gl.createProgram()!;
    // Keep sub-frame motion precise even after a long session; both shader stages must agree.
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
    for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(Number(type))!;
      const source = Number(type) === gl.FRAGMENT_SHADER ? qualityFragment(gl,String(code)) : String(code).replaceAll('precision mediump float;', `precision ${precision} float;`);
      gl.shaderSource(shader,source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) ?? 'Visual shader failed');
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? 'Visual shader failed');
    return program;
  }
  render(width: number, height: number, time: number, settings: StableSpiralSettings, reduced: boolean, reaction: number, quality: number) {
    const gl = this.gl, t = reduced ? 0 : time * settings.speed;
    const modeTime = settings.mode === 'drift' ? t + Math.sin(t * .2) * .6 : t;
    const breathe = !reduced && settings.mode === 'breathe' ? .06 * Math.sin(t * .8) : 0;
    const amount = reduced ? 0 : clamp(reaction + breathe);
    const alpha = clamp(settings.alpha) * (!reduced && settings.mode === 'strobe' ? .65 + .35 * Math.sin(time * Math.PI * Math.min(2, settings.pulseHz ?? .7)) ** 2 : 1);
    if (settings.style === 'infinity') { this.coil(width, height, modeTime, settings, amount, quality, alpha); return; }
    const program = this.program; gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const attr = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(program, 'resolution'), width, height);
    const style = ({ orb: 3, prism: 2, tunnel: 4, loop: 5, fractal: 6 } as Record<string, number>)[settings.style ?? 'vortex'] ?? 1;
    for (const [key, value] of Object.entries({ time: modeTime, complexity: clamp(settings.complexity,.1,SPIRAL_COMPLEXITY_MAX), depth: settings.depth ?? .75, reaction: amount, alpha, style })) gl.uniform1f(gl.getUniformLocation(program, key), value);
    const cycle = !reduced && settings.mode === 'colorCycle' ? .5 + .5 * Math.sin(t * .2) : 0;
    const a = rgb(settings.colorA), b = rgb(settings.colorB);
    gl.uniform3fv(gl.getUniformLocation(program, 'colorA'), a.map((v, i) => v * (1 - cycle) + b[i] * cycle));
    gl.uniform3fv(gl.getUniformLocation(program, 'colorB'), b.map((v, i) => v * (1 - cycle) + a[i] * cycle));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  private coil(width: number, height: number, time: number, settings: StableSpiralSettings, reaction: number, quality: number, alpha: number) {
    const gl = this.gl, n = Math.round((80 + clamp(settings.complexity,.1,SPIRAL_COMPLEXITY_MAX) * 26) * Math.max(.5, quality));
    const radius = Math.min(width, height) * .29, box = radius * (.48 + (settings.depth ?? .75) * .25);
    const key = [width, height, n, box].join(':');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
    if (key !== this.meshKey) {
      const data: number[] = [], overlap = Math.round(n * .1);
      for (let index = 0; index < n + overlap; index++) {
        const clipped = index >= n, i = clipped ? n - 1 - (index - n) : n - 1 - index;
        const f = i / n, angle = f * Math.PI * 2, x = Math.sin(angle) * radius, y = Math.cos(angle) * radius;
        const c = Math.cos(f * Math.PI), s = Math.sin(f * Math.PI);
        const corners = (half: number) => [[-half, -half], [half, -half], [half, half], [-half, half]].map(([u, v]) => [u * c - v * s, u * s + v * c]);
        const outer = corners(box / 2), inner = corners(box / 2 - Math.max(1, Math.min(width, height) * .002));
        const triangle = (p: number[], q: number[], r: number[], tone: number) => {
          for (const point of [p, q, r]) data.push(x, y, ...point, tone, clipped ? 1 : 0);
        };
        triangle(outer[0], outer[1], outer[2], -1); triangle(outer[0], outer[2], outer[3], -1);
        for (let j = 0; j < 4; j++) { const k = (j + 1) % 4; triangle(outer[j], outer[k], inner[j], angle); triangle(outer[k], inner[k], inner[j], angle); }
      }
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      this.meshKey = key; this.meshCount = data.length / 6;
    }
    const expansion = 1 + reaction * .025 / .29, program = this.meshProgram;
    gl.clearColor(.018 * alpha, .008 * alpha, .035 * alpha, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, 'resolution'), width, height);
    for (const [name, value] of Object.entries({ time, alpha, expansion, radius: radius * expansion, box: box * expansion })) gl.uniform1f(gl.getUniformLocation(program, name), value);
    const cycle = settings.mode === 'colorCycle' ? .5 + .5 * Math.sin(time * .2) : 0, a = rgb(settings.colorA), b = rgb(settings.colorB);
    gl.uniform3fv(gl.getUniformLocation(program, 'colorA'), a.map((v, i) => v * (1 - cycle) + b[i] * cycle));
    gl.uniform3fv(gl.getUniformLocation(program, 'colorB'), b.map((v, i) => v * (1 - cycle) + a[i] * cycle));
    for (const [name, count, offset] of [['center', 2, 0], ['offset', 2, 8], ['tone', 1, 16], ['clipped', 1, 20]] as const) {
      const attr = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, count, gl.FLOAT, false, 24, offset);
    }
    gl.drawArrays(gl.TRIANGLES, 0, this.meshCount);
    for (const name of ['center', 'offset', 'tone', 'clipped']) gl.disableVertexAttribArray(gl.getAttribLocation(program, name));
  }
}
