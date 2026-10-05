// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {mkdirSync,copyFileSync} from 'node:fs';
// Pin assets alongside the application: runtime capture never needs a CDN.
const destination='apps/web/public/vad';mkdirSync(destination,{recursive:true});
for(const [source,name] of [
 ['node_modules/@ricky0123/vad-web/dist','silero_vad_v5.onnx'],
 ['node_modules/onnxruntime-web/dist','ort-wasm-simd-threaded.wasm'],
 ['node_modules/onnxruntime-web/dist','ort-wasm-simd-threaded.mjs'],
])copyFileSync(`${source}/${name}`,`${destination}/${name}`);

for(const name of ['SILERO-VAD-LICENSE.txt','ONNX-RUNTIME-LICENSE.txt'])copyFileSync(`docs/licenses/${name}`,`${destination}/${name}`);
