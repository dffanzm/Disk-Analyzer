import React, { useEffect, useState } from 'react';
import type { ScanProgress, FileNode } from '../lib/types';
import { WS_BASE } from '../lib/api';
import TreemapVisualizer from './TreemapVisualizer';

interface Props {
  scanId: string;
  onComplete: (data: FileNode) => void;
  onCancel: () => void;
}

export default function ScanProgressTracker({ scanId, onComplete, onCancel }: Props) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    if (!scanId) return;

    const socket = new WebSocket(`${WS_BASE}?id=${scanId}`);

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'progress') {
          setProgress(msg);
        } else if (msg.type === 'complete') {
          onComplete(msg.tree);
          socket.close();
        } else if (msg.type === 'error') {
          setError(msg.message);
          socket.close();
        }
      } catch (err) {
        console.error("Failed to parse WS msg", err);
      }
    };

    socket.onerror = () => {
      setError("WebSocket connection failed.");
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [scanId, onComplete]);

  const handleCancel = () => {
    if (ws) {
      ws.send("cancel");
    }
    onCancel();
  };

  if (error) {
    return (
      <div className="p-4 bg-red-900/50 border border-red-500 rounded text-red-200">
        <h3 className="font-bold">Scan Error</h3>
        <p>{error}</p>
        <button onClick={onCancel} className="mt-2 bg-red-800 hover:bg-red-700 px-4 py-2 rounded text-sm">Dismiss</button>
      </div>
    );
  }

  return (
    <div className="p-6 bg-secondary border border-border rounded-lg shadow-xl w-full max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-foreground flex items-center">
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Scanning Drive...
        </h2>
        <button onClick={handleCancel} className="text-sm bg-muted hover:bg-muted/80 border border-border px-3 py-1 rounded text-slate-300 transition-colors">
          Cancel
        </button>
      </div>

      {progress ? (
        <div className="space-y-4">
          <div className="bg-muted border border-border/50 rounded p-3 font-mono text-xs text-slate-400 break-all h-16 overflow-hidden flex items-end shadow-inner">
            {progress.current_path}
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-muted border border-border/50 rounded p-2">
              <div className="text-2xl font-bold text-accent font-mono">
                {(progress.bytes_scanned / 1024 / 1024 / 1024).toFixed(2)} GB
              </div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Scanned</div>
            </div>
            <div className="bg-muted border border-border/50 rounded p-2">
              <div className="text-2xl font-bold text-emerald-400 font-mono">
                {progress.files_scanned.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Files</div>
            </div>
            <div className="bg-muted border border-border/50 rounded p-2">
              <div className="text-2xl font-bold text-amber-400 font-mono">
                {progress.dirs_scanned.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Folders</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-slate-400 text-center py-4">Initializing scan...</div>
      )}
    </div>
  );
}
