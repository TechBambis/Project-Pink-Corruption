// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {hashFile} from './desktop-windows-support.mjs';

/** Both native builders retain and verify the original CUDA SDK terms. */
export async function verifyCudaNotices(root){
 const directory=join(root,'docs/licenses/nvidia-cuda'),provenance=JSON.parse(readFileSync(join(directory,'PROVENANCE.json'),'utf8'));
 for(const version of ['12.8.1','13.0.2']){
  const file=`CUDA-${version}-LICENSE.txt`,notice=provenance.notices.find(entry=>entry.toolkit===version&&entry.file===file);
  if(!notice||readFileSync(join(directory,file)).length!==notice.bytes||await hashFile(join(directory,file))!==notice.sha256)throw Error('CUDA distribution notice differs: '+file);
 }
 return provenance;
}
