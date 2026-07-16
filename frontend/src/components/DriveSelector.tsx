import React, { useEffect, useState } from 'react';
import type { DriveInfo } from '../lib/types';
import { fetchDrives } from '../lib/api';

interface Props {
  onSelect: (path: string) => void;
  disabled?: boolean;
}

export default function DriveSelector({ onSelect, disabled }: Props) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDrives()
      .then(setDrives)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400">Loading drives...</div>;

  return (
    <div className="flex items-center space-x-2">
      <select
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
        className="bg-muted border border-border text-foreground text-sm font-mono rounded-lg focus:ring-accent focus:border-accent block w-full p-2.5 disabled:opacity-50 transition-colors"
      >
        <option value="">Select a drive to scan...</option>
        {drives.map((d) => {
          const usedPct = (d.used_space / d.total_space) * 100;
          return (
            <option key={d.mount_point} value={d.mount_point}>
              {d.mount_point} {d.name ? `(${d.name})` : ''} - {Math.round(usedPct)}% used
            </option>
          );
        })}
      </select>
    </div>
  );
}
