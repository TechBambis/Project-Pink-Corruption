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


_EN_SMALL = ('zero one two three four five six seven eight nine ten eleven twelve '
             'thirteen fourteen fifteen sixteen seventeen eighteen nineteen').split()
_EN_TENS = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split()
_EN_ORDINAL = ('first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
               'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth',
               'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth',
               'nineteenth', 'twentieth', 'twenty first', 'twenty second',
               'twenty third', 'twenty fourth', 'twenty fifth', 'twenty sixth',
               'twenty seventh', 'twenty eighth', 'twenty ninth', 'thirtieth', 'thirty first')


def _english_integer(number):
    if number < 20:
        return _EN_SMALL[number]
    if number < 100:
        tens, rest = divmod(number, 10)
        return _EN_TENS[tens] + (' ' + _english_integer(rest) if rest else '')
    for divisor, name in ((1_000_000, 'million'), (1000, 'thousand'), (100, 'hundred')):
        if number >= divisor:
            quotient, rest = divmod(number, divisor)
            return _english_integer(quotient) + ' ' + name + (' ' + _english_integer(rest) if rest else '')


def english_research_input(text):
    """Explicit English research policy v1; ordinary synthesis does not enable it.

    Covers the public English corpus's honorifics, initialisms, USD, clock times,
    month dates and bounded numbers. URLs, emails, versions and ISO dates remain
    literal. This is not a general Markdown parser or a multilingual normalizer.
    The caller retains display text and records this exact model input separately.
    """
    def code(match):
        value = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', match[1])
        value = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', value).replace('_', ' ')
        return re.sub(r'\b[A-Z][a-z]+\b', lambda m: m[0].lower(), value)

    text = re.sub(r'`([^`\n]+)`', code, text)
    text = re.sub(r'^ {0,3}#{1,6}\s+([^\n]+)',
                  lambda m: m[1].strip() + ('' if m[1].rstrip().endswith(('.', '!', '?')) else '.'),
                  text, flags=re.MULTILINE)
    text = spoken_input(text)
    text = re.sub(r'["“”]', '', text)

    def expand(segment):
        for pattern, words in (
            (r'(?<!\w)Dr\.(?=\s+[A-Z])', 'Doctor'),
            (r'(?<!\w)Ms\.(?=\s+[A-Z])', 'Miz'),
            (r'(?<!\w)Prof\.(?=\s+[A-Z])', 'Professor'),
            (r'\bCPU\b', 'central processing unit'),
            (r'\bURL\b', 'uniform resource locator'),
            (r'(?<!\w)U\.S\.(?!\w)', 'United States'),
            (r'(?<!\w)e\.g\.(?!\w)', 'for example'),
            (r'\betc\.(?!\w)', 'and so on'),
        ):
            segment = re.sub(pattern, words, segment)

        def money(match):
            dollars, cents = int(match[1]), int(match[2] or 0)
            value = _english_integer(dollars) + (' dollar' if dollars == 1 else ' dollars')
            if cents:
                value += ' and ' + _english_integer(cents) + (' cent' if cents == 1 else ' cents')
            return value
        segment = re.sub(r'(?<![\w.$])\$(0|[1-9]\d{0,8})(?:\.(\d{2}))?(?!\w|\.\d|,\d)', money, segment)

        def clock(match):
            hour, minute = int(match[1]), int(match[2])
            if hour > 23 or minute > 59:
                return match[0]
            return _english_integer(hour) + (' o clock' if minute == 0 else
                ' oh ' + _english_integer(minute) if minute < 10 else ' ' + _english_integer(minute))
        segment = re.sub(r'(?<![\w.:])([0-2]?\d):(\d{2})(?![\w:]|\.\d)', clock, segment)
        months = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
        segment = re.sub(r'\b(' + months + r') ([1-9]|[12]\d|3[01])(?=,|\s|$)',
                         lambda m: m[1] + ' ' + _EN_ORDINAL[int(m[2])-1], segment)

        def number(match):
            value = _english_integer(int(match[2]))
            if match[3]:
                value += ' point ' + ' '.join(_EN_SMALL[int(d)] for d in match[3])
            return ('minus ' if match[1] == '-' else 'plus ' if match[1] == '+' else '') + value
        return re.sub(r'(?<![\w.,/:$+\-])([+\-]?)(0|[1-9]\d{0,8})(?:\.(\d+))?(?![\w:/\-]|\.\d|,\d)',
                      number, segment)

    # Apply expansions only between tokens whose punctuation gives numbers another
    # meaning; in particular do not spell the components of a URL or an IP address.
    protected = re.compile(r'(?:https?://|www\.)\S+|[\w.+-]+@[\w.-]+|\b\d{4}-\d{2}-\d{2}\b|'
                           r'\b[vV]\d+(?:\.\d+)+\b|\b\d+(?:\.\d+){2,}\b')
    pieces, offset = [], 0
    for match in protected.finditer(text):
        pieces.extend((expand(text[offset:match.start()]), match[0]))
        offset = match.end()
    pieces.append(expand(text[offset:]))
    return re.sub(r'\s+', ' ', ''.join(pieces)).strip()
