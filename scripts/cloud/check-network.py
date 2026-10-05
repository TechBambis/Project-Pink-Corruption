# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Check public model endpoint connectivity without downloading weights or displaying secrets."""
import shutil
import subprocess
import sys

if not shutil.which('curl'):
    raise SystemExit('curl is unavailable. Ask the provider to check outbound HTTPS connectivity, or install curl in this workspace.')
for label, url in [('Hugging Face', 'https://huggingface.co'), ('HyperAI-documented HF mirror', 'https://hf-mirror.com')]:
    for family in ['--ipv4', '--ipv6']:
        command = ['curl', family, '--head', '--silent', '--show-error', '--location',
                   '--connect-timeout', '5', '--max-time', '15', '--max-redirs', '5',
                   '--output', '/dev/null', '--write-out', '%{http_code}', url]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        except subprocess.TimeoutExpired:
            print(f'{label} {family}: timed out', flush=True)
            continue
        # Proxy details and redirect URLs can contain credentials; do not print stderr.
        descriptions = {5: 'proxy name lookup failed', 6: 'DNS lookup failed', 7: 'connection failed',
                        28: 'timed out', 35: 'TLS handshake failed', 60: 'TLS certificate check failed'}
        state = 'HTTP ' + result.stdout.strip() if result.returncode == 0 else descriptions.get(result.returncode, f'curl exit {result.returncode}')
        print(f'{label} {family}: {state}', flush=True)
print('An HTTP status establishes endpoint reachability, not successful model/CDN access. No weights downloaded.')
