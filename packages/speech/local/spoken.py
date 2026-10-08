# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Final speech boundary: control metadata and unsupported vocal fillers."""
import re

_CONTROLS = re.compile(r'\[(?:vib|rot|both|SFX):[^\]]*(?:\]|$)', re.IGNORECASE)
_INTERRUPTION = re.compile(r'\[Response interrupted[^\]]*(?:\]|$)', re.IGNORECASE)
_HUM = re.compile(r"(?<![\w’'-])(?:m{2,}h?|mhm+|hmm+)(?![\w’'-])(?:[.,!?;:…]+)?", re.IGNORECASE)
_HUM_CUE = re.compile(r'(?:\[(?:(?:softly|gently|quietly)\s+)?(?:hum|hums|humming)(?:\s+(?:softly|gently|quietly))?\]|\*(?:(?:softly|gently|quietly)\s+)?(?:hum|hums|humming)(?:\s+(?:softly|gently|quietly))?\*|\((?:(?:softly|gently|quietly)\s+)?(?:hum|hums|humming)(?:\s+(?:softly|gently|quietly))?\))', re.IGNORECASE)

def strip_vocal_fillers(text):
    text = _HUM_CUE.sub(' ', text)
    def remove(match):
        token = match[0].rstrip('.,!?;:…')
        if re.search(r'\d\s*$', text[:match.start()]) or (token.isupper() and text.strip() != match[0]):
            return match[0]
        return ''
    return re.sub(r' {2,}', ' ', _HUM.sub(remove, text)).strip()

def strip_speech_controls(text):
    """Hardware/SFX are executed by the playback client, never by the voice model."""
    return _INTERRUPTION.sub(' ', _CONTROLS.sub(' ', text))

def strip_speech_formatting(text):
    """Remove emphasis/code delimiters, including pairs split between phrases."""
    text = re.sub(r'[*`]', '', text)
    return re.sub(r'(?<![^\W_])_+|_+(?![^\W_])', '', text)

def spoken_input(text):
    return strip_speech_formatting(strip_vocal_fillers(strip_speech_controls(text))).strip()

def pronunciation_input(text):
    """TTS-only initialism expansion. Display text and trigger identities stay intact."""
    return re.sub(r'\bIQ\b', 'I Q', spoken_input(text), flags=re.IGNORECASE)
