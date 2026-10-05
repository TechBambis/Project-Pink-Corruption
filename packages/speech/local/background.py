# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import numpy as np
from scipy import signal

def drone(frames, rate, settings, offset=0):
    """Phase-continuous across chunks when offset is the total previous frames."""
    t = (np.arange(frames, dtype=np.float64) + offset) / rate
    output = np.zeros((frames, 2), dtype=np.float32)
    if not settings['enabled']:
        return output
    depth = settings['modDepth']
    for channel, ear in enumerate(['left', 'right']):
        for band in ['low', 'high']:
            frequency = settings[ear][f'{band}Hz']
            mod = settings[f'{band}ModHz']
            amplitude = 1 - depth / 2 + depth / 2 * np.sin(2 * np.pi * mod * t) if mod else 1.
            output[:, channel] += (.5 * np.sin(2 * np.pi * frequency * t) * amplitude).astype(np.float32)
    return output

def noise(frames, rate, settings, seed=0):
    output = np.zeros((frames, 2), dtype=np.float32)
    if not settings['enabled'] or not frames:
        return output
    rng = np.random.default_rng(seed)
    # FFT-colored local noise. Fixed seed makes exports and tests reproducible.
    frequencies = np.fft.rfftfreq(frames, 1 / rate)
    exponent = {'white': 0., 'pink': .5, 'brown': 1.}[settings['type']]
    spectrum_gain = np.maximum(frequencies, 20.) ** -exponent
    spectrum_gain[0] = 0
    for channel in range(2):
        spectrum = np.fft.rfft(rng.normal(size=frames)) * spectrum_gain
        samples = np.fft.irfft(spectrum, n=frames)
        samples = signal.sosfilt(signal.butter(2, settings['lowpassHz'], fs=rate, output='sos'), samples)
        rms = np.sqrt(np.mean(samples ** 2))
        output[:, channel] = samples / max(float(rms), 1e-8) * .22
    mid = output.mean(axis=1)
    width = settings['width']
    return (mid[:, None] * (1 - width) + output * width).astype(np.float32)
