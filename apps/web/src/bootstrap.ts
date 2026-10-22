// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

// Keep the migration explicitly selectable while the existing UI remains available.
const react = new URLSearchParams(location.search).get('ui') === 'react';
void (react ? import('./react-player').then(module => module.ready) : import('./main')).catch(error => {
 console.error('Player startup failed', error);
 const notice = document.getElementById('notice');
 if (notice) {
  notice.textContent = 'The player could not start. Reload the page to try again.';
  notice.classList.remove('hidden');
 }
});

