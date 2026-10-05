// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Explicitly editable preferences, separate from the conversation transcript. */
export function initMemoryPanel(notice: (text: string) => void) {
  const dialog = document.getElementById('memory-dialog') as HTMLDialogElement;
  const content = document.getElementById('memory-content')!;
  const form = document.getElementById('memory-form') as HTMLFormElement;
  const key = document.getElementById('memory-key') as HTMLInputElement;
  const value = document.getElementById('memory-value') as HTMLInputElement;
  async function refresh() {
    const response = await fetch('/api/memory');
    if (!response.ok) throw Error('Memories are unavailable.');
    const data = await response.json(); content.replaceChildren();
    for (const fact of data.facts ?? []) {
      const row = document.createElement('p');
      const text = document.createElement('span'); text.textContent = `${fact.key}: ${fact.value} `;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
      edit.onclick = () => { key.value = fact.key; value.value = fact.value; value.focus(); };
      const forget = document.createElement('button'); forget.type = 'button'; forget.textContent = 'Remove preference';
      forget.onclick = () => { void fetch('/api/memory/facts/' + fact.id, { method: 'DELETE' }).then(r => { if(!r.ok)throw Error('Could not remove preference.');return refresh(); }).catch(e => notice(String(e))); };
      row.append(text, edit, forget); content.append(row);
    }
    const transcript = document.createElement('pre');
    transcript.style.whiteSpace = 'pre-wrap';
    transcript.textContent = data.turns.map((turn: { role: string; content: string }) => `${turn.role === 'user' ? 'You' : 'Bambi'}: ${turn.content}`).join('\n\n') || 'No recent chat memories.';
    content.append(transcript);
  }
  document.getElementById('memory')!.onclick = () => { void refresh().then(() => dialog.showModal()).catch(e => notice(String(e))); };
  document.getElementById('close-memory')!.onclick = () => dialog.close();
  document.getElementById('forget')!.onclick = () => { void fetch('/api/memory', { method: 'DELETE' }).then(r => { if(!r.ok)throw Error('Could not clear memories.');document.getElementById('messages')?.replaceChildren();return refresh(); }).catch(e => notice(String(e))); };
  form.onsubmit = event => {
    event.preventDefault();
    void fetch('/api/memory/facts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key.value, value: value.value }) })
      .then(response => { if (!response.ok) throw Error('Could not save preference.'); form.reset(); return refresh(); }).catch(error => notice(String(error)));
  };
}
