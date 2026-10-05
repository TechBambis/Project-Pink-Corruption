// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Apply pressure only to presentation. Never change an active model or its context. */
export class PresentationGovernor {
 private pressureUntil=0;private slowFrames=0;
 observe(frameMs:number,now:number,voiceActive:boolean){this.slowFrames=voiceActive&&frameMs>80?this.slowFrames+1:Math.max(0,this.slowFrames-1);if(this.slowFrames>=3){this.pressureUntil=now+5000;this.slowFrames=0;}return now<this.pressureUntil;}
}
