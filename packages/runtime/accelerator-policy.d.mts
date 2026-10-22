// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
export type AcceleratorMode='auto'|'cpu';
export type GpuBackend='cuda'|'vulkan'|'metal'|'hip'|'sycl';
export interface AcceleratorDevice {id:string;backend:GpuBackend;name:string;totalMiB:number|null;freeMiB:number|null;backendPath?:string}
export const desktopMemoryReserveMiB:number;
export function inferenceThreads(available:number):number;
export function acceleratorMode(value:string|undefined):AcceleratorMode;
export function deviceBackend(id:string):GpuBackend|null;
export function acceleratorDevices(output:string,backend?:GpuBackend):AcceleratorDevice[];
export function deviceKey(device:AcceleratorDevice):string;
export function cudaVersion(device:AcceleratorDevice|null|undefined):12|13|undefined;
export function acceleratorCandidates(devices:AcceleratorDevice[],platform:NodeJS.Platform,blocked?:string[],limit?:number):AcceleratorDevice[];
export function acceleratorArguments(device:AcceleratorDevice|null,context:number):string[];
export function offloadEvidence(log:string):{offloadedLayers:number;totalLayers:number}|null;
export function gpuFailureReason(log:string,failure:'exit'|'timeout'|'inference'):string|null;
