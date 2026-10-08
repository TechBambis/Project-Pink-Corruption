// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { SpiralAnimation } from './stable-renderer';
import { clamp, SPIRAL_COMPLEXITY_MAX } from '../safety/actions';
import type { SpiralStyle } from './immersive';
import { qualityFragment } from './shader-quality';

export interface StableSpiralSettings {
  speed: number; complexity: number; alpha: number; colorA: string; colorB: string;
  mode: string;
  pulseHz?: number;
  style?: SpiralStyle;
  depth?: number;
}

const gpuVertex = `precision highp float;attribute vec2 position;varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const gpuFragment = `precision highp float;varying vec2 uv;uniform vec2 resolution;
uniform float rotation;uniform float pitch;uniform float expansion;uniform vec4 colorA;uniform vec4 colorB;
void main(){
 vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.)/expansion;
 float r=length(p),a=atan(p.y,p.x),phase=2.*a+r*pitch-rotation*2.;
 float wave=.5+.5*cos(phase);
 // Analytic edge width prevents thin pixel stair-steps, even near the center.
 float aa=pixelWidth(wave,clamp((2./max(r,.025)+pitch)*.35/min(resolution.x,resolution.y),.0003,.25));
 float ribbon=smoothstep(.38-aa,.38+aa,wave);
 vec3 tint=mix(colorA.rgb,colorB.rgb,smoothstep(.42,1.,wave));
 float shade=.48+.48*wave;
 vec3 ink=vec3(.018,.008,.035);
 vec3 c=mix(ink,tint*shade,ribbon);
 c+=mix(colorB.rgb,vec3(1.),.4)*pow(wave,9.)*.20;
 c=mix(ink,c,smoothstep(.002,.012,r));
 gl_FragColor=vec4(clamp(c,0.,1.)*colorA.a,1.);
}`;

/** Smooth classic two-arm spiral, with broad shaded ribbons and one fixed GPU quad. */
export class StableSpiral extends SpiralAnimation {
  private gpuProgram: WebGLProgram;
  private samples: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private sampleAttribute: number;
  override setup() {} // The host owns the canvas, resizing and render loop.
  constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    super();
    this.canvas = canvas; this.gl = gl;
    this.width = canvas.width; this.height = canvas.height;
    this.initWebGL();
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, gpuVertex], [gl.FRAGMENT_SHADER, gpuFragment]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, type === gl.FRAGMENT_SHADER ? qualityFragment(gl,source) : source.replaceAll('highp', precision)); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) ?? 'Original spiral shader failed');
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? 'Original spiral program failed');
    this.gpuProgram = program; this.samples = gl.createBuffer()!;
    this.sampleAttribute = gl.getAttribLocation(program, 'position');
    for (const name of ['resolution', 'rotation', 'pitch', 'expansion', 'colorA', 'colorB']) this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.samples);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    gl.disable(gl.BLEND);
    this.isVisible = true; this.isEnabled = true;
  }
  configure(settings: StableSpiralSettings, reduced: boolean, reaction = 0) {
    const controls = this.controls;
    const expansion = 1 + reaction * .18;
    controls.rangeA_min = .5 * expansion; controls.rangeA_max = 1.5 * expansion;
    controls.rangeB_min = expansion; controls.rangeB_max = 1.5 * expansion;
    controls.spiralWidth = 1 + reaction * .45;
    controls.frameSpeed1 = 200 / settings.speed;
    controls.frameSpeed2 = 200 / settings.speed;
    controls.rotationSpeed = 10 / settings.speed;
    const complexity = clamp(settings.complexity,.1,SPIRAL_COMPLEXITY_MAX);
    controls.complexity = complexity;
    controls.spiralA_geometry = complexity;
    controls.spiralB_geometry = .3 * complexity;
    controls.iterations = Math.max(50, Math.min(1000, Math.round(250 * complexity)));
    controls.alpha = settings.alpha;
    const color = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).concat(1);
    controls.spiralA_color = color(settings.colorA); controls.spiralB_color = color(settings.colorB);
    controls.animationMode = reduced ? 'classic' : ['breathe', 'drift'].includes(settings.mode) ? settings.mode : 'classic';
    controls.effects.colorCycle = !reduced && settings.mode === 'colorCycle';
    controls.effects.strobe = !reduced && settings.mode === 'strobe';
    // Scale mode breathing/drift and strobe with speed, not only base rotation.
    controls.effects.strobeSpeed = settings.pulseHz === undefined ? 6 : settings.pulseHz * Math.PI / 3;
    this.modeSpeed = settings.speed;
  }
  private modeSpeed = 1;
  override getAnimationModeOffset() {
    const frame = this.frameCount;
    this.frameCount *= this.modeSpeed;
    const result = super.getAnimationModeOffset();
    this.frameCount = frame;
    return result;
  }
  frame(time: number) {
    this.width = this.canvas.width; this.height = this.canvas.height;
    this.frameCount = time * 60;
    const gl = this.gl, c = this.controls, u = this.uniforms;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.samples); gl.useProgram(this.gpuProgram);
    gl.enableVertexAttribArray(this.sampleAttribute); gl.vertexAttribPointer(this.sampleAttribute, 2, gl.FLOAT, false, 0, 0);
    const offset = this.getAnimationModeOffset();
    gl.uniform2f(u.resolution, this.width, this.height);
    gl.uniform1f(u.rotation, time * this.modeSpeed * .25 * offset.rotationMultiplier);
    gl.uniform1f(u.pitch, 26 + c.complexity * 10 + offset.geometryOffset * 4);
    gl.uniform1f(u.expansion, c.rangeA_min * 2);
    for (const [name, base] of [['colorA', c.spiralA_color], ['colorB', c.spiralB_color]] as const) {
      const color = this.getEffectColor(base);
      gl.uniform4f(u[name], color[0]/255, color[1]/255, color[2]/255, (color[3] || 1) * c.alpha * this.getEffectAlphaMultiplier());
    }
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this.sampleAttribute);
  }
}
