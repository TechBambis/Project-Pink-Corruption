// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

/** One temporary RGB snapshot, released after a scene change. No idle passes. */
export class SceneBlend {
 private texture:WebGLTexture|null=null;
 private program:WebGLProgram|null=null;
 private buffer:WebGLBuffer|null=null;
 constructor(private gl:WebGLRenderingContext){}
 clear(){if(this.texture)this.gl.deleteTexture(this.texture);this.texture=null;}
 capture(width:number,height:number){
  const gl=this.gl;this.clear();this.texture=gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  // An opaque drawing buffer cannot provide an alpha channel to copyTexImage2D.
  gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.getContextAttributes()?.alpha?gl.RGBA:gl.RGB,0,0,width,height,0);
 }
 draw(opacity:number){
  if(opacity<=0){this.clear();return;}
  if(!this.texture)return;
  const gl=this.gl;
  if(!this.program){
   const program=gl.createProgram()!;
   for(const [type,source] of [
    [gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}'],
    [gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform sampler2D image;uniform float opacity;void main(){gl_FragColor=vec4(texture2D(image,uv).rgb,opacity);}'],
   ] as const){
    const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision?'highp':'mediump';
    const shader=gl.createShader(type)!;gl.shaderSource(shader,source.replace('precision mediump float;',`precision ${precision} float;`));gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)||'Blend shader failed');
    gl.attachShader(program,shader);gl.deleteShader(shader);
   }
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Blend link failed');
   this.program=program;this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
   gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  }
  gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  const attribute=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
  gl.uniform1i(gl.getUniformLocation(this.program,'image'),0);gl.uniform1f(gl.getUniformLocation(this.program,'opacity'),opacity);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disable(gl.BLEND);gl.disableVertexAttribArray(attribute);
 }
}
