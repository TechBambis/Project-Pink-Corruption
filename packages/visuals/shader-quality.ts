// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

/** Pixel footprints smooth procedural edges; MSAA alone only smooths geometry. */
export function qualityFragment(gl: WebGLRenderingContext, source: string) {
 const derivatives = !!gl.getExtension('OES_standard_derivatives');
 const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
 const helpers = `
float pixelWidth(float value,float fallback){return max(${derivatives ? 'fwidth(value)' : 'fallback'},fallback);}
// Low-pass subpixel oscillations instead of letting thin rings shimmer.
float filteredWave(float phase,float footprint){return .5+.5*cos(phase)*exp(-.5*footprint*footprint);}
`;
 return (derivatives ? '#extension GL_OES_standard_derivatives : enable\n' : '') + source
  .replace(/precision (?:highp|mediump) float;/, `precision ${precision} float;`)
  .replace('void main()', helpers + '\nvoid main()');
}
