// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { isBriefRequest, isContinuationRequest, isSessionNarration } from './response';
import type { ReplyIntent } from './request';

/** Explicit client intent wins. Legacy session commands remain supported without treating greetings as narration. */
export function resolveReplyIntent(text: string, promptId: string, dialogue: boolean, explicit?: ReplyIntent, previousIntent?: ReplyIntent): ReplyIntent {
  if (isBriefRequest(text)) return 'conversation';
  if (explicit === 'continuation' || (!explicit && isContinuationRequest(text))) return previousIntent === 'narration' ? 'narration' : 'conversation';
  if (explicit) return explicit;
  if (!dialogue) return 'narration';
  if (/^(?:hello|hi|hey|hallo|good (?:evening|night))(?:\s+(?:bambi|please|sweetie))?[.!…\s]*$/i.test(text.trim())) return 'conversation';
  return isSessionNarration(text, promptId, dialogue) ? 'narration' : 'conversation';
}
