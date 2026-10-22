// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Generated content stays private; callers can retry an incomplete object. */
export class StructuredOutputError extends Error {
 constructor(readonly reason:'truncated'|'invalid'){
  super(reason==='truncated'?'The AI stopped before completing its JSON response.':'The AI returned an invalid JSON response.');
  this.name='StructuredOutputError';
 }
}

export function parseStructuredOutput(content:unknown,finishReason?:unknown):unknown {
 if(finishReason==='length'||finishReason==='max_tokens')throw new StructuredOutputError('truncated');
 if(typeof content!=='string'||content.length>65536)throw new StructuredOutputError('invalid');
 try{return JSON.parse(content);}
 catch{throw new StructuredOutputError('invalid');}
}
