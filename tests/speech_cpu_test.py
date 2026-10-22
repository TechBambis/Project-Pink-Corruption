# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from packages.speech.local.cpu import cpu_runtime_options


class SpeechCpuTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='bambi-speech-cpu-test-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'profile.json'
        self.host = {'platform':'linux','machine':'x86_64','cpu':'public fixture CPU','logicalCPUs':12,'availableCPUs':12}
        self.profile = {'version':1,'host':self.host,'modelSha256':'pinned-test-model','threads':6,'dynamicBlock':4}

    def options(self, **kwargs):
        return cpu_runtime_options('pinned-test-model', self.path, self.host, kwargs)

    def test_missing_or_invalid_profile_keeps_bounded_default(self):
        self.assertEqual(self.options(), {'threads':4,'dynamicBlock':0,'source':'default'})
        for profile in [[],None,{'threads':6},{**self.profile,'threads':True},{**self.profile,'threads':100},
                        {**self.profile,'dynamicBlock':-1},{**self.profile,'modelSha256':'other-model'},
                        {**self.profile,'host':{**self.host,'availableCPUs':6}}]:
            self.path.write_text(json.dumps(profile))
            self.assertEqual(self.options()['source'],'default')
        self.path.write_text('incomplete JSON')
        self.assertEqual(self.options()['threads'],4)

    def test_matching_profile_and_explicit_environment_override(self):
        self.path.write_text(json.dumps(self.profile))
        self.assertEqual(self.options(), {'threads':6,'dynamicBlock':4,'source':'measured-local'})
        self.assertEqual(self.options(BAMBI_TTS_THREADS='2'), {'threads':2,'dynamicBlock':0,'source':'environment'})
        self.assertEqual(self.options(BAMBI_TTS_THREADS='2',BAMBI_TTS_DYNAMIC_BLOCK='4'),
                         {'threads':2,'dynamicBlock':4,'source':'environment'})
        for value in ['0','33','NaN']:
            with self.assertRaises(ValueError):self.options(BAMBI_TTS_THREADS=value)
        with self.assertRaises(ValueError):self.options(BAMBI_TTS_DYNAMIC_BLOCK='65')


if __name__ == '__main__':
    unittest.main()
