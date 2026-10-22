# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Real pinned phonemization at a path beyond eSpeak's native path buffer."""
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

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


@unittest.skipUnless(sys.platform in ('linux', 'darwin'), 'POSIX eSpeak lookup')
class MacBundledEspeakTest(unittest.TestCase):
    def test_mac_alias_phonemizes_long_unicode_path_and_restores_environment(self):
        source = Path(espeakng_loader.get_data_path())
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary) / ('ä' * 90) / 'espeak-ng-data'
            shutil.copytree(source, data)
            self.assertGreater(len(os.fsencode(data)), 180)
            with patch('packages.speech.local.espeak.sys.platform', 'darwin'):
                with patch.dict(os.environ, {'ESPEAK_DATA_PATH': 'previous fixture'}):
                    with bundled_espeak_data(data):
                        alias = Path(os.environ['ESPEAK_DATA_PATH'])
                        self.assertLess(len(os.fsencode(alias)), 100)
                        self.assertTrue(alias.is_symlink())
                        self.assertEqual(alias.resolve(), data.resolve())
                        tokenizer = Tokenizer(EspeakConfig(data_path=str(data)))
                        self.assertGreater(len(tokenizer.phonemize('Keep the small silver key beside the blue glass.')), 20)
                    self.assertEqual(os.environ['ESPEAK_DATA_PATH'], 'previous fixture')
                    self.assertFalse(alias.parent.exists())

    def test_mac_alias_cleanup_after_failure_retains_bundled_data(self):
        source = Path(espeakng_loader.get_data_path())
        with patch('packages.speech.local.espeak.sys.platform', 'darwin'):
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'public fixture'):
                    with bundled_espeak_data(source):
                        alias = Path(os.environ['ESPEAK_DATA_PATH'])
                        raise RuntimeError('public fixture')
                self.assertNotIn('ESPEAK_DATA_PATH', os.environ)
                self.assertFalse(alias.parent.exists())
                self.assertTrue((source / 'phontab').is_file())


if __name__ == '__main__':
    unittest.main()
