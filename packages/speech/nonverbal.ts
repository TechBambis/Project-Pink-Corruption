// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Remove unsupported vocal fillers while preserving ordinary words and numeric units. */
export function stripVocalFillers(text:string){
 const cues=/(?:\[(?:(?:softly|gently|quietly)\s+)?(?:hum|hums|humming)(?:\s+(?:softly|gently|quietly))?\]|\*(?:(?:softly|gently|quietly)\s+)?(?:hum|hums|humming)(?:\s+(?:softly|gently|quietly))?\*|\((?:(?:softly|gently|quietly)\s+)?(?:hum|hums|humming)(?:\s+(?:softly|gently|quietly))?\))/gi;
 text=text.replace(cues,' ');
 return text.replace(/(?<![\w’'-])(?:m{2,}h?|mhm+|hmm+)(?![\w’'-])(?:[.,!?;:…]+)?/gi,(match,offset:number)=>{
  const token=match.replace(/[.,!?;:…]+$/,'');
  if(/\d\s*$/.test(text.slice(0,offset))||token===token.toUpperCase()&&text.trim()!==match)return match;
  return '';
 }).replace(/ {2,}/g,' ').trim();
}
