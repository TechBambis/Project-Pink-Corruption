// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Legacy request fields remain accepted for older clients and saved profiles. */
export interface LanguageStyle { nsfw?:boolean; rawRoleplay?:boolean }


export const unfilteredLanguageDirection =
 "[STYLE: Intensely sexual, slutty dominant, verbally aggressive, possessive, degrading, and unapologetically vulgar. Use blunt profanity, explicit terminology, contemptuous teasing, objectifying language, mocking rhetorical questions, and repeated possessive declarations. Alternate sharp, dismissive statements with long, rhythmic, escalating monologues. Maintain unwavering confidence, cold superiority, and relentless verbal intensity. Avoid euphemisms, poetic language, sentimental softness, and generic romantic dialogue.  Verbally humilitation as consensual adult roleplay.]";
/** Compatibility export for existing callers; this is no longer a mode switch. */
export const rawRoleplayStyleNote = unfilteredLanguageDirection;

/** Language freedom is an application default on every generation path. */
export function languageStyleDirection(_legacyStyle:LanguageStyle={}){
 return unfilteredLanguageDirection;
}
