# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Speech input boundaries, without loading models or starting services."""
import json
from pathlib import Path
import sys
import unittest
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from packages.speech.local.timing import phrases
from packages.speech.local.spoken import english_research_input, spoken_input, pronunciation_input


class SpeechBoundaryWorkTests(unittest.TestCase):
    def test_long_emphasis_and_unterminated_phrases_remain_linear(self):
        started = time.monotonic()
        self.assertEqual(spoken_input('_' * 100000 + 'Ready.'), 'Ready.')
        self.assertEqual(spoken_input('word' + '_' * 100000 + 'word'), 'word' + '_' * 100000 + 'word')
        self.assertEqual(spoken_input(' ' * 100000 + 'Ready , now .'), 'Ready, now.')
        self.assertEqual([part.text for part in phrases('word ' * 5000 + '\nReady.')][-1], 'Ready.')
        self.assertLess(time.monotonic() - started, 2)


class EnglishResearchInputTests(unittest.TestCase):
    def test_all_24_problem_fixtures_have_explicit_expected_model_input(self):
        expected = {
            'numbers-01': 'The appointment is at ten thirty tomorrow morning.',
            'numbers-02': 'The box costs twelve dollars and fifty cents, including the small label.',
            'numbers-03': 'Please count from one to five, with a short pause.',
            'numbers-04': 'The walk is two point five miles and takes about forty minutes.',
            'numbers-05': 'On October ninth, two thousand twenty six, we wrote down three choices.',
            'numbers-06': 'The temperature changed from eighteen to twenty two degrees.',
            'numbers-07': 'You can choose three, five, or eight words for the first phrase.',
            'numbers-08': 'There are one hundred twenty pages, and we have read thirty five so far.',
            'abbreviations-01': 'Doctor Green will arrive after lunch.',
            'abbreviations-02': 'Miz Taylor left a note beside the door.',
            'abbreviations-03': 'The central processing unit is busy, but the audio should keep playing.',
            'abbreviations-04': 'The United States office opens at nine in the morning.',
            'abbreviations-05': 'Bring a pen, a notebook, and so on, if they would help.',
            'abbreviations-06': 'We compared the two options, for example, by listening to the same sentence.',
            'abbreviations-07': 'The meeting with Professor Lane is on Friday.',
            'abbreviations-08': 'Please check the uniform resource locator before opening the page.',
            'quotes-markdown-01': 'She said, Take your time, and waited for an answer.',
            'quotes-markdown-02': 'The word comfortable means different things to different people.',
            'quotes-markdown-03': 'Listen carefully to the beginning and the end of this sentence.',
            'quotes-markdown-04': 'The note reads: Keep the blue glass on the shelf.',
            'quotes-markdown-05': 'We can discuss sample rate after the example finishes.',
            'quotes-markdown-06': 'First, listen to the raw sample. Second, compare the longer passage.',
            'quotes-markdown-07': 'He asked, Would you like to continue? She nodded.',
            'quotes-markdown-08': 'A quiet moment. We can begin with one clear thought.',
        }
        original = (ROOT / 'config/live-voice-corpus.json').read_bytes()
        cases = json.loads(original)['cases']
        problem_cases = [c for c in cases if c['family'] in ('numbers', 'abbreviations', 'quotes-markdown')]
        self.assertEqual({c['id'] for c in problem_cases}, set(expected))
        for case in problem_cases:
            with self.subTest(case=case['id']):
                actual = english_research_input(case['text'])
                self.assertEqual(actual, expected[case['id']])
                self.assertEqual(english_research_input(actual), actual)
        self.assertEqual((ROOT / 'config/live-voice-corpus.json').read_bytes(), original)

    def test_default_speech_policy_stays_separate(self):
        text = 'Dr. Green paid $12.50 for 2.5 miles.'
        self.assertEqual(spoken_input(text), text)
        self.assertEqual(pronunciation_input(text), text)
        self.assertEqual(pronunciation_input('IQ **test**'), 'I Q test')

    def test_controls_markup_and_contractions(self):
        self.assertEqual(english_research_input('[SFX:bell] **Don\'t rush.** `sampleRate` [vib:2]'),
                         "Don't rush. sample rate")
        self.assertEqual(english_research_input('# First!\n## Second\nThird.'), 'First! Second. Third.')
        self.assertEqual(english_research_input('She said “don\'t”.'), "She said don't.")

    def test_numeric_boundaries_units_signs_and_money(self):
        for raw, expected in {
            '$1.01. $0.50. $2.00.': 'one dollar and one cent. zero dollars and fifty cents. two dollars.',
            '-2.50 and +3, with 0.05.': 'minus two point five zero and plus three, with zero point zero five.',
            '9:05 and 18:00.': 'nine oh five and eighteen o clock.',
            '0 19 100 1001 1000000 999999999': 'zero nineteen one hundred one thousand one one million nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine',
        }.items():
            with self.subTest(raw=raw):
                self.assertEqual(english_research_input(raw), expected)
        for literal in ('1000000000', '0012', '$12.5', '$1,234.50', '24:61', '12:30:45',
                        'v2.5.1', '127.0.0.1', '2026-10-09', 'af_heart', 'room12',
                        'https://example.test/Dr./12.50', 'name12@example.test'):
            with self.subTest(literal=literal):
                self.assertEqual(english_research_input(literal), literal)

    def test_abbreviations_preserve_surrounding_words_and_ms_meaning(self):
        self.assertEqual(english_research_input('CPU CPUish Dr. Green Ms. Taylor Prof. Lane'),
                         'central processing unit CPUish Doctor Green Miz Taylor Professor Lane')
        self.assertEqual(english_research_input('URLish doctor@example.test'), 'URLish doctor@example.test')


if __name__ == '__main__':
    unittest.main()
