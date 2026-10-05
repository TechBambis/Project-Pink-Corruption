# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import time
import re
import numpy as np
from .background import drone, noise
from .dsp import limit, pitch_shift, process_voice, resample, wav_bytes
from .timing import phrases

BUS_NAMES = ['main_voice', 'left_voice', 'right_voice', 'echo_voice', 'drone', 'noise', 'music_optional']

def gain(db):
    return 10 ** (db / 20)

def pan_mono(samples, pan=0):
    # Linear balance with centered narration at 0 dB in both channels.
    return samples[:, None] * np.array([1 - max(0, pan), 1 + min(0, pan)], np.float32)

def mix_buses(buses, levels, ceiling):
    frames = max((len(audio) for audio in buses.values()), default=0)
    output = np.zeros((frames, 2), dtype=np.float32)
    for name, samples in buses.items():
        if name not in BUS_NAMES:
            raise ValueError('Unknown speech bus')
        output[:len(samples)] += samples * gain(levels[name])
    peak = float(np.max(np.abs(output))) if output.size else 0.
    return limit(output, ceiling), peak

class Renderer:
    def __init__(self, provider):
        self.provider = provider

    def vocal_unit(self, phrase, config, trigger=False, with_timestamps=False):
        rate = config['sampleRate']
        settings = config.get('trigger', {}) if trigger else {}
        multiplier = settings.get('speedMultiplier', 1)
        speed = min(1.5, max(.25, config['speed'] * multiplier))
        timestamps = []
        if phrase.text and with_timestamps and hasattr(self.provider, 'synthesize_timed'):
            raw, source_rate, timestamps = self.provider.synthesize_timed(phrase.text, config['voice'], speed)
        else:
            raw, source_rate = self.provider.synthesize(phrase.text, config['voice'], speed) if phrase.text else (np.zeros(0, np.float32), rate)
        main = process_voice(pitch_shift(resample(raw, source_rate, rate), config['pitchSemitones']), rate, config['processing'])
        # Each enabled side is synthesized independently, not a duplicate of every phrase by default.
        buses = {'main_voice': pan_mono(main)}
        for name in ['left_voice', 'right_voice']:
            item = config['layers'][name]
            if item['enabled'] and phrase.text:
                samples, source = self.provider.synthesize(phrase.text, item['voice'], min(1.5, max(.25, item['speed'] * multiplier)))
                samples = process_voice(pitch_shift(resample(samples, source, rate), item['pitchSemitones']), rate, config['processing'])
                delay = round(item['delayMs'] * rate / 1000)
                buses[name] = np.pad(pan_mono(samples, item['pan']), ((delay, 0), (0, 0)))
        if config['processing']['enabled'] and config['processing']['echoEnabled'] and len(main):
            delay = round(config['processing']['echoMs'] * rate / 1000)
            buses['echo_voice'] = np.pad(pan_mono(main), ((delay, 0), (0, 0)))
        if trigger:
            for name in buses:
                buses[name] *= gain(settings.get('volumeDb', 0))
        frames = max([len(main), *[len(x) for x in buses.values()]]) + round(phrase.pause_ms * rate / 1000)
        for name, samples in list(buses.items()):
            buses[name] = np.pad(samples, ((0, frames - len(samples)), (0, 0)))
        # Varispeed pitch shifting changes both duration and word boundaries.
        ratio = 2 ** (-config['pitchSemitones'] / 12)
        timestamps = [{**word, 'start_time': word['start_time'] * ratio,
                       'end_time': min(len(main) / rate, word['end_time'] * ratio)} for word in timestamps]
        first_words = re.findall(r"[\w]+(?:['’\-][\w]+)*", phrase.text)
        if timestamps and len(main) >= 3 and first_words and timestamps[0]['word'].casefold() == first_words[0].casefold():
            # Model padding durations can place the first phoneme too late.
            # Calibrate isolated trigger onset against the processed main PCM;
            # keep subsequent word boundaries from the model duration output.
            threshold = float(np.max(np.abs(main))) * .001
            audible = np.abs(main) > threshold
            starts = np.flatnonzero(audible[:-2] & audible[1:-1] & audible[2:])
            if len(starts):
                timestamps[0]['start_time'] = float(starts[0] / rate)
        return (buses, len(main) / rate, timestamps) if with_timestamps else (buses, len(main) / rate)

    def chunks(self, text, config, cancel=lambda: False, trigger=False):
        """One phrase at a time, with silence and real backpressure at the HTTP stream."""
        offset = 0
        for phrase in phrases(text, config['timing']):
            if cancel():
                return
            buses, spoken_seconds, timestamps = self.vocal_unit(phrase, config, trigger=trigger, with_timestamps=True)
            frames = len(buses['main_voice'])
            if config['drone']['enabled']:
                buses['drone'] = drone(frames, config['sampleRate'], config['drone'], offset)
            # Full noise rendered below; chunked live voice keeps beds on browser buses.
            if config['noise']['enabled']:
                buses['noise'] = noise(frames, config['sampleRate'], config['noise'], seed=offset)
            mixed, peak = mix_buses(buses, config['mix'], config['limiterPeak'])
            yield {'samples': mixed, 'text': phrase.text, 'spokenSeconds': spoken_seconds, 'offset': offset,
                   'pauseMs': phrase.pause_ms, 'peakBeforeLimiter': peak, 'timestamps': timestamps}
            offset += frames

    def render(self, text, config, music=None, cancel=lambda: False):
        started = time.perf_counter()
        # Render narration on independent buses, then add one continuous stereo bed.
        vocal_config = {**config, 'drone': {**config['drone'], 'enabled': False}, 'noise': {**config['noise'], 'enabled': False}}
        blocks = {name: [] for name in BUS_NAMES[:4]}
        timeline = []
        offset = 0
        rate = config['sampleRate']
        for phrase in phrases(text, config['timing']):
            if cancel():
                raise InterruptedError('Local render cancelled')
            buses, duration = self.vocal_unit(phrase, vocal_config)
            frames = len(buses['main_voice'])
            for name in blocks:
                blocks[name].append(buses.get(name, np.zeros((frames, 2), np.float32)))
            timeline.append({'text': phrase.text, 'start': offset / rate, 'spokenSeconds': duration, 'pauseMs': phrase.pause_ms})
            offset += frames
            if offset / rate > 600:
                raise ValueError('Rendered audio exceeds ten minutes')
        if not offset:
            raise ValueError('Text contains no speech or pauses')
        if offset / rate > 600:
            raise ValueError('Rendered audio exceeds ten minutes')
        buses = {name: np.concatenate(parts) for name, parts in blocks.items()}
        buses['drone'] = drone(offset, rate, config['drone'])
        buses['noise'] = noise(offset, rate, config['noise'])
        if music is not None:
            samples, source_rate = music
            samples = resample(samples, source_rate, rate)
            if samples.ndim == 1:
                samples = pan_mono(samples)
            if samples.ndim != 2 or samples.shape[1] != 2 or not np.isfinite(samples).all():
                raise ValueError('Music must be finite mono or stereo PCM')
            samples = samples[:offset]
            buses['music_optional'] = np.pad(samples, ((0, offset - len(samples)), (0, 0)))
        output, peak = mix_buses(buses, config['mix'], config['limiterPeak'])
        elapsed = time.perf_counter() - started
        report = {'sampleRate': rate, 'channels': 2, 'frames': len(output), 'durationSeconds': len(output) / rate,
                  'renderSeconds': elapsed, 'realtimeFactor': elapsed / (len(output) / rate),
                  'peakBeforeLimiter': peak, 'peak': float(np.max(np.abs(output))),
                  'limitedSamples': int(np.sum(np.abs(sum(buses[name] * gain(config['mix'][name]) for name in buses)) > config['limiterPeak'])),
                  'timeline': timeline, 'voice': config['voice'], 'preset': config['id'],
                  'cacheHits': getattr(self.provider, 'cache_hits', 0), 'cacheMisses': getattr(self.provider, 'cache_misses', 0)}
        return wav_bytes(output, rate), report
