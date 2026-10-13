# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit offline MOSS CPU adapter core; one speaker and one active stream.

The upstream runtime is imported from verified local setup assets. No weights
or reference are provisioned by this module. Word times/native vocal tags are
not advertised. HTTP, epochs and playback remain owned by their existing layers.
"""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import queue
import sys
import threading
import time

from .config import ROOT, DATA, MODELS
from .moss_profile import PROFILE, digest, verify_profile

class MossProvider:
    """Native PCM stream. Instantiate only in an explicitly selected CPU worker."""
    sample_rate = PROFILE['sampleRate']
    channels = PROFILE['channels']
    word_timings = False
    native_vocal_tags = False

    def __init__(self, reference, *, derived_directory, threads=3):
        if type(threads) is not int or threads not in (1, 2, 3, 4, 6):
            raise ValueError('Unsupported MOSS CPU thread count')
        reference = Path(reference)
        if reference.is_symlink() or not reference.is_file():
            raise ValueError('An explicitly installed local reference is required')
        graph_paths = verify_profile(derived_directory)
        spec = importlib.util.spec_from_file_location('moss_setup', ROOT / 'scripts/setup-live-voice.py')
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        manifest = json.loads((ROOT / 'config/live-voice-experiment.json').read_text())
        pins = next(p for p in manifest['providers'] if p['id'] == 'moss')
        if manifest['version'] != 1 or pins['status'] != 'experiment-only':
            raise RuntimeError('MOSS requires its explicitly provisionable pinned source profile')
        for group, directory in [('assets', MODELS / 'live-voice/moss'),
                                 ('sources', DATA / '.runtime/live-voice/sources/moss')]:
            for asset in pins[group]:
                if not setup.verified(setup.destination(directory, asset), asset):
                    raise ValueError('Run explicit MOSS setup: ' + asset['path'])
        os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
        import numpy as np
        import torch
        import onnxruntime as ort
        if torch.version.cuda is not None:
            raise RuntimeError('MOSS live uses the CPU reference environment')
        torch.set_num_threads(threads)
        if torch.get_num_interop_threads() != 1:
            torch.set_num_interop_threads(1)
        sys.path.insert(0, str(DATA / '.runtime/live-voice/sources/moss'))
        from onnx_tts_runtime import OnnxTtsRuntime
        from ort_cpu_runtime import _resolve_stream_decode_frame_budget
        original = (MODELS / 'live-voice/moss/MOSS-TTS-Nano-100M-ONNX').resolve()
        redirected = []

        class CpuRuntime(OnnxTtsRuntime):
            def _session(runtime, path_value):
                path = Path(path_value).resolve()
                selected = graph_paths.get(path.name) if path.parent == original else None
                if selected:
                    redirected.append(path.name)
                options = ort.SessionOptions()
                options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                options.intra_op_num_threads = threads
                options.inter_op_num_threads = 1
                options.add_session_config_entry('session.intra_op.allow_spinning', '0')
                options.add_session_config_entry('session.inter_op.allow_spinning', '0')
                return ort.InferenceSession(str(selected or path), sess_options=options,
                                           providers=['CPUExecutionProvider'])

        self.model = CpuRuntime(MODELS / 'live-voice/moss', thread_count=threads,
                               max_new_frames=375, sample_mode='fixed', execution_provider='cpu',
                               output_dir=DATA / 'runtime/moss-live')
        if (set(redirected) != set(graph_paths) or len(redirected) != len(graph_paths)
                or self.model.codec_meta['codec_config']['sample_rate'] != self.sample_rate
                or self.model.codec_meta['codec_config']['channels'] != self.channels):
            raise RuntimeError('MOSS did not activate the verified CPU profile and codec')
        self.reference = self.model.encode_reference_audio(reference)
        self.reference_sha256 = digest(reference)
        self.conditioning_id = hashlib.sha256(json.dumps(self.reference, separators=(',', ':')).encode()).hexdigest()
        self.threads = threads
        self._np, self._budget = np, _resolve_stream_decode_frame_budget
        self._slot = threading.Lock()
        self._poisoned = False

    def stream(self, text, *, seed=41, cancel=lambda: False, deadline=None):
        """Yield unchanged float32 PCM; cancel also stops a blocked producer.

        The two-packet handoff bounds renderer memory. Caller close discards
        queued future PCM, waits for codec reset, then permits another job.
        A stuck native call poisons this instance instead of reusing its state.
        """
        from .spoken import english_research_input
        if (not isinstance(text, str) or not 1 <= len(text) <= PROFILE['maxTextLength']
                or type(seed) is not int or not 0 <= seed < 2**32):
            raise ValueError('Invalid bounded MOSS input')
        prepared = english_research_input(text)
        if not prepared.strip() or len(prepared) > PROFILE['maxTextLength']:
            raise ValueError('MOSS input is empty or too long after English preparation')
        deadline = time.monotonic() + 120 if deadline is None else deadline
        if (type(deadline) not in (int, float) or not math.isfinite(deadline)
                or deadline > time.monotonic() + 120):
            raise ValueError('MOSS requires a bounded monotonic deadline')
        if self._poisoned or not self._slot.acquire(blocking=False):
            raise RuntimeError('MOSS worker is busy or requires restart')
        stop, packets = threading.Event(), queue.Queue(maxsize=2)
        np = self._np

        def check():
            if stop.is_set() or cancel() or time.monotonic() >= deadline:
                raise InterruptedError('MOSS synthesis cancelled')

        def put(value):
            while not stop.is_set():
                check()
                try:
                    packets.put(value, timeout=.025)
                    return
                except queue.Full:
                    pass
            raise InterruptedError('MOSS synthesis cancelled')

        def produce():
            error = None
            try:
                check()
                self.model.rng = np.random.default_rng(seed)
                rows = self.model.build_voice_clone_request_rows(self.reference, self.model.encode_text(prepared))
                self.model.codec_streaming_session.reset()
                pending, emitted, first_audio = [], 0, None

                def decode(force=False):
                    nonlocal emitted, first_audio
                    check()
                    count = len(pending)
                    budget = self._budget(emitted, self.sample_rate, first_audio)
                    if not count or not force and count < budget:
                        return
                    count = count if force else min(count, max(1, budget))
                    frames = pending[:count]
                    del pending[:count]
                    result = self.model.codec_streaming_session.run_frames(frames)
                    check()
                    if result is None:
                        return
                    audio, length = result
                    if length <= 0:
                        return
                    pcm = np.asarray(audio[0, :, :length], dtype=np.float32).T.copy()
                    if (pcm.ndim != 2 or pcm.shape[1] != self.channels or not np.isfinite(pcm).all()
                            or len(pcm) != length or emitted + length > self.sample_rate * 30):
                        raise ValueError('Invalid bounded MOSS PCM')
                    if first_audio is None:
                        first_audio = time.perf_counter()
                    emitted += length
                    put(('pcm', pcm))

                def on_frame(_frames, _index, frame):
                    check()
                    pending.append(list(frame))
                    decode()

                generated = self.model.generate_audio_frames(rows, on_frame=on_frame)
                check()
                if len(generated) >= 375:
                    raise RuntimeError('MOSS reached its generation bound; output is incomplete')
                decode(True)
                if not emitted:
                    raise RuntimeError('MOSS produced no PCM')
            except Exception as failure:
                error = failure
            finally:
                try:
                    self.model.codec_streaming_session.reset()
                except Exception as failure:
                    error = failure
                    self._poisoned = True
                if not stop.is_set():
                    try:
                        put(('error' if error else 'end', error))
                    except InterruptedError:
                        pass

        thread = threading.Thread(target=produce, name='moss-render', daemon=True)
        try:
            thread.start()
            while True:
                check()
                try:
                    kind, value = packets.get(timeout=.025)
                except queue.Empty:
                    if not thread.is_alive():
                        raise RuntimeError('MOSS producer exited without completion')
                    continue
                check()
                if kind == 'error':
                    raise value
                if kind == 'end':
                    return
                yield value
        finally:
            stop.set()
            if thread.ident is not None:
                thread.join(2)
            if thread.is_alive():
                self._poisoned = True
            self._slot.release()
            if self._poisoned:
                raise RuntimeError('MOSS did not reset before its cleanup deadline; restart its owned worker')
