// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Original room-agent timing, measured on the session clock so pause freezes it. */
export class AmbientAgent {
  private activity = 0;
  private sent = -Infinity;
  private check = 60;
  private trigger = '';
  reset(time = 0) { this.activity = time; this.sent = -Infinity; this.check = time + 60; this.trigger = ''; }
  message(time: number, trigger = '') { this.activity = time; this.trigger = trigger; }
  next(time: number, ready: boolean): { reason: 'idle' | 'trigger'; trigger: string } | null {
    if (!ready || time - this.sent < 180) return null;
    if (this.trigger) {
      const trigger = this.trigger; this.trigger = ''; this.sent = time;
      return { reason: 'trigger', trigger };
    }
    if (time < this.check) return null;
    this.check = time + 60;
    if (time - this.activity < 300) return null;
    this.sent = time;
    return { reason: 'idle', trigger: '' };
  }
}
