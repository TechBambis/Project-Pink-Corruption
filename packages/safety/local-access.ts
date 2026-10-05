// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { IncomingHttpHeaders } from 'node:http';

/** The browser app is served by this process. Extensions require a future pairing flow. */
export function localRequestAllowed(headers: IncomingHttpHeaders, port: number, websocket = false): boolean {
 const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
 if (!hosts.includes(headers.host ?? '')) return false;
 if (headers['sec-fetch-site'] === 'cross-site') return false;
 const origin = headers.origin;
 if (origin === undefined) return !websocket;
 return hosts.some(host => origin === `http://${host}`);
}
