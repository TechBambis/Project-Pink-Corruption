# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit offline same-text Kokoro/Nano experiment with public synthetic audio."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEXTS = [
    'You still get to choose exactly what to delegate.',
    'You think I am making a mistake? Then tell me which part you disagree with.',
    'Good. Keep your attention here, and let me finish the thought.',
]
REFERENCE_TEXT = 'Stay with this thought for a moment. You can change your mind, and I will listen. Now tell me which part you want to explore.'


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def worker(kind, output, threads):
    started = time.perf_counter()
    import numpy as np
    from packages.speech.local.dsp import wav_bytes
    result = {'engine':kind, 'threads':threads, 'measurements':[], 'status':'loading'}
    path = output / f'{kind}.json'
    write_json(path, result)
    if kind == 'kokoro':
        from packages.speech.local.provider import KokoroProvider
        imported = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix='kokoro-cache-', dir=output) as cache:
            provider = KokoroProvider(cache=cache)
            loaded = time.perf_counter()
            reference, rate = provider.synthesize(REFERENCE_TEXT, 'af_heart', .78)
            if len(reference) / rate <= 5:
                raise RuntimeError('The public synthetic reference is too short.')
            reference_path = output / 'reference-kokoro-af-heart.wav'
            reference_path.write_bytes(wav_bytes(reference, rate))
            result['reference'] = {'text':REFERENCE_TEXT, 'source':'local Kokoro af_heart, speed .78; public synthetic audio, no human reference',
                'seconds':len(reference)/rate, 'sha256':hashlib.sha256(reference_path.read_bytes()).hexdigest()}
            warm = time.perf_counter()
            for repeat in range(3):
                provider.cache = Path(cache) / str(repeat)
                provider.cache.mkdir()
                for index, text in enumerate(TEXTS):
                    begin = time.perf_counter()
                    samples, rate = provider.synthesize(text, 'af_heart', .78)
                    record(result, output, index, repeat, text, samples, rate, (time.perf_counter()-begin)*1000)
    else:
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        if torch.version.cuda is not None:
            raise RuntimeError('This experiment requires the explicitly installed CPU-only torch build.')
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        # Inference has local assets only; attempts to open remote sockets fail.
        def no_network(*args, **kwargs):
            raise RuntimeError('Network access is disabled during Nano inference; provision assets explicitly.')
        socket.socket.connect = no_network
        imported = time.perf_counter()
        model = ChatterboxTurboTTS.from_local(ROOT / 'models/chatterbox-nano', device='cpu', nano=True)
        loaded = time.perf_counter()
        with torch.inference_mode():
            model.prepare_conditionals(str(output / 'reference-kokoro-af-heart.wav'))
            result['conditioningMs'] = (time.perf_counter()-loaded)*1000
            torch.manual_seed(40)
            model.generate('The public comparison is ready.')
            warm = time.perf_counter()
            result['parameters'] = {name:sum(p.numel() for p in component.parameters())
                for name, component in [('t3',model.t3),('s3gen',model.s3gen),('voiceEncoder',model.ve)]}
            result['watermark'] = 'upstream Perth enabled'
            for repeat in range(3):
                for index, text in enumerate(TEXTS):
                    torch.manual_seed(41 + repeat)
                    begin = time.perf_counter()
                    samples = model.generate(text).squeeze(0).numpy()
                    record(result, output, index, repeat, text, samples, model.sr, (time.perf_counter()-begin)*1000)
            torch.manual_seed(44)
            tag_text = '[chuckle] You sound very certain. Let us see whether your argument holds.'
            samples = model.generate(tag_text).squeeze(0).numpy()
            (output / 'nano-chuckle-raw.wav').write_bytes(wav_bytes(samples, model.sr))
            result['extraTagText'] = tag_text
    result.update({'status':'complete','importMs':(imported-started)*1000,'modelLoadMs':(loaded-imported)*1000,
        'preparationAfterLoadMs':(warm-loaded)*1000,'maxRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
        'fullPhraseMedianMs':statistics.median(m['fullPhraseMs'] for m in result['measurements']),
        'rtfMedian':statistics.median(m['rtf'] for m in result['measurements'])})
    write_json(path, result)
    print(json.dumps({key:result[key] for key in ['engine','status','fullPhraseMedianMs','rtfMedian','maxRssMiB']}),flush=True)


def record(result, output, index, repeat, text, samples, rate, ms):
    import numpy as np
    from packages.speech.local.dsp import wav_bytes
    if not len(samples) or not np.isfinite(samples).all():
        raise RuntimeError('Invalid synthesized PCM.')
    seconds = len(samples)/rate
    if not 0.1 < seconds < 90 or np.max(np.abs(samples)) < 0.0001:
        raise RuntimeError('Invalid or silent phrase duration/amplitude.')
    filename = f'{result["engine"]}-{index+1}-{repeat+1}-raw.wav'
    (output/filename).write_bytes(wav_bytes(samples,rate))
    result['measurements'].append({'text':text,'repeat':repeat,'fullPhraseMs':ms,'audioSeconds':seconds,
        'rtf':ms/1000/seconds,'rawFile':filename,'sampleRate':rate,'peak':float(np.max(np.abs(samples)))})
    write_json(output/f'{result["engine"]}.json',result)
    print(json.dumps({'engine':result['engine'],'phrase':index+1,'repeat':repeat+1,'ms':round(ms,1),'audioSeconds':round(seconds,2)}),flush=True)


def listening_files(output):
    import numpy as np
    import soundfile as sf
    import pyloudnorm as ln
    from packages.speech.local.config import load_preset
    from packages.speech.local.dsp import pitch_shift, process_voice, wav_bytes
    config = load_preset('bambi_classic', {'drone':{'enabled':False},'noise':{'enabled':False}})
    results=[]
    for path in sorted(output.glob('*-raw.wav')):
        samples,rate = sf.read(path,dtype='float32')
        processed = process_voice(pitch_shift(samples,config['pitchSemitones']),rate,config['processing'])
        meter=ln.Meter(rate)
        loudness=meter.integrated_loudness(processed)
        if not np.isfinite(loudness):raise RuntimeError('Invalid loudness of listening artifact.')
        gain=min(10**((-23-loudness)/20), .98/max(float(np.max(np.abs(processed))),1e-6))
        matched=processed*gain
        destination=path.with_name(path.name.replace('-raw.wav','-listen.wav'))
        destination.write_bytes(wav_bytes(matched,rate))
        results.append({'file':destination.name,'lufs':float(meter.integrated_loudness(matched)),
            'processing':'same Classic pitch/DSP; loudness target -23 LUFS with .98 peak cap; no backgrounds'})
    write_json(output/'listening-files.json',results)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true')
    parser.add_argument('--worker',choices=['kokoro','nano','listening'])
    parser.add_argument('--threads',type=int,choices=[4,6],default=6)
    parser.add_argument('--output',default='runtime/tts-nano-comparison-2026-10-09')
    args=parser.parse_args()
    output=(ROOT/args.output).resolve()
    if not output.is_relative_to((ROOT/'runtime').resolve()):parser.error('Keep public artifacts under ignored runtime/.')
    if not args.run:parser.error('Use --run for real local speech inference.')
    output.mkdir(parents=True,exist_ok=True)
    if args.worker:
        if args.worker=='listening':listening_files(output)
        else:worker(args.worker,output,args.threads)
        return
    manifest=json.loads((ROOT/'config/tts-nano-experiment.json').read_text())
    spec=importlib.util.spec_from_file_location('nano_setup',ROOT/'scripts/setup-tts-nano.py')
    setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
    if not all(setup.verified(ROOT/'models/chatterbox-nano'/asset['file'],asset) for asset in manifest['files']):
        raise RuntimeError('Prepare pinned Nano weights explicitly before benchmarking.')
    for port in (6969,6971):
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/diagnostics/replies',timeout=5) as response:
            if any(reply['status']=='active' for reply in json.load(response)['replies']):
                raise RuntimeError('A real reply is active; defer this CPU comparison.')
    report={'scope':f'Three identical public texts, three uncached repetitions, CPU-only phrase synthesis, {args.threads} threads. Nano conditions on locally synthesized Kokoro reference. Complete-phrase API time, not streaming first PCM, conversation latency, human preference or physical output qualification.',
        'manifest':manifest,'texts':TEXTS,'runs':[]}
    write_json(output/'report.json',report)
    environment={**os.environ,'BAMBI_TTS_THREADS':str(args.threads),'BAMBI_TTS_DYNAMIC_BLOCK':'0','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1'}
    with (ROOT/'runtime/lifecycle.lock').open('a') as lease:
        fcntl.flock(lease,fcntl.LOCK_EX)
        for kind,python in [('kokoro',ROOT/'.runtime/tts-venv/bin/python'),('nano',ROOT/'.runtime/chatterbox-nano/venv/bin/python')]:
            subprocess.run([str(python),str(Path(__file__).resolve()),'--run','--worker',kind,'--threads',str(args.threads),'--output',str(output)],
                cwd=ROOT,env=environment,check=True,timeout=420)
            report['runs'].append(json.loads((output/f'{kind}.json').read_text()))
            write_json(output/'report.json',report)
        subprocess.run([str(ROOT/'.runtime/chatterbox-nano/venv/bin/python'),str(Path(__file__).resolve()),'--run','--worker','listening','--output',str(output)],cwd=ROOT,env=environment,check=True,timeout=90)
    report['status']='complete'
    write_json(output/'report.json',report)
    print('Public same-text audio and report:',output,flush=True)


if __name__=='__main__':
    main()
