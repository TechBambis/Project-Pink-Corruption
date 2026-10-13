// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {AcceleratorDevice,AcceleratorMode} from './accelerator-policy.mjs';
export interface AcceleratorAttempt {device:AcceleratorDevice|null;args:string[];environment:NodeJS.ProcessEnv}
export interface AcceleratorPlan {requested:AcceleratorMode;devices:AcceleratorDevice[];attempts:AcceleratorAttempt[];probeFailures:string[];fallbackReason?:string}
export function backendLibraries(library:string,platform:NodeJS.Platform):string[];
export function backendRuntimeFiles(library:string,platform:NodeJS.Platform):string[];
export function acceleratorEnvironment(source:NodeJS.ProcessEnv,options:{library:string;platform:NodeJS.Platform;backendPath?:string}):NodeJS.ProcessEnv;
export function acceleratorPlan(options:{command:{executable:string;prefix?:string[]};library:string;platform:NodeJS.Platform;environment:NodeJS.ProcessEnv;mode?:string;context:number;blocked?:string[];devices?:AcceleratorDevice[];cpuThreads?:number;probeTimeoutMs?:number;signal?:AbortSignal;deviceId?:string}):Promise<AcceleratorPlan>;
