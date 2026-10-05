# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import hashlib
import json
import os
import threading
from pathlib import Path
import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro
from .config import ROOT
from .voices import VoiceRegistry
from .spoken import spoken_input
from .alignment import word_timings

class KokoroProvider:
    """CPU-only provider, resident embeddings/model and bounded disk phrase cache."""
    sample_rate = 24000

    def __init__(self, model=None, bundle=None, cache=None):
        self.model = Path(model or ROOT / 'models/kokoro/kokoro-v1.0.onnx')
        self.bundle = Path(bundle or ROOT / 'models/kokoro/voices-v1.0.bin')
        if not self.model.is_file() or not self.bundle.is_file():
            raise FileNotFoundError('Local Kokoro model missing. Run ./scripts/setup-local-tts.sh once while online.')
        options = ort.SessionOptions()
        ort.disable_telemetry_events()
        options.intra_op_num_threads = int(os.environ.get('BAMBI_TTS_THREADS', '4'))
        options.inter_op_num_threads = 1
        # Let inference workers sleep between phrases so audio/UI and the desktop
        # can use the cores while the GPU prepares the next reply.
        options.add_session_config_entry('session.intra_op.allow_spinning', '0')
        options.add_session_config_entry('session.inter_op.allow_spinning', '0')
        options.enable_cpu_mem_arena = True
        session = ort.InferenceSession(str(self.model), options, providers=['CPUExecutionProvider'])
        self.engine = Kokoro.from_session(session, str(self.bundle))
        self.registry = VoiceRegistry(self.engine.voices)
        self.cache = Path(cache or ROOT / 'runtime/tts-cache')
        self.cache.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        with self.model.open('rb') as source:
            self.model_id = hashlib.file_digest(source, 'sha256').hexdigest()
        self.cache_hits = 0
        self.cache_misses = 0

    def synthesize(self, text, voice, speed):
        audio, rate, _ = self.synthesize_timed(text, voice, speed)
        return audio, rate

    def synthesize_timed(self, text, voice, speed):
        text = spoken_input(text)
        if not text.strip() or len(text) > 180:
            raise ValueError('Kokoro expects a short spoken phrase of at most 180 characters')
        if not .25 <= speed <= 1.5:
            raise ValueError('Effective speech speed must be 0.25–1.5')
        synthesis_text = text
        synthesis_speed = speed
        style = self.registry.style(voice)
        cache_key = [self.model_id, self.registry.fingerprint(voice), synthesis_text, synthesis_speed, 'en-us', 'kokoro-onnx-0.6.1', 'word-timing-v3-partial']
        key = hashlib.sha256(json.dumps(cache_key).encode()).hexdigest()
        path = self.cache / f'{key}.npy'
        timing_path = path.with_suffix('.json')
        with self.lock:
            if path.is_file() and timing_path.is_file():
                self.cache_hits += 1
                return np.load(path, allow_pickle=False), self.sample_rate, json.loads(timing_path.read_text())
            self.cache_misses += 1
            samples, rate, timings = self.engine.create_timed(synthesis_text, voice=style, speed=synthesis_speed, lang='en-us', is_phonemes=False, trim=True,
                                                            sentence_pause=0, clause_pause=0)
            captions = word_timings(text, timings, self.engine.tokenizer)
            samples = np.asarray(samples, dtype=np.float32)
            if not len(samples) or not np.isfinite(samples).all():
                raise ValueError('Kokoro returned empty or invalid audio')
            temporary = path.with_suffix(f'.{os.getpid()}.tmp')
            with temporary.open('wb') as output:
                np.save(output, samples, allow_pickle=False)
            temporary.replace(path)
            timing_path.write_text(json.dumps(captions))
            files = list(self.cache.glob('*.npy'))
            if len(files) > 256:
                for old in sorted(files, key=lambda p: p.stat().st_mtime)[:len(files)-256]:
                    old.unlink(missing_ok=True)
                    old.with_suffix('.json').unlink(missing_ok=True)
            return samples, rate, captions
