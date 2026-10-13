// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Linux native owner uses the same allocation estimator as desktop setup.
import {readFileSync} from 'node:fs';
import {resourcePlan} from '../packages/runtime/resource-plan.ts';
const input=JSON.parse(readFileSync(0,'utf8'));
if(!Number.isFinite(input.ramTotal)||input.ramTotal<=0||!Array.isArray(input.models)||input.models.length>32)throw Error('Invalid resource planning input.');
process.stdout.write(JSON.stringify(input.models.map(model=>({alias:model.alias,...resourcePlan({ramTotal:input.ramTotal},{weightsBytes:model.bytes,contextTokens:model.context,memoryProfile:model.memoryProfile})})))+'\n');
