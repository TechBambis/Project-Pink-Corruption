// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {AcceleratorDevice} from './accelerator-policy.mjs';
export type RuntimeTuning={accelerator:'auto'|'cpu';threads:number;batchSize:128|512|1024;microBatchSize:32|128|256;deviceId?:string;cpuMoeLayers?:0|30};
export function runtimeDeviceId(device:AcceleratorDevice):string;
export function validateRuntimeTuning(value:unknown):RuntimeTuning;
