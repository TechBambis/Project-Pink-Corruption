# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Word spans from Kokoro's model duration output, never evenly spaced captions."""
import re
from difflib import SequenceMatcher
from .spoken import pronunciation_input

def word_timings(text, spoken, tokenizer, phonemes=False):
    if not spoken:
        return []
    words = re.findall(r"[\w]+(?:['’\-][\w]+)*", text)
    if not words:
        return []
    if phonemes:
        return [{'word': text.strip(), 'start_time': spoken[0].start, 'end_time': spoken[-1].end}]
    # Context changes stress and some pronunciations. Align each word's phonemes
    # to the phonemes actually synthesized, retaining their measured boundaries.
    audible = lambda char: char.isalpha() or char in 'ɪʊəɚɝæɑɔɛɜʌθðʃʒŋɹɾʔ'
    actual = [(index, timing) for index, timing in enumerate(spoken) if audible(timing.phoneme)]
    expected, owners, lengths = [], [], []
    for owner, word in enumerate(words):
        chars = [char for char in tokenizer.phonemize(pronunciation_input(word), 'en-us') if audible(char)]
        lengths.append(len(chars))
        expected.extend(chars)
        owners.extend([owner] * len(chars))
    alignment = SequenceMatcher(None, expected, [timing.phoneme for _, timing in actual], autojunk=False)
    spans = [[] for _ in words]
    for block in alignment.get_matching_blocks():
        for offset in range(block.size):
            spans[owners[block.a + offset]].append(actual[block.b + offset][1])
    # A context-dependent article must not discard every other measured word.
    # Missing or weak matches remain unavailable; never interpolate their timing.
    return [{'word': word, 'start_time': span[0].start, 'end_time': span[-1].end}
            for word, span, length in zip(words, spans, lengths)
            if span and length and len(span) / length >= .6]
