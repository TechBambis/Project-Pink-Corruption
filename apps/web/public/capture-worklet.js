// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

class BambiCapture extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(1024);this.offset=0;}
 process(inputs){const input=inputs[0]?.[0];if(input)for(let i=0;i<input.length;i++){this.buffer[this.offset++]=input[i];if(this.offset===1024){this.port.postMessage(this.buffer);this.buffer=new Float32Array(1024);this.offset=0;}}return true;}
}
registerProcessor('bambi-capture',BambiCapture);
