# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Validate and launch one private Cydonia inference slot."""
import json
import os
import sys
from pathlib import Path

DEFAULTS = dict(context=32768, batch=2048, ubatch=512, threads=0,
                threadsBatch=0, cacheK='q8_0', cacheV='q8_0', cacheRAM=8192, graphOpt=0)
ENV = dict(context='CONTEXT', batch='BATCH', ubatch='UBATCH', threads='THREADS',
           threadsBatch='THREADS_BATCH', cacheK='CACHE_K', cacheV='CACHE_V',
           cacheRAM='CACHE_RAM', graphOpt='GRAPH_OPT')

def validate(values):
    unknown = set(values)-set(DEFAULTS)
    if unknown:
        raise ValueError('Unknown server configuration fields')
    config = {**DEFAULTS, **values}
    ranges = dict(context=(4096,131072), batch=(64,8192), ubatch=(64,4096),
                  threads=(0,16), threadsBatch=(0,16), cacheRAM=(0,16384), graphOpt=(0,1))
    for key, (low, high) in ranges.items():
        value = config[key]
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f'{key} must be an integer between {low} and {high}')
    if config['ubatch'] > config['batch']:
        raise ValueError('ubatch cannot exceed batch')
    if any(config[key] not in ['q8_0','f16'] for key in ['cacheK','cacheV']):
        raise ValueError('Only q8_0 and f16 KV cache are supported by these profiles')
    return config

def configured():
    path = Path(os.environ.get('BAMBI_CLOUD_PROFILE_FILE','.runtime/server-profile.json'))
    values = json.loads(path.read_text()) if path.exists() else {}
    for key, suffix in ENV.items():
        raw = os.environ.get('BAMBI_CLOUD_'+suffix)
        if raw is not None and raw.strip():
            values[key] = raw.strip() if key in ['cacheK','cacheV'] else int(raw)
    return validate(values)

def command(config, binary, model, keyfile):
    args = [binary,'--model',model,'--alias','Cydonia-24B-v4.3',
            '--host',os.environ.get('BAMBI_CLOUD_BIND','127.0.0.1'),
            '--port',os.environ.get('BAMBI_CLOUD_PORT','8080'),
            '--ctx-size',str(config['context']),'--parallel','1','--n-gpu-layers','99',
            '--flash-attn','on','--cache-type-k',config['cacheK'],'--cache-type-v',config['cacheV'],
            '--batch-size',str(config['batch']),'--ubatch-size',str(config['ubatch']),
            '--cache-ram',str(config['cacheRAM']),'--api-key-file',keyfile]
    for field, flag in [('threads','--threads'),('threadsBatch','--threads-batch')]:
        if config[field]: args += [flag,str(config[field])]
    return args

if __name__ == '__main__':
    config = configured()
    os.environ['GGML_CUDA_GRAPH_OPT'] = str(config['graphOpt'])
    args = command(config,*sys.argv[1:])
    os.execvp(args[0],args)
