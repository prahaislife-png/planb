import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Evidence document storage for the dashboard — the same content-addressed layout the research worker
 * uses (documents/<sha[0:2]>/<sha>.pdf), so a document uploaded here is readable by the worker.
 * Files are private: they are only ever served through /documents/[id]/file after a staff check.
 */

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function contentPath(digest: string): string {
  return `documents/${digest.slice(0, 2)}/${digest}.pdf`;
}

/** Decide the type from the bytes, never from the file name or the browser-supplied MIME type. */
export function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString('latin1') === '%PDF-';
}

function localRoot(): string {
  return path.resolve(process.cwd(), process.env.PLANB_EVIDENCE_DIR ?? '../var/evidence');
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return process.env.PLANB_EVIDENCE_BACKEND === 'supabase' && url && key ? { url, key } : null;
}

export async function putEvidence(storagePath: string, data: Buffer): Promise<void> {
  const remote = supabaseConfig();
  if (remote) {
    // STATUS: Supabase Storage path is written to the documented REST contract but not yet exercised live.
    const res = await fetch(`${remote.url}/storage/v1/object/evidence/${storagePath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${remote.key}`, apikey: remote.key, 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: new Uint8Array(data),
    });
    if (!res.ok && res.status !== 409) throw new Error(`evidence upload failed (${res.status})`);
    return;
  }
  const full = path.join(localRoot(), storagePath);
  if (!full.startsWith(localRoot() + path.sep)) throw new Error('invalid storage path');
  await mkdir(path.dirname(full), { recursive: true });
  try {
    await stat(full);
    return; // content-addressed: already stored
  } catch {
    await writeFile(`${full}.part`, data);
    await rename(`${full}.part`, full);
  }
}

export async function getEvidence(storagePath: string): Promise<Buffer> {
  const remote = supabaseConfig();
  if (remote) {
    const res = await fetch(`${remote.url}/storage/v1/object/evidence/${storagePath}`, {
      headers: { Authorization: `Bearer ${remote.key}`, apikey: remote.key },
    });
    if (!res.ok) throw new Error(`evidence download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  const full = path.join(localRoot(), storagePath);
  if (!full.startsWith(localRoot() + path.sep)) throw new Error('invalid storage path');
  return readFile(full);
}
