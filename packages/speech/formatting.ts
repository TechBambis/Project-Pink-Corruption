// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Speech receives words, never emphasis/code delimiters, including split pairs. */
export function stripSpeechFormatting(text:string){
 return text.replace(/[*`]/g,'').replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu,'');
}
