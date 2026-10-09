// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Discards playback and its acoustic tail before they can enter the pre-roll. */
export class PlaybackInputGuard {
 private until=0;
 blocked(output:boolean,now:number,protectedMode=true){
  if(!protectedMode){this.until=0;return false;}
  if(output)this.until=now+400;
  return output||now<this.until;
 }
 reset(){this.until=0;}
}
