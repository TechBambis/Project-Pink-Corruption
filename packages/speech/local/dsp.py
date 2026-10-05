# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Small local DSP routines. NumPy/SciPy only; no external audio programs."""
import io
import math
import wave
from fractions import Fraction
import numpy as np
from scipy import signal

def resample(audio, source_rate, target_rate):
    if source_rate == target_rate:
        return audio.copy()
    ratio = Fraction(int(target_rate), int(source_rate))
    return signal.resample_poly(audio, ratio.numerator, ratio.denominator, axis=0).astype(np.float32)

def pitch_shift(audio, semitones):
    # Deliberately simple varispeed: pitch and duration change together.
    if not semitones:
        return audio.copy()
    ratio = Fraction(2 ** (-semitones / 12)).limit_denominator(1000)
    return signal.resample_poly(audio, ratio.numerator, ratio.denominator, axis=0).astype(np.float32)

def highpass(audio, rate, hz):
    if not hz:
        return audio.copy()
    return signal.sosfilt(signal.butter(2, hz, 'highpass', fs=rate, output='sos'), audio, axis=0).astype(np.float32)

def eq(audio, rate, hz, db):
    if not db:
        return audio.copy()
    # RBJ peaking EQ, Q=0.7. Gentle broad coloration, no pitch manipulation.
    a = 10 ** (db / 40)
    omega = 2 * math.pi * hz / rate
    alpha = math.sin(omega) / (2 * .7)
    cosine = math.cos(omega)
    b = np.array([1 + alpha * a, -2 * cosine, 1 - alpha * a])
    denominator = np.array([1 + alpha / a, -2 * cosine, 1 - alpha / a])
    return signal.lfilter(b / denominator[0], denominator / denominator[0], audio, axis=0).astype(np.float32)

def compress(audio, rate, threshold_db, ratio, attack_ms, release_ms):
    if ratio == 1 or not len(audio):
        return audio.copy()
    detector = np.abs(audio) if audio.ndim == 1 else np.max(np.abs(audio), axis=1)
    attack = math.exp(-1 / (rate * attack_ms / 1000))
    release = math.exp(-1 / (rate * release_ms / 1000))
    envelope = np.empty(len(detector), dtype=np.float32)
    previous = 0.
    for i, value in enumerate(detector):
        coefficient = attack if value > previous else release
        previous = coefficient * previous + (1 - coefficient) * float(value)
        envelope[i] = previous
    level = 20 * np.log10(np.maximum(envelope, 1e-8))
    reduction = np.maximum(level - threshold_db, 0) * (1 - 1 / ratio)
    gain = np.power(10., -reduction / 20).astype(np.float32)
    return audio * (gain if audio.ndim == 1 else gain[:, None])

def process_voice(audio, rate, settings):
    # Leading or consecutive pause markers have no vocal samples yet. SciPy's
    # filters cannot process a zero-length signal; the renderer adds silence.
    if not len(audio) or not settings['enabled']:
        return audio.copy()
    audio = highpass(audio, rate, settings['highpassHz'])
    audio = eq(audio, rate, settings['eqHz'], settings['eqDb'])
    return compress(audio, rate, settings['thresholdDb'], settings['compressionRatio'],
                    settings['attackMs'], settings['releaseMs'])

def limit(audio, ceiling=.98):
    """Final peak-only limiter: reduce over-ceiling samples, no loudness boost."""
    return np.clip(audio, -ceiling, ceiling).astype(np.float32)

def wav_bytes(audio, rate):
    if not np.isfinite(audio).all():
        raise ValueError('Cannot encode non-finite audio')
    out = io.BytesIO()
    channels = 1 if audio.ndim == 1 else audio.shape[1]
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    return out.getvalue()
