// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {LLMBackend} from './index';

/** Experimental: constrain private turn metadata; leave the spoken body unrestricted. */
export function situationalTurnGrammar(backend:Pick<LLMBackend,'name'|'supportsTurnGrammar'>,options:{enabled:boolean;situational:boolean;generated:string;closing?:boolean}){
 if(!options.enabled||!options.situational||!backend.supportsTurnGrammar||options.generated)return undefined;
 const action=options.closing?'"close"':'"respond" | "ask" | "guide"';
 return String.raw`root ::= "[turn:" action "]" body
action ::= ${action}
body ::= ([^\n] | "\n")*`;
}
