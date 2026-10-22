# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicitly provisioned Qwen VoiceDesign auditions, isolated from Kokoro.

The native library is loaded only inside a disposable child. GPU allocations
are released on completion/cancellation, including native aborts or OOM.
"""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import numpy as np
from .config import ROOT, MODELS, load_preset
from .renderer import Renderer
from .spoken import spoken_input

STYLES = {
    'doll': 'An adult American woman with a bright, girly, doll-like voice. Playful, slightly bratty confidence, expressive rises and falls, crisp words, teasing amusement, natural conversational pace.',
    'brat': 'An adult American woman with a feminine, bright voice and a sharp, bratty attitude. Sound stylish, unimpressed and confidently in charge. Expressive sarcastic emphasis, playful contempt, clear consonants, varied pitch, natural conversational pace.',
    'tease': 'An adult American woman with a soft, bright, feminine voice. Sweet, amused and teasing, with a knowing smile, lively melodic intonation, gentle breathiness and confident playful emphasis. Natural conversational pace, clear words.',
}
BUILD = ROOT / '.runtime/qwen3tts/build'
TIMEOUT = 150


class QwenVoices:
    def names(self):
        return [*STYLES, 'custom']

    def style(self, name):
        if name not in self.names():
            raise ValueError('Qwen style must be doll, brat, tease or custom; voice blending is unavailable')
        return name


def controls(instruct, seed=41, backend='Vulkan0'):
    if not isinstance(instruct, str) or not instruct.strip() or len(instruct) > 1200 or '\0' in instruct:
        raise ValueError('Voice description must contain 1–1200 characters without NUL')
    if type(seed) is not int or not 0 <= seed <= 2147483647:
        raise ValueError('Qwen take seed must be an integer from 0 to 2147483647')
    if backend not in ('Vulkan0', 'CPU'):
        raise ValueError('Qwen backend must be Vulkan0 or CPU')
    return instruct.strip(), seed, backend


def validate_config(config):
    QwenVoices().style(config['voice'])
    if config['speed'] != 1:
        raise ValueError('Qwen tempo is controlled by the voice description; set Tempo to 1')
    if any(layer['enabled'] for layer in config['layers'].values()):
        raise ValueError('Qwen auditions use one voice; disable extra voice layers')


def records():
    manifest = json.loads((ROOT / 'config/tts-qwen3-experiment.json').read_text())
    provenance = json.loads((BUILD.parent / 'build-provenance.json').read_text())
    if (manifest['abiVersion'] != 5 or provenance['abiVersion'] != 5 or provenance['backend'] != 'vulkan'
            or provenance['codeRevision'] != manifest['codeArchives'][0]['revision']
            or provenance['ggmlRevision'] != manifest['codeArchives'][1]['revision']):
        raise ValueError('Qwen build does not match the pinned ABI/source revisions')
    if 'libqwen.so' not in {e['file'] for e in provenance['files']}:
        raise ValueError('Missing Qwen shared library record')
    entries = [(MODELS / 'qwen3tts' / e['file'], e) for e in [*manifest['files'], manifest['modelLicenseFile']]]
    entries += [(BUILD / e['file'], e) for e in provenance['files']]
    for path, entry in entries:
        if (not re.fullmatch(r'[a-zA-Z0-9_.-]+', entry['file']) or entry['file'] in ('.', '..')
                or type(entry['bytes']) is not int or not 0 < entry['bytes'] <= 4 * 1024**3
                or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256'])
                or any(p.is_symlink() for p in (path, *path.parents))):
            raise ValueError('Invalid Qwen asset or build path')
    # GGML's SONAME aliases must resolve to files recorded in this local build.
    recorded = {path for path, _ in entries if path.parent == BUILD}
    for alias in BUILD.glob('libggml*.so*'):
        if (alias.is_symlink() and alias.resolve() not in recorded) or (not alias.is_symlink() and alias not in recorded):
            raise ValueError('Qwen dependency alias escapes the verified build')
    if len([p for p in recorded if p.name.startswith('libggml')]) != 4:
        raise ValueError('Missing GGML dependency records')
    return manifest, entries


def available():
    if not sys.platform.startswith('linux'):
        return False
    try:
        _, entries = records()
        return all(p.is_file() and p.stat().st_size == e['bytes'] for p, e in entries)
    except (OSError, ValueError, KeyError, TypeError):
        return False


class QwenRenderer:
    def __init__(self, instruct, seed=41, backend='Vulkan0', phrase_mode='passage'):
        self.instruct, self.seed, self.backend = controls(instruct, seed, backend)
        if phrase_mode not in ('passage', 'sentences'):
            raise ValueError('Qwen delivery must be passage or sentences')
        self.phrase_mode = phrase_mode

    def render(self, text, config, cancel=lambda: False):
        validate_config(config)
        if len(text) > 600:
            raise ValueError('Qwen auditions are limited to 600 characters per render')
        if cancel():
            raise InterruptedError('Qwen audition cancelled')
        if not available():
            raise RuntimeError('Qwen is not provisioned; run its explicit setup')
        if self.backend == 'Vulkan0':
            # This experiment fits beside the idle 4B on RX 6600 XT, with little
            # headroom. Fail visibly rather than silently change device/model.
            devices = sorted(Path('/sys/class/drm').glob('card*/device/mem_info_vram_total'))
            if devices:
                free = int(devices[0].read_text()) - int(devices[0].with_name('mem_info_vram_used').read_text())
                if free < 2600 * 1024**2:
                    raise ValueError('Qwen needs about 2.6 GiB free VRAM. Choose CPU or finish the current GPU work first.')
        started = time.perf_counter()
        # This private directory disappears even after a failed native process.
        with tempfile.TemporaryDirectory(prefix='bambi-qwen-') as temporary:
            directory = Path(temporary)
            payload = json.dumps({'text': text, 'config': config, 'instruct': self.instruct,
                                  'seed': self.seed, 'backend': self.backend, 'phraseMode': self.phrase_mode}).encode()
            with (directory / 'request.json').open('w+b') as request, (directory / 'native.log').open('wb') as log:
                request.write(payload)
                request.seek(0)
                process = subprocess.Popen([sys.executable, '-m', 'packages.speech.local.qwen3', str(directory)],
                                           cwd=ROOT, stdin=request, stdout=log, stderr=log,
                                           env={**os.environ, 'BAMBI_QWEN_PARENT_PID': str(os.getpid())})
                try:
                    while process.poll() is None:
                        if cancel():
                            raise InterruptedError('Qwen audition cancelled')
                        if time.perf_counter() - started > TIMEOUT:
                            raise TimeoutError('Qwen audition exceeded 150 seconds; try shorter text or Vulkan')
                        time.sleep(.05)
                    if cancel():
                        raise InterruptedError('Qwen audition cancelled')
                    if process.returncode:
                        raise RuntimeError('Qwen native audition failed; try CPU or rerun explicit setup')
                finally:
                    # Popen owns this exact child; no ambient service is signalled.
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=2)
            output = directory / 'output.wav'
            if not output.is_file() or not 44 < output.stat().st_size < 120 * config['sampleRate'] * 4 + 4096:
                raise RuntimeError('Qwen returned an invalid audition length')
            report = json.loads((directory / 'report.json').read_text())
            report['renderSeconds'] = time.perf_counter() - started
            report['realtimeFactor'] = report['renderSeconds'] / report['durationSeconds']
            return output.read_bytes(), report


class InitParams(C.Structure):
    _fields_ = [('abi_version', C.c_int), ('talker_path', C.c_char_p), ('codec_path', C.c_char_p),
                ('use_fa', C.c_bool), ('clamp_fp16', C.c_bool), ('max_batch', C.c_int), ('codec_chunk_sec', C.c_float)]


class Audio(C.Structure):
    _fields_ = [('samples', C.POINTER(C.c_float)), ('n_samples', C.c_int), ('sample_rate', C.c_int), ('channels', C.c_int)]


Cancel = C.CFUNCTYPE(C.c_bool, C.c_void_p)


class TTSParams(C.Structure):
    _fields_ = [('abi_version', C.c_int), ('text', C.c_char_p), ('lang', C.c_char_p), ('instruct', C.c_char_p), ('speaker', C.c_char_p),
                ('ref_audio_24k', C.POINTER(C.c_float)), ('ref_n_samples', C.c_int), ('ref_text', C.c_char_p),
                ('seed', C.c_int64), ('max_new_tokens', C.c_int), ('temperature', C.c_float), ('top_k', C.c_int),
                ('top_p', C.c_float), ('repetition_penalty', C.c_float), ('subtalker_temperature', C.c_float),
                ('subtalker_top_k', C.c_int), ('subtalker_top_p', C.c_float), ('dump_dir', C.c_char_p),
                ('cancel', Cancel), ('cancel_user_data', C.c_void_p), ('on_chunk', C.c_void_p), ('on_chunk_user_data', C.c_void_p),
                ('ref_spk_emb', C.POINTER(C.c_float)), ('ref_spk_dim', C.c_int), ('ref_codes', C.POINTER(C.c_int32)), ('ref_T', C.c_int)]


class NativeProvider:
    def __init__(self, instruct, seed, backend):
        self.instruct, self.seed, backend = controls(instruct, seed, backend)
        self.registry = QwenVoices()
        manifest, entries = records()
        for path, entry in entries:
            if not path.is_file() or path.stat().st_size != entry['bytes']:
                raise ValueError('Qwen asset size mismatch')
            with path.open('rb') as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != entry['sha256']:
                    raise ValueError('Qwen asset checksum mismatch')
        os.environ['GGML_BACKEND'] = backend
        lib = self.lib = C.CDLL(str(BUILD / 'libqwen.so'))
        signatures = {'qt_init_default_params': ([C.POINTER(InitParams)], None),
                      'qt_init': ([C.POINTER(InitParams)], C.c_void_p), 'qt_free': ([C.c_void_p], None),
                      'qt_model_type': ([C.c_void_p], C.c_char_p),
                      'qt_tts_default_params': ([C.POINTER(TTSParams)], None),
                      'qt_synthesize': ([C.c_void_p, C.POINTER(TTSParams), C.POINTER(Audio)], C.c_int),
                      'qt_audio_free': ([C.POINTER(Audio)], None)}
        for name, (args, result) in signatures.items():
            fn = getattr(lib, name)
            fn.argtypes, fn.restype = args, result
        params = InitParams()
        lib.qt_init_default_params(C.byref(params))
        if params.abi_version != manifest['abiVersion']:
            raise ValueError('Qwen ABI mismatch')
        params.talker_path = os.fsencode(MODELS / 'qwen3tts' / manifest['files'][0]['file'])
        params.codec_path = os.fsencode(MODELS / 'qwen3tts' / manifest['files'][1]['file'])
        params.codec_chunk_sec = 4
        self.context = lib.qt_init(C.byref(params))
        if not self.context:
            raise RuntimeError('Qwen model initialization failed')
        if lib.qt_model_type(self.context) != b'voice_design':
            self.close()
            raise ValueError('Qwen experiment requires VoiceDesign weights')
        self.deadline = time.monotonic() + TIMEOUT

    def close(self):
        if self.context:
            self.lib.qt_free(self.context)
            self.context = None

    def synthesize(self, text, voice, speed):
        self.registry.style(voice)
        if speed != 1:
            raise ValueError('Describe Qwen pace in the voice description')
        text = spoken_input(text)
        if not text or len(text) > 600 or '\0' in text:
            raise ValueError('Qwen passage must contain 1–600 characters without NUL')
        params, audio = TTSParams(), Audio()
        self.lib.qt_tts_default_params(C.byref(params))
        if params.abi_version != 5:
            raise ValueError('Qwen synthesis ABI mismatch')
        params.text, params.lang, params.instruct = text.encode(), b'English', self.instruct.encode()
        params.seed, params.max_new_tokens = self.seed, 1024 if len(text) > 180 else 512
        cancel = Cancel(lambda _: time.monotonic() > self.deadline)
        params.cancel = cancel
        try:
            status = self.lib.qt_synthesize(self.context, C.byref(params), C.byref(audio))
            if status:
                raise RuntimeError('Qwen synthesis failed or was cancelled')
            if audio.sample_rate != 24000 or audio.channels != 1 or not 0 < audio.n_samples < params.max_new_tokens * 1920:
                # Exactly hitting the generation cap is not a complete audition.
                raise ValueError('Qwen returned no audio or reached its generation limit')
            samples = np.ctypeslib.as_array(audio.samples, shape=(audio.n_samples,)).copy()
            if not np.isfinite(samples).all():
                raise ValueError('Qwen returned non-finite PCM')
            return samples, audio.sample_rate
        finally:
            self.lib.qt_audio_free(C.byref(audio))


def worker(directory):
    if sys.platform.startswith('linux'):
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        # Also release GPU allocations if the supervising TTS service exits.
        expected = int(os.environ['BAMBI_QWEN_PARENT_PID'])
        if C.CDLL(None).prctl(1, 15, 0, 0, 0) != 0 or os.getppid() != expected:
            raise RuntimeError('Qwen worker lost its supervisor')
    data = json.loads(sys.stdin.buffer.read(65537))
    config = load_preset(data['config']['id'], data['config'])
    validate_config(config)
    if not isinstance(data['text'], str) or not 0 < len(data['text']) <= 600:
        raise ValueError('Qwen audition text length exceeded')
    provider = NativeProvider(data['instruct'], data['seed'], data['backend'])
    try:
        mode = data.get('phraseMode', 'passage')
        if mode not in ('passage', 'sentences'):
            raise ValueError('Qwen delivery must be passage or sentences')
        audio, report = Renderer(provider, split_clauses=False, split_sentences=mode == 'sentences',
                                 max_chars=600 if mode == 'passage' else 180).render(data['text'], config)
        report['phraseMode'] = mode
        directory.joinpath('output.wav').write_bytes(audio)
        directory.joinpath('report.json').write_text(json.dumps(report))
    finally:
        provider.close()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Qwen worker requires its private output directory')
    worker(Path(sys.argv[1]))
