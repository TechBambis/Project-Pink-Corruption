# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Real pinned phonemization at a path beyond eSpeak's native path buffer."""
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import espeakng_loader
from kokoro_onnx.config import EspeakConfig
from kokoro_onnx.tokenizer import Tokenizer
from packages.speech.local.espeak import bundled_espeak_data


@unittest.skipUnless(sys.platform == 'linux', 'Linux directory descriptor lookup')
class BundledEspeakTest(unittest.TestCase):
    def test_long_unicode_path_uses_the_same_data_and_phonemizes(self):
        previous = os.environ.get('ESPEAK_DATA_PATH')
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(espeakng_loader.get_data_path())
            data = Path(temporary) / ('ä' * 90) / 'espeak-ng-data'
            shutil.copytree(source, data)
            self.assertGreater(len(os.fsencode(data)), 180)
            with bundled_espeak_data(data):
                alias = Path(os.environ['ESPEAK_DATA_PATH'])
                self.assertEqual((alias / 'phontab').read_bytes(), (source / 'phontab').read_bytes())
                tokenizer = Tokenizer(EspeakConfig(data_path=str(data)))
                self.assertGreater(len(tokenizer.phonemize('Keep the small silver key beside the blue glass.')), 20)
            self.assertFalse(alias.exists())
        self.assertEqual(os.environ.get('ESPEAK_DATA_PATH'), previous)


if __name__ == '__main__':
    unittest.main()
