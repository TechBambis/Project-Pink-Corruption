# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import tarfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('nano_setup',ROOT/'scripts/setup-tts-nano.py')
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
spec=importlib.util.spec_from_file_location('supertonic_setup',ROOT/'scripts/setup-tts-supertonic.py')
supertonic=importlib.util.module_from_spec(spec);spec.loader.exec_module(supertonic)
spec=importlib.util.spec_from_file_location('qwen_setup',ROOT/'scripts/setup-tts-qwen3.py')
qwen=importlib.util.module_from_spec(spec);spec.loader.exec_module(qwen)


class NanoSetupTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(prefix='bambi-nano-test-')
        self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name)
        self.data=b'public fixture'
        self.asset={'file':'fixture.bin','bytes':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest()}

    def test_installs_verified_bytes_and_reuses_without_network(self):
        def response(*args,**kwargs):return io.BytesIO(self.data)
        path=setup.install_asset(self.path,self.asset,'https://fixture.invalid',response)
        self.assertEqual(path.read_bytes(),self.data)
        def unavailable(*args,**kwargs):raise AssertionError('Verified cache must not connect')
        self.assertEqual(setup.install_asset(self.path,self.asset,'https://fixture.invalid',unavailable),path)

    def test_bad_download_keeps_previous_file_and_removes_only_its_stage(self):
        path=self.path/self.asset['file'];path.write_bytes(b'previous invalid fixture')
        for data in [self.data[:-1],b'x'*len(self.data),self.data+b'x']:
            with self.assertRaises(ValueError):
                setup.install_asset(self.path,self.asset,'https://fixture.invalid',lambda *a,**kw:io.BytesIO(data))
            self.assertEqual(path.read_bytes(),b'previous invalid fixture')
            self.assertEqual(list(self.path.glob('*.download')),[])

    def test_rejects_path_escape_symlinks_and_invalid_pins_before_fetch(self):
        def unavailable(*args,**kwargs):raise AssertionError('Rejected pins must not connect')
        for change in [{'file':'../private'},{'file':'/absolute'},{'file':'..\\private'},
                       {'bytes':True},{'bytes':0},{'sha256':'not-a-pin'}]:
            with self.assertRaises(ValueError):setup.install_asset(self.path,{**self.asset,**change},'https://fixture.invalid',unavailable)
        target=self.path/'private';target.write_bytes(self.data)
        (self.path/self.asset['file']).symlink_to(target)
        with self.assertRaises(ValueError):setup.install_asset(self.path,self.asset,'https://fixture.invalid',unavailable)
        self.assertEqual(target.read_bytes(),self.data)

    def test_manifest_is_an_explicit_cpu_experiment_with_only_required_decoder(self):
        manifest=json.loads((ROOT/'config/tts-nano-experiment.json').read_text())
        self.assertEqual(manifest['status'],'isolated-benchmark-only')
        self.assertEqual(manifest['device'],'cpu')
        self.assertEqual(manifest['torch'],'2.6.0+cpu')
        for asset in manifest['files']:setup.validate_asset(asset)
        names=[asset['file'] for asset in manifest['files']]
        self.assertIn('s3gen_meanflow.safetensors',names)
        self.assertNotIn('s3gen.safetensors',names)
        self.assertNotIn('conds.pt',names)


class SupertonicSetupTests(unittest.TestCase):
    def setUp(self):
        self.manifest=json.loads((ROOT/'config/tts-supertonic-experiment.json').read_text())
        self.directory=tempfile.TemporaryDirectory(prefix='bambi-supertonic-test-')
        self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name)

    def test_manifest_keeps_models_code_and_license_notices_pinned(self):
        records=supertonic.locations(self.manifest,self.root)
        self.assertEqual(self.manifest['status'],'voice-lab-experiment')
        self.assertEqual(self.manifest['device'],'cpu')
        self.assertEqual(self.manifest['modelLicense'],'BigScience OpenRAIL-M')
        self.assertEqual(len([a for _,a,_ in records if a['file'].endswith('.onnx')]),4)
        self.assertEqual(len([a for _,a,_ in records if a['file']=='LICENSE']),2)
        for directory,asset,url in records:
            self.assertTrue(directory.is_relative_to(self.root))
            self.assertIn(self.manifest['codeRevision'] if '.runtime' in directory.parts else self.manifest['revision'],url)

    def test_rejects_directory_escape_and_moving_revisions_before_provision(self):
        for group in ('../private','/absolute','onnx/../../private'):
            manifest=json.loads(json.dumps(self.manifest))
            manifest['files'][0]['group']=group
            with self.assertRaises(ValueError):supertonic.locations(manifest,self.root)
        for key in ('revision','codeRevision'):
            with self.assertRaises(ValueError):supertonic.locations({**self.manifest,key:'main'},self.root)
        manifest=json.loads(json.dumps(self.manifest))
        manifest['codeFiles'][0]['source']='../private.py'
        with self.assertRaises(ValueError):supertonic.locations(manifest,self.root)

    def test_rejects_symlinked_model_parent(self):
        external=self.root/'external';external.mkdir()
        (self.root/'models').symlink_to(external,target_is_directory=True)
        with self.assertRaises(ValueError):supertonic.locations(self.manifest,self.root)
        self.assertEqual(list(external.iterdir()),[])


class QwenSetupTests(unittest.TestCase):
    def test_model_source_license_pins_and_paths(self):
        manifest=json.loads((ROOT/'config/tts-qwen3-experiment.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);records=qwen.locations(manifest,root)
            self.assertEqual(len(records),6)
            for path,asset,url in records:
                self.assertTrue(path.is_relative_to(root))
                self.assertTrue(url.startswith('https://'))
                self.assertNotIn('/main/',url)
            with self.assertRaises(ValueError):qwen.locations({**manifest,'revision':'main'},root)
            manifest['files'][0]['file']='../outside'
            with self.assertRaises(ValueError):qwen.locations(manifest,root)

    def test_archive_rejects_traversal_and_links_and_preserves_unchanged_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);archive=root/'source.tar.gz';destination=root/'source'
            for name,kind in [('upstream/../outside',tarfile.REGTYPE),('upstream/link',tarfile.SYMTYPE)]:
                with tarfile.open(archive,'w:gz') as output:
                    item=tarfile.TarInfo(name);item.type=kind;item.linkname='../../outside'
                    output.addfile(item)
                with self.assertRaises(ValueError):qwen.extract(archive,destination)
                self.assertFalse((root/'outside').exists())
                self.assertFalse((destination/'link').exists())
            content=b'public fixture'
            with tarfile.open(archive,'w:gz') as output:
                item=tarfile.TarInfo('upstream/file.txt');item.size=len(content);output.addfile(item,io.BytesIO(content))
            qwen.extract(archive,destination);path=destination/'file.txt';first=path.stat().st_mtime_ns
            qwen.extract(archive,destination);self.assertEqual(path.read_bytes(),content);self.assertEqual(path.stat().st_mtime_ns,first)

    def test_rejects_symlinked_setup_parent(self):
        manifest=json.loads((ROOT/'config/tts-qwen3-experiment.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);external=root/'external';external.mkdir();(root/'models').symlink_to(external,target_is_directory=True)
            with self.assertRaises(ValueError):qwen.locations(manifest,root)
            self.assertEqual(list(external.iterdir()),[])


class PublicIntelligibilityTests(unittest.TestCase):
    def test_word_errors_accept_punctuation_but_expose_missing_changed_and_added_words(self):
        spec=importlib.util.spec_from_file_location('public_audio_check',ROOT/'scripts/tts-experiment-intelligibility.py')
        check=importlib.util.module_from_spec(spec);spec.loader.exec_module(check)
        self.assertEqual(check.word_errors('Good. Keep your attention here.', 'GOOD, keep your attention here!'),(0,5))
        self.assertEqual(check.word_errors('keep your attention here', 'keep attention here'),(1,4))
        self.assertEqual(check.word_errors('keep your attention here', 'keep your attention there'),(1,4))
        self.assertEqual(check.word_errors('keep your attention here', 'please keep your attention here'),(1,4))
        self.assertEqual(check.word_errors('keep your attention here', ''),(4,4))


if __name__=='__main__':unittest.main()
