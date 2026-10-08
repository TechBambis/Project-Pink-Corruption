// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Private JSON pipe for the Python runner. Never persist the environment payload.
import {acceleratorPlan} from '../packages/runtime/accelerator-runtime.mjs';
import {gpuFailureReason,offloadEvidence,deviceKey} from '../packages/runtime/accelerator-policy.mjs';
let input='';
for await(const part of process.stdin){input+=part;if(input.length>1024*1024)throw Error('Runtime policy input exceeded its limit.');}
const request=JSON.parse(input);
if(request.action==='plan')console.log(JSON.stringify(await acceleratorPlan(request.options)));
else if(request.action==='result')console.log(JSON.stringify({reason:gpuFailureReason(request.log,request.failure),evidence:offloadEvidence(request.log),key:request.device?deviceKey(request.device):null}));
else throw Error('Unknown runtime policy operation.');
