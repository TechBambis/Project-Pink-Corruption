// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const workspaceViews = ['session', 'files', 'voice', 'visuals', 'sound', 'devices', 'extras'] as const;
export type WorkspaceView = typeof workspaceViews[number];
export type NavigationIntent = 'tab' | 'jump' | 'history';
export interface NavigationLocation { target: string; intent: NavigationIntent; }
export interface NavigationDriver {
 current(): NavigationLocation;
 navigate(view: WorkspaceView, target: string, intent: NavigationIntent): void;
 subscribe(listener: (location: NavigationLocation) => void): () => void;
}

let driver: NavigationDriver | undefined;
export function installNavigationDriver(next: NavigationDriver) {
 if (driver) throw Error('Workspace navigation already has an owner.');
 driver = next;
}
export const navigationDriver = () => driver;
export const isWorkspaceView = (value: string): value is WorkspaceView => workspaceViews.some(view => view === value);

