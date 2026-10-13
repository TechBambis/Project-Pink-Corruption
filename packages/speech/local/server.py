# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Loopback-only service compatible with the existing captioned Kokoro client."""
import base64
import ctypes
import json
import os
import select
import secrets
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from .config import CALIBRATION, load_preset, preset_catalog
from .dsp import wav_bytes
from .provider import KokoroProvider
from .renderer import Renderer
from .access import render_token
from .supertonic import SupertonicProvider, SupertonicVoices, available as supertonic_available, controls as supertonic_controls
from .qwen3 import QwenRenderer, QwenVoices, STYLES as QWEN_STYLES, available as qwen_available, validate_config as qwen_config
from .moss_service import MossRenderer, MossVoices, voices as moss_voices, validate_config as moss_config

def main():
    started = time.perf_counter()
    provider = KokoroProvider()
    renderer = Renderer(provider)
    supertonic = None
    moss = MossRenderer()
    render_lock = threading.Lock()
    startup_seconds = time.perf_counter() - started

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def local_access(self):
            hosts = [f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}']
            if (len(self.headers.get_all('Host', [])) != 1 or self.headers.get('Host') not in hosts
                    or self.headers.get_all('Origin') is not None
                    or self.headers.get('Sec-Fetch-Site') == 'cross-site'):
                self.close_connection = True
                self.reply(403, {'error': 'Local server access required'})
                return False
            return True

        def reply(self, status, body, content_type='application/json', headers=None):
            data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if self.close_connection:
                self.send_header('Connection', 'close')
            for key, value in (headers or {}).items():
                self.send_header(key, str(value))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if not self.local_access():
                return
            path = urlparse(self.path).path
            if path == '/health':
                self.reply(200, {'ok': True, 'engine': 'kokoro-onnx', 'offline': True, 'device': 'CPUExecutionProvider',
                                 'startupSeconds': startup_seconds, 'modelSha256': provider.model_id,
                                 'cpu': provider.cpu_options,
                                 'voices': provider.registry.names(), 'cacheHits': provider.cache_hits, 'cacheMisses': provider.cache_misses})
            elif path == '/desktop/identity' and secrets.compare_digest(self.headers.get('X-Bambi-TTS-Token', ''), credential):
                self.reply(200, {'app': 'bambi-local', 'service': 'kokoro', 'protocol': 1, 'pid': os.getpid(),
                                 'instance': os.environ.get('BAMBI_INSTANCE_TOKEN'), 'modelSha256': provider.model_id,
                                 'processCodePage': ctypes.windll.kernel32.GetACP() if os.name == 'nt' else None})
            elif path == '/v1/audio/voices':
                self.reply(200, {'voices': provider.registry.names() + moss_voices()})
            elif path == '/lab/catalog':
                installed_moss = moss_voices()
                self.reply(200, {'voices': provider.registry.names(), 'presets': preset_catalog(), 'calibrationText': CALIBRATION,
                                 'providers': {
                                     'kokoro': {'label': 'Kokoro', 'available': True, 'voices': provider.registry.names(), 'voiceBlending': True},
                                     'supertonic3': {'label': 'Supertonic 3', 'available': supertonic_available(), 'voices': SupertonicVoices().names(),
                                                     'voiceBlending': False, 'qualitySteps': [4, 5, 10], 'defaultSteps': 5, 'labOnly': True},
                                     'qwen3': {'label': 'Qwen VoiceDesign', 'available': qwen_available(), 'voices': QwenVoices().names(),
                                               'voiceBlending': False, 'labOnly': True, 'instructions': QWEN_STYLES,
                                               'backends': ['Vulkan0', 'CPU'], 'maxTextLength': 600},
                                     'moss': {'label': 'MOSS reference · experimental', 'available': bool(installed_moss), 'voices': installed_moss,
                                              'voiceBlending': False, 'wordTimings': False, 'nativeVocalTags': False,
                                              'labOnly': False, 'experimental': True, 'maxTextLength': 1000, 'nativePace': True}},
                                 'pitchMode': 'varispeed: pitch and duration change together', 'runtime': 'kokoro-onnx CPU, local 24 kHz'})
            else:
                self.reply(404, {'error': 'Unknown local TTS endpoint'})

        def do_POST(self):
            nonlocal supertonic
            if not self.local_access():
                return
            credentials = self.headers.get_all('X-Bambi-TTS-Token', [])
            if len(credentials) != 1 or not secrets.compare_digest(credentials[0].encode(), credential.encode()):
                self.close_connection = True
                self.reply(401, {'error': 'Local speech credential required'})
                return
            if (self.headers.get_content_type() != 'application/json'
                    or len(self.headers.get_all('Content-Type', [])) != 1):
                self.close_connection = True
                self.reply(415, {'error': 'JSON content type required'})
                return
            if self.headers.get_all('Transfer-Encoding') is not None or len(self.headers.get_all('Content-Length', [])) != 1:
                self.close_connection = True
                self.reply(400, {'error': 'A single content length is required'})
                return
            path = urlparse(self.path).path
            if path not in ['/lab/render', '/dev/captioned_speech', '/v1/audio/speech']:
                self.close_connection = True
                self.reply(404, {'error': 'Unknown local TTS endpoint'})
                return
            if not render_lock.acquire(blocking=False):
                # Body is intentionally unread; never reuse this connection as if
                # its JSON body were the next HTTP request line.
                self.close_connection = True
                self.reply(429, {'error': 'Local voice renderer is busy. Wait or stop the current request.'})
                return
            streaming = False
            generator = None
            try:
                self.connection.settimeout(30)
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 65536:
                    self.close_connection = True
                    raise ValueError('Request body must be 1–65536 bytes')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError('Request body must be an object')
                text = data.get('text', data.get('input', ''))
                if not isinstance(text, str) or not text.strip() or len(text) > 3000:
                    raise ValueError('Text must contain 1–3000 characters')
                engine = data.get('provider', 'kokoro')
                if engine not in ('kokoro', 'supertonic3', 'qwen3', 'moss') or (engine in ('supertonic3', 'qwen3') and path != '/lab/render'):
                    raise ValueError('This provider is available only in Voice Lab')
                phrase_mode = data.get('phraseMode', 'passage' if engine in ('qwen3', 'moss') else 'clauses' if engine == 'kokoro' else 'sentences')
                allowed_modes = ('passage',) if engine == 'moss' else ('passage', 'sentences') if engine == 'qwen3' else ('clauses', 'sentences') if engine == 'supertonic3' else ('clauses',)
                if phrase_mode not in allowed_modes:
                    raise ValueError('Unsupported phrase mode: Qwen uses passage or sentences; Kokoro uses clauses')
                config = load_preset(data.get('preset', 'bambi_local_clean'), data.get('overrides'))
                if data.get('voice') is not None:
                    config = load_preset(config['id'], {**(data.get('overrides') or {}), 'voice': data['voice']})
                if data.get('speed') is not None:
                    config = load_preset(config['id'], {**(data.get('overrides') or {}), 'voice': config['voice'], 'speed': data['speed']})
                registry = MossVoices() if engine == 'moss' else SupertonicVoices() if engine == 'supertonic3' else QwenVoices() if engine == 'qwen3' else provider.registry
                registry.style(config['voice'])
                for layer in config['layers'].values():
                    if layer['enabled']:
                        registry.style(layer['voice'])
                selected_renderer = renderer
                if engine == 'moss':
                    moss_config(config)
                    selected_renderer = moss
                if engine == 'qwen3':
                    qwen_config(config)
                    selected_renderer = QwenRenderer(data.get('instruct', QWEN_STYLES.get(config['voice'], '')),
                                                     data.get('seed', 41), data.get('backend', 'Vulkan0'), phrase_mode)
                if engine == 'supertonic3':
                    steps, seed = supertonic_controls(data.get('steps', 5), data.get('seed', 41))
                    if supertonic is None:
                        supertonic = SupertonicProvider(threads=provider.cpu_options['threads'])
                    supertonic.configure(steps, seed)
                    selected_renderer = Renderer(supertonic, split_clauses=phrase_mode == 'clauses')
                def disconnected():
                    try:
                        if not select.select([self.connection], [], [], 0)[0]:
                            return False
                        return self.connection.recv(1, socket.MSG_PEEK | getattr(socket, 'MSG_DONTWAIT', 0)) == b''
                    except (BlockingIOError, TimeoutError):
                        return False
                    except OSError:
                        return True
                if path == '/dev/captioned_speech':
                    trigger = data.get('trigger', False)
                    if not isinstance(trigger, bool):
                        raise ValueError('trigger must be boolean')
                    # Background continues seamlessly in the existing browser audio engine.
                    config['drone']['enabled'] = False
                    config['noise']['enabled'] = False
                    whole_utterance = data.get('whole_utterance', False)
                    if not isinstance(whole_utterance, bool):
                        raise ValueError('whole_utterance must be boolean')
                    generator = (moss.chunks(text, config['voice'], data.get('seed', 41), disconnected, config['timing']) if engine == 'moss'
                                 else renderer.chunks(text, config, cancel=disconnected, trigger=trigger))
                    if engine == 'moss' and (trigger or whole_utterance):
                        import numpy as np
                        collected = list(generator)
                        samples = np.concatenate([chunk['samples'] for chunk in collected])
                        generator.close()
                        generator = iter([{'samples': samples, 'text': collected[-1]['text'], 'final': True, 'whole': True}])
                    first = next(generator, None)
                    if first is None:
                        raise ValueError('No spoken phrases')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/x-ndjson')
                    self.send_header('Connection', 'close')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.end_headers()
                    self.close_connection = True
                    streaming = True
                    stream_id = uuid.uuid4().hex
                    def write(chunk):
                        if engine == 'moss':
                            duration = len(chunk['samples']) / 48000
                            payload = {'audio': base64.b64encode(wav_bytes(chunk['samples'], 48000)).decode(),
                                       'audio_format': 'wav', 'timestamps': [], 'text': chunk['text'], 'spoken_seconds': duration,
                                       'pause_ms': 0, 'caption_mode': 'phrase', 'timing_source': 'unavailable',
                                       'history_mode': 'complete', 'preset': config['id']}
                            if not chunk.get('whole'):
                                payload['stream'] = {'id': stream_id, 'final': chunk['final'], 'index': chunk['index'],
                                                     'offset': chunk['offset'], 'samples': len(chunk['samples']),
                                                     'sampleRate': 48000, 'channels': 2}
                            self.wfile.write(json.dumps(payload).encode() + b'\n'); self.wfile.flush()
                            return
                        payload = {'audio': base64.b64encode(wav_bytes(chunk['samples'], config['sampleRate'])).decode(),
                                   'audio_format': 'wav', 'timestamps': chunk['timestamps'], 'text': chunk['text'],
                                   'spoken_seconds': chunk['spokenSeconds'], 'pause_ms': chunk['pauseMs'],
                                   'caption_mode': 'word' if chunk['timestamps'] else 'phrase',
                                   'timing_source': 'kokoro-phoneme-pcm-onset' if chunk['timestamps'] else 'unavailable', 'preset': config['id']}
                        self.wfile.write(json.dumps(payload).encode() + b'\n')
                        self.wfile.flush()
                    write(first)
                    for chunk in generator:
                        write(chunk)
                else:
                    audio, report = (moss.render(text, config, disconnected, data.get('seed', 41)) if engine == 'moss'
                                     else selected_renderer.render(text, config, cancel=disconnected))
                    self.reply(200, audio, 'audio/wav', {'X-Audio-Duration': report['durationSeconds'],
                               'X-Render-Seconds': report['renderSeconds'], 'X-Audio-Peak': report['peak'],
                               'X-Audio-Preset': config['id'], 'X-Audio-Provider': engine})
            except (BrokenPipeError, ConnectionResetError, InterruptedError):
                pass
            except (ValueError, KeyError, TypeError, StopIteration) as error:
                if not streaming:
                    self.reply(400, {'error': str(error)})
            except Exception as error:
                print(f'Local TTS render failed: {error}', flush=True)
                if not streaming:
                    self.reply(503, {'error': 'Local voice rendering failed. Check its explicit setup and runtime/tts.log.'})
            finally:
                try:
                    if generator is not None and hasattr(generator, 'close'):
                        generator.close()
                finally:
                    render_lock.release()

        def log_request(self, code='-', size='-'):
            method = self.command if self.command in ['GET', 'POST'] else 'HTTP'
            print(f'{method} {code}', flush=True)

        def log_message(self, format, *args):
            # Malformed request lines can contain text; never print their content.
            print('Local TTS HTTP request rejected', flush=True)

    host = '127.0.0.1'
    port = int(os.environ.get('BAMBI_TTS_PORT', '8882'))
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        credential = render_token()
    except Exception:
        server.server_close()
        raise
    print(f'Offline Kokoro CPU READY http://{host}:{port} in {startup_seconds:.2f}s', flush=True)
    server.serve_forever()

if __name__ == '__main__':
    main()
