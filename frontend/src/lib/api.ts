import type { DriveInfo, FileNode } from './types';

const API_BASE = 'http://localhost:3000/api';
export const WS_BASE = 'ws://localhost:3000/api/scan/progress';

export async function fetchDrives(): Promise<DriveInfo[]> {
  const res = await fetch(`${API_BASE}/drives`);
  if (!res.ok) throw new Error('Failed to fetch drives');
  return res.json();
}

export async function startScan(path: string, maxDepth?: number, minSizeMb: number = 0): Promise<string> {
  const res = await fetch(`${API_BASE}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      max_depth: maxDepth,
      min_size_mb: minSizeMb,
      skip_system: true
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to start scan');
  }

  const data = await res.json();
  return data.scan_id;
}

export async function openInExplorer(path: string): Promise<void> {
  await fetch(`${API_BASE}/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function deletePath(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to delete path');
  }
}
