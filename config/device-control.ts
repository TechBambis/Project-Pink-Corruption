// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {SessionPhase} from '../packages/session-director/phases';
import type {DeviceCommand} from '../packages/devices/commands';

// Experimental user-requested starting values; hardware channel roles are not assumed.
export const devicePhaseDefaults:Record<SessionPhase,{vibration:number;vibrationPattern:DeviceCommand['pattern'];rotation:number;rotationPattern:DeviceCommand['pattern']}>= {
 induction:{vibration:.15,vibrationPattern:'breathe',rotation:0,rotationPattern:'slow'},
 deepening:{vibration:.25,vibrationPattern:'wave',rotation:.2,rotationPattern:'slow'},
 conditioning:{vibration:.3,vibrationPattern:'constant',rotation:0,rotationPattern:'slow'},
 anchor:{vibration:.25,vibrationPattern:'pulse',rotation:0,rotationPattern:'slow'},
 awakening:{vibration:.15,vibrationPattern:'breathe',rotation:.2,rotationPattern:'slow'},
};
export const deviceTiming={tickMs:10,heartbeatTimeoutMs:2000,bridgeTimeoutMs:2000,randomMinSeconds:30,randomMaxSeconds:90,rotationMinSeconds:5,rotationMaxSeconds:10,randomRotationIntensity:.3,awakeningFadeSeconds:10} as const;
