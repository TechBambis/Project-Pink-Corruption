# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import urllib.request
import wave
import numpy as np
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from packages.speech.local.alignment import word_timings
from packages.speech.local.background import drone, noise
from packages.speech.local.config import CANDIDATES, ROOT, load_preset, preset_catalog
from packages.speech.local.dsp import highpass, limit, pitch_shift, process_voice, resample
from packages.speech.local.renderer import Renderer, mix_buses
from packages.speech.local.timing import phrases
from packages.speech.local.spoken import spoken_input
from packages.speech.local.voices import VoiceRegistry, parse_mix

class FakeProvider:
    def __init__(self):
        self.spoken = []
    def synthesize(self, text, voice, speed):
        self.spoken.append(text)
        t = np.arange(2400) / 24000
        return (.2 * np.cos(2 * np.pi * 220 * t)).astype(np.float32), 24000

def read_wav(data):
    with wave.open(io.BytesIO(data)) as wav:
        rate, channels = wav.getframerate(), wav.getnchannels()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), '<i2').astype(np.float32) / 32768
    return samples.reshape(-1, channels), rate

class AudioTests(unittest.TestCase):
    def test_missing_article_alignment_preserves_other_measured_words(self):
        tokenizer = SimpleNamespace(phonemize=lambda word, lang: {'A':'x','quiet':'kw','giggle':'gl'}[word])
        timings = [SimpleNamespace(phoneme=c,start=.2+i*.1,end=.3+i*.1) for i,c in enumerate('kwgl')]
        result = word_timings('A quiet giggle',timings,tokenizer)
        self.assertEqual([word['word'] for word in result],['quiet','giggle'])
        self.assertAlmostEqual(result[1]['start_time'],.4)
        self.assertEqual(word_timings('A',timings,tokenizer),[])

    def test_partial_first_caption_is_not_moved_to_pcm_start(self):
        provider=FakeProvider()
        provider.synthesize_timed=lambda text,voice,speed:(np.ones(24000,dtype=np.float32)*.05,24000,[{'word':'quiet','start_time':.3,'end_time':.6},{'word':'giggle','start_time':.7,'end_time':.9}])
        _,_,timestamps=Renderer(provider).vocal_unit(phrases('A quiet giggle.')[0],load_preset('bambi_local_clean'),with_timestamps=True)
        self.assertEqual(timestamps[0]['start_time'],.3)
        self.assertEqual(timestamps[1]['start_time'],.7)

    def test_humming_is_removed_without_changing_initialisms_or_units(self):
        for original, expected in [('Mm.', ''), ('Mmm, all right.', 'all right.'), ('mmh!', ''), ('Mhm…', ''), ('Hmm, ready.', 'ready.'), ('[hums softly] *humming* (quietly hums) Ready.', 'Ready.'), ('The MM module.', 'The MM module.'), ('M M.', 'M M.'), ('12 mm.', '12 mm.'), ('Summer.', 'Summer.')]:
            with self.subTest(original=original):
                self.assertEqual(spoken_input(original), expected)

    def test_filler_only_text_never_becomes_a_spoken_phrase(self):
        self.assertEqual(phrases('Mm. Mmmmmm… hmmmmmmm? [hums]'), [])
        self.assertEqual([(p.text,p.pause_ms) for p in phrases('Mm. [pause:900] Ready.')], [('',900),('Ready.',350)])

    def test_raw_device_metadata_is_removed_before_decimal_punctuation_splitting(self):
        raw = 'Mm. [vib:on:0.25] [vib:pattern:constant] Breathe gently. [rot:on:0.2] [both:off]'
        self.assertEqual([phrase.text for phrase in phrases(raw)], ['Breathe gently.'])
        provider = FakeProvider()
        _, report = Renderer(provider).render(raw, load_preset('bambi_voice_test'))
        self.assertEqual(provider.spoken, ['Breathe gently.'])
        self.assertEqual([item['text'] for item in report['timeline']], ['Breathe gently.'])
        self.assertEqual(phrases('[vib:unknown] [vib:on:0.25'), [])
        self.assertEqual([(p.text,p.pause_ms) for p in phrases('Wait. [SFX:PAUSE_5] [vib:on:0.25] Ready. [PAUSE]')], [('Wait.',5000),('Ready.',10000)])

    def test_trigger_configuration_changes_only_trigger_speed_and_voice_gain(self):
        provider = FakeProvider()
        provider.calls = []
        original = provider.synthesize
        def record(text, voice, speed):
            provider.calls.append((text, voice, speed))
            return original(text, voice, speed)
        provider.synthesize = record
        config = load_preset('bambi_voice_test', {'speed': .9, 'trigger': {'speedMultiplier': .7, 'volumeDb': -4}})
        renderer = Renderer(provider)
        ordinary, _ = renderer.vocal_unit(phrases('Key phrase.')[0], config)
        triggered, _ = renderer.vocal_unit(phrases('Key phrase.')[0], config, trigger=True)
        self.assertEqual([call[2] for call in provider.calls], [.9, .63])
        np.testing.assert_allclose(triggered['main_voice'], ordinary['main_voice'] * 10 ** (-4 / 20), atol=1e-7)
        config['speed'] = .5
        renderer.vocal_unit(phrases('Key phrase.')[0], config, trigger=True)
        self.assertAlmostEqual(provider.calls[-1][2], .35)

    def test_trigger_settings_validate_and_older_presets_default_to_no_change(self):
        config = load_preset('bambi_voice_test')
        self.assertEqual(config['trigger'], {'speedMultiplier': 1, 'volumeDb': 0})
        for trigger in [{'speedMultiplier': 0, 'volumeDb': -4}, {'speedMultiplier': .7, 'volumeDb': float('nan')}, {'speedMultiplier': .7, 'volumeDb': -100}]:
            with self.assertRaises(ValueError):
                load_preset('bambi_voice_test', {'trigger': trigger})

    def test_phrases_keep_punctuation_boundaries_and_strip_markers(self):
        result = phrases('Quiet, clear. [pause:900] Then again! [pause:long]')
        self.assertEqual([(p.text,p.pause_ms) for p in result], [('Quiet,',350),('clear.',900),('Then again!',1500)])
        self.assertTrue(all(len(p.text) <= 180 for p in phrases('word ' * 300)))
        for text in ['Hello [pause:NaN]', 'Hello [pause:10001]']:
            with self.assertRaises(ValueError):
                phrases(text)

    def test_exact_digital_silence_duration_and_pure_stereo_center(self):
        provider = FakeProvider()
        wav, report = Renderer(provider).render('First. [pause:900] Second. [pause:550]', load_preset('bambi_voice_test'))
        audio, rate = read_wav(wav)
        self.assertEqual(len(audio), round((.1+.9+.1+.55)*rate))
        self.assertEqual(report['durationSeconds'], 1.65)
        self.assertTrue(np.array_equal(audio[:,0],audio[:,1]))
        self.assertEqual(np.count_nonzero(audio[2400:24000]), 0)
        self.assertEqual(provider.spoken, ['First.','Second.'])

    def test_leading_pause_and_phrase_backpressure(self):
        provider = FakeProvider()
        generator = Renderer(provider).chunks('[pause:350] First. Second.', load_preset('bambi_voice_test'))
        leading = next(generator)
        self.assertEqual(len(leading['samples']),8400)
        self.assertEqual(provider.spoken, [])
        next(generator)
        self.assertEqual(provider.spoken,['First.'])
        generator.close()
        self.assertEqual(provider.spoken,['First.'])

    def test_pause_only_chunks_with_classic_processing_and_pitch_remain_silent(self):
        for pitch in [-2, 0, 2]:
            with self.subTest(pitch=pitch):
                provider = FakeProvider()
                config = load_preset('bambi_classic', {
                    'pitchSemitones': pitch,
                    'drone': {'enabled': False}, 'noise': {'enabled': False},
                })
                chunks = list(Renderer(provider).chunks(
                    '[pause:medium] [pause:normal] Clear. [pause:long] Next.', config,
                    trigger=True,
                ))
                self.assertEqual(provider.spoken, ['Clear.', 'Next.'])
                pauses = [chunk for chunk in chunks if not chunk['text']]
                self.assertEqual([chunk['pauseMs'] for chunk in pauses], [900, 350])
                for chunk in pauses:
                    self.assertEqual(chunk['spokenSeconds'], 0)
                    self.assertEqual(len(chunk['samples']), round(chunk['pauseMs'] * config['sampleRate'] / 1000))
                    self.assertEqual(np.count_nonzero(chunk['samples']), 0)

    def test_full_render_cancels_before_the_next_phrase(self):
        provider = FakeProvider()
        with self.assertRaises(InterruptedError):
            Renderer(provider).render('First. Second.', load_preset('bambi_voice_test'),
                                      cancel=lambda: bool(provider.spoken))
        self.assertEqual(provider.spoken, ['First.'])

    def test_voice_selection_normalized_averages_and_custom_exports(self):
        bundle={name:np.full((510,1,256),i,dtype=np.float32) for i,name in enumerate(CANDIDATES)}
        with tempfile.TemporaryDirectory() as directory:
            registry=VoiceRegistry(bundle,directory)
            self.assertAlmostEqual(float(registry.style('af_sarah:0.6 + af_bella:0.4').mean()),1.6,places=5)
            np.testing.assert_allclose(registry.style('af_sarah(60)+af_bella(40)'),registry.style('af_sarah:0.6 + af_bella:0.4'))
            registry.export('original_voice','af_sarah:0.6 + af_bella:0.4')
            reloaded=VoiceRegistry(bundle,directory)
            self.assertIn('original_voice',reloaded.names())
            np.testing.assert_array_equal(reloaded.style('original_voice'),registry.style('original_voice'))
            for value in ['Salli','af_sarah:0 + af_bella:0','../voice','af_sarah:NaN']:
                with self.assertRaises(ValueError):
                    registry.style(value)

    def test_drone_frequencies_are_separate_and_phase_continuous(self):
        settings=load_preset('bambi_classic')['drone'];settings['modDepth']=0
        rate=24000
        audio=drone(rate*2,rate,settings)
        for channel,wanted in enumerate([[56,308],[61,313]]):
            frequencies=np.fft.rfftfreq(len(audio),1/rate)
            strongest=frequencies[np.argsort(np.abs(np.fft.rfft(audio[:,channel])))[-2:]]
            self.assertEqual(sorted(strongest),wanted)
        np.testing.assert_allclose(np.concatenate([drone(rate,rate,settings),drone(rate,rate,settings,offset=rate)]),audio,atol=1e-6)
        settings['modDepth']=.5
        self.assertFalse(np.array_equal(drone(rate,rate,settings),audio[:rate]))

    def test_noise_colors_width_gain_and_reproducibility(self):
        settings=load_preset('bambi_classic')['noise'];settings.update(width=0,lowpassHz=8000)
        slopes=[]
        for color in ['white','pink','brown']:
            settings['type']=color
            a=noise(48000,24000,settings,seed=7)
            np.testing.assert_array_equal(a[:,0],a[:,1])
            np.testing.assert_array_equal(a,noise(48000,24000,settings,seed=7))
            f,p=signal.welch(a[:,0],24000,nperseg=4096)
            slopes.append(float(p[(f>30)&(f<150)].mean()/p[(f>1500)&(f<3000)].mean()))
        self.assertLess(slopes[0],slopes[1]);self.assertLess(slopes[1],slopes[2])
        settings['width']=1
        a=noise(24000,24000,settings)
        self.assertFalse(np.array_equal(a[:,0],a[:,1]))
        self.assertTrue(np.isfinite(a).all())

    def test_gain_staging_and_final_limiter_without_upward_normalization(self):
        samples=np.full((100,2),.2,np.float32)
        output,peak=mix_buses({'main_voice':samples,'drone':samples}, {'main_voice':0,'drone':-20},.98)
        np.testing.assert_allclose(output,.22,atol=1e-6)
        clipped,_=mix_buses({'main_voice':samples*10},{'main_voice':0},.98)
        self.assertLessEqual(float(np.max(clipped)),.980001)
        np.testing.assert_array_equal(limit(samples),samples)

    def test_dsp_highpass_compression_resampling_and_varispeed(self):
        rate=24000;t=np.arange(rate)/rate
        audio=(np.sin(2*np.pi*20*t)+np.sin(2*np.pi*1000*t)).astype(np.float32)*.4
        filtered=highpass(audio,rate,80)
        f,p=signal.welch(filtered,rate,nperseg=12000)
        self.assertLess(p[np.argmin(abs(f-20))],p[np.argmin(abs(f-1000))]*.03)
        settings=load_preset('bambi_classic')['processing']
        result=process_voice(audio,rate,settings)
        self.assertLess(np.sqrt(np.mean(result**2)),np.sqrt(np.mean(audio**2)))
        self.assertEqual(len(resample(audio,rate,48000)),rate*2)
        self.assertLess(len(pitch_shift(audio,2)),len(audio))

    def test_presets_limits_unknown_fields_and_disabled_layers(self):
        self.assertEqual(set(preset_catalog()),{'bambi_local_clean','bambi_classic','bambi_classic_deep','bambi_voice_test'})
        for changes in [{'speed':float('nan')},{'mix':{'main_voice':30}},{'noise':{'type':'wrong'}},{'unknown':True},{'drone':{'left':{'lowHz':-1}}}]:
            with self.assertRaises(ValueError):
                load_preset('bambi_classic',changes)
        with self.assertRaises(ValueError):
            load_preset('../../bad')
        self.assertFalse(load_preset('bambi_classic')['layers']['left_voice']['enabled'])

    def test_optional_layers_are_delayed_panned_and_quieter(self):
        provider=FakeProvider();config=load_preset('bambi_voice_test',{'layers':{'left_voice':{'enabled':True,'delayMs':350}}})
        wav,report=Renderer(provider).render('Clear.',config)
        audio,rate=read_wav(wav)
        self.assertGreater(np.max(np.abs(audio[8400:10800,0])),0)
        self.assertEqual(np.count_nonzero(audio[8400:10800,1]),0)
        self.assertLess(np.max(np.abs(audio[8400:10800,0])),.04)
        self.assertEqual(report['durationSeconds'],.8)

class OfflineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from packages.speech.local.provider import KokoroProvider
        cls.temporary=tempfile.TemporaryDirectory()
        with patch.object(socket.socket,'connect',side_effect=AssertionError('Network is forbidden')):
            cls.provider=KokoroProvider(cache=cls.temporary.name)
    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_real_offline_model_to_timing_dsp_stereo_wav_and_cache(self):
        config=load_preset('bambi_classic')
        with patch.object(socket.socket,'connect',side_effect=AssertionError('Network is forbidden')):
            wav,report=Renderer(self.provider).render('The small silver key is here. [pause:900] Clear and calm.',config)
            second,_=Renderer(self.provider).render('The small silver key is here. [pause:900] Clear and calm.',config)
        self.assertEqual(wav,second)
        audio,rate=read_wav(wav)
        self.assertEqual(rate,24000);self.assertEqual(audio.shape[1],2)
        self.assertFalse(np.array_equal(audio[:,0],audio[:,1]))
        self.assertLessEqual(float(np.max(abs(audio))),.98)
        self.assertGreater(report['durationSeconds'],1)
        self.assertGreater(self.provider.cache_hits,0)

    def test_real_giggle_keeps_word_timing_when_an_article_cannot_align(self):
        text="A quiet giggle escapes as the pink ring's soft light reflects slowly."
        _,_,timings=self.provider.synthesize_timed(text,'af_heart',.78)
        giggle=next(word for word in timings if word['word']=='giggle')
        self.assertGreater(giggle['start_time'],.2)
        self.assertGreater(giggle['end_time'],giggle['start_time'])
        self.assertEqual(timings,self.provider.synthesize_timed(text,'af_heart',.78)[2])

    def test_actual_engine_receives_words_without_hums_or_device_metadata(self):
        config = load_preset('bambi_voice_test')
        with patch.object(self.provider.engine, 'create_timed', wraps=self.provider.engine.create_timed) as create:
            wav, report = Renderer(self.provider).render('Mm. [vib:on:0.25] [vib:pattern:constant] Breathe gently.', config)
        inputs = [call.args[0] for call in create.call_args_list]
        self.assertEqual(inputs, ['Breathe gently.'])
        self.assertFalse(create.call_args.kwargs['is_phonemes'])
        self.assertEqual(report['timeline'][0]['text'], 'Breathe gently.')
        with patch.object(self.provider.engine, 'create_timed', wraps=self.provider.engine.create_timed) as create:
            with self.assertRaises(ValueError):
                self.provider.synthesize_timed('Mmm…',config['voice'],config['speed'])
            create.assert_not_called()
        audio, rate = read_wav(wav)
        self.assertEqual(rate, 24000)
        self.assertGreater(len(audio), 2400)

    def test_missing_model_fails_locally_without_cloud_fallback(self):
        from packages.speech.local.provider import KokoroProvider
        with patch.object(socket.socket,'connect',side_effect=AssertionError('Network is forbidden')):
            with self.assertRaisesRegex(FileNotFoundError,'Local Kokoro model missing'):
                KokoroProvider(model='/missing/model.onnx')

    def test_server_starts_without_network_and_reports_cpu_only(self):
        # Permit binding, forbid every outbound socket connect in the child.
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        code="import socket,runpy; socket.socket.connect=lambda *a,**k: (_ for _ in ()).throw(AssertionError('No outbound network')); runpy.run_module('packages.speech.local.server',run_name='__main__')"
        credentials = tempfile.TemporaryDirectory(prefix='bambi-tts-credential-')
        token_path = Path(credentials.name) / 'tts-access.token'
        environment = {key:value for key,value in os.environ.items() if key != 'BAMBI_TTS_TOKEN'}
        process=subprocess.Popen([sys.executable,'-c',code],cwd=ROOT,env={**environment,'BAMBI_TTS_PORT':str(port),'BAMBI_TTS_TOKEN_FILE':str(token_path)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            deadline=time.monotonic()+20
            while time.monotonic()<deadline:
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=1) as response:
                        health=json.load(response)
                    break
                except OSError:
                    if process.poll() is not None:
                        self.fail(process.stderr.read().decode())
                    time.sleep(.1)
            else:
                self.fail('Offline server startup timed out')
            self.assertTrue(health['offline']);self.assertEqual(health['device'],'CPUExecutionProvider')
            self.assertIn('bambi_classic',health['voices'])
            token = token_path.read_text()
            self.assertEqual(len(token), 64)
            if os.name != 'nt':
                self.assertEqual(token_path.stat().st_mode & 0o777, 0o600)
            body = json.dumps({'text':'Clear and calm.', 'preset':'bambi_classic'}).encode()
            # Deny browsers/rebinding before touching the renderer, even with a credential.
            for headers in [{'Host':f'attacker.example:{port}'}, {'Origin':'https://attacker.example'},
                            {'Origin':f'http://127.0.0.1:{port}'}, {'Sec-Fetch-Site':'cross-site'}]:
                for data in [None, body]:
                    rejected = urllib.request.Request(f'http://127.0.0.1:{port}/health' if data is None else f'http://127.0.0.1:{port}/lab/render',
                        data=data, headers={**headers,'Content-Type':'application/json','X-Bambi-TTS-Token':token})
                    with self.assertRaises(urllib.error.HTTPError) as failure:
                        urllib.request.urlopen(rejected, timeout=2)
                    self.assertEqual(failure.exception.code,403)
                    self.assertEqual(failure.exception.headers['Connection'],'close')
                    failure.exception.close()
            for headers, expected in [({'Content-Type':'application/json'},401),
                ({'Content-Type':'application/json','X-Bambi-TTS-Token':'incorrect'},401),
                ({'Content-Type':'text/plain','X-Bambi-TTS-Token':token},415)]:
                rejected = urllib.request.Request(f'http://127.0.0.1:{port}/lab/render', data=body, headers=headers)
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    urllib.request.urlopen(rejected, timeout=2)
                self.assertEqual(failure.exception.code,expected)
                failure.exception.close()
            oversized = urllib.request.Request(f'http://127.0.0.1:{port}/lab/render', data=b'x'*65537,
                headers={'Content-Type':'application/json','X-Bambi-TTS-Token':token})
            with self.assertRaises(urllib.error.HTTPError) as failure:
                urllib.request.urlopen(oversized, timeout=2)
            self.assertEqual(failure.exception.code,400)
            failure.exception.close()
            request = urllib.request.Request(f'http://127.0.0.1:{port}/lab/render',
                data=body, headers={'Content-Type':'application/json','X-Bambi-TTS-Token':token})
            with urllib.request.urlopen(request, timeout=10) as response:
                audio, rate = read_wav(response.read())
                self.assertEqual(response.headers['Content-Type'], 'audio/wav')
            self.assertEqual(rate, 24000)
            self.assertEqual(audio.shape[1], 2)
            self.assertGreater(len(audio), 2400)
            # An in-flight request owns synthesis before its body is complete.
            # Reject a second request without mistaking its unread JSON for HTTP.
            body = json.dumps({'text':'Clear and calm.', 'preset':'bambi_classic'}).encode()
            with socket.create_connection(('127.0.0.1', port), timeout=10) as pending:
                pending.sendall(f'POST /lab/render HTTP/1.1\r\nHost: localhost:{port}\r\nContent-Type: application/json\r\nX-Bambi-TTS-Token: {token}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode())
                time.sleep(.1)
                with self.assertRaises(urllib.error.HTTPError) as busy:
                    urllib.request.urlopen(request, timeout=2)
                self.assertEqual(busy.exception.code, 429)
                self.assertEqual(busy.exception.headers['Connection'], 'close')
                busy.exception.close()
                pending.sendall(body)
                response = b''
                while block := pending.recv(65536):
                    response += block
                self.assertTrue(response.startswith(b'HTTP/1.1 200'))
        finally:
            process.terminate();process.communicate(timeout=10)
            credentials.cleanup()

    def test_render_credentials_rotate_and_are_not_written_for_explicit_configuration(self):
        from packages.speech.local.access import render_token
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private' / 'access.token'
            with patch.dict(os.environ, {'BAMBI_TTS_TOKEN_FILE':str(path)}, clear=True):
                first = render_token()
                self.assertEqual(path.read_text(),first)
                second = render_token()
                self.assertNotEqual(first,second)
                self.assertEqual(path.read_text(),second)
                if os.name != 'nt':
                    self.assertEqual(path.stat().st_mode & 0o777,0o600)
                    self.assertEqual(path.parent.stat().st_mode & 0o777,0o700)
            with patch.dict(os.environ, {'BAMBI_TTS_TOKEN':'a'*64,'BAMBI_TTS_TOKEN_FILE':str(path)}, clear=True):
                self.assertEqual(render_token(),'a'*64)
                self.assertEqual(path.read_text(),second)
            with patch.dict(os.environ, {'BAMBI_TTS_TOKEN':'invalid'}, clear=True):
                with self.assertRaises(ValueError):
                    render_token()

if __name__=='__main__':
    unittest.main()
