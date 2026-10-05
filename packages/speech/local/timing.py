# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import re
from dataclasses import dataclass
from .spoken import strip_speech_controls, strip_vocal_fillers

DEFAULT_PAUSES = {"normal": 350, "short": 550, "medium": 900, "long": 1500, "transition": 2500}

@dataclass(frozen=True)
class Phrase:
    text: str
    pause_ms: int

def phrases(text, pauses=None, max_chars=180):
    """Parse explicit pauses before phrase splitting; never feed markers to TTS."""
    pauses = {**DEFAULT_PAUSES, **(pauses or {})}
    # Strip complete cues before splitting punctuation (including decimal levels).
    text = re.sub(r'\[SFX:PAUSE_(5|10)\]', lambda match: f'[pause:{int(match[1])*1000}]', text, flags=re.IGNORECASE)
    text = re.sub(r'\[PAUSE\]', '[pause:10000]', text, flags=re.IGNORECASE)
    text = strip_vocal_fillers(strip_speech_controls(text))
    result = []
    for part in re.split(r'(\[pause:(?:\d+|normal|short|medium|long|transition)\])', text):
        marker = re.fullmatch(r'\[pause:(\d+|normal|short|medium|long|transition)\]', part)
        if marker:
            value = marker[1]
            ms = int(value) if value.isdigit() else pauses[value]
            if not 0 <= ms <= 10000:
                raise ValueError('Pause must be between 0 and 10000 ms')
            if result and result[-1].text:
                result[-1] = Phrase(result[-1].text, ms)
            else:
                result.append(Phrase('', ms))
            continue
        if '[pause:' in part:
            raise ValueError('Invalid pause marker')
        # Preserve punctuation; commas and semicolons form short spoken units.
        for segment in re.findall(r'[^.!?;,\n]+(?:[.!?;,]+|$)', part):
            words = segment.strip().split()
            chunk = ''
            for word in words:
                if len(word) > max_chars:
                    raise ValueError('Single spoken word exceeds phrase limit')
                if chunk and len(chunk) + len(word) + 1 > max_chars:
                    result.append(Phrase(chunk, pauses['normal']))
                    chunk = ''
                chunk = f'{chunk} {word}'.strip()
            if chunk:
                result.append(Phrase(chunk, pauses['normal']))
    return result
