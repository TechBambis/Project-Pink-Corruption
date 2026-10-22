// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Deliberately small tuning space; never accept command lines or loader paths.
import {createHash} from 'node:crypto';
import {deviceKey} from './accelerator-policy.mjs';
export const runtimeDeviceId=device=>createHash('sha256').update(deviceKey(device)).digest('hex');
export function validateRuntimeTuning(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accelerator','batchSize','microBatchSize','threads','deviceId','cpuMoeLayers'].includes(key)))throw Error('Invalid measured runtime settings.');
 const {accelerator,threads,batchSize,microBatchSize,deviceId,cpuMoeLayers}=value;
 if(!['auto','cpu'].includes(accelerator)||!Number.isSafeInteger(threads)||threads<1||threads>32||![128,512,1024].includes(batchSize)||![32,128,256].includes(microBatchSize)||microBatchSize>batchSize||deviceId!==undefined&&(accelerator!=='auto'||typeof deviceId!=='string'||!/^[a-f0-9]{64}$/.test(deviceId))||cpuMoeLayers!==undefined&&![0,30].includes(cpuMoeLayers))throw Error('Invalid measured runtime settings.');
 return {accelerator,threads,batchSize,microBatchSize,...(deviceId!==undefined?{deviceId}:{}),...(cpuMoeLayers!==undefined?{cpuMoeLayers}:{})};
}
