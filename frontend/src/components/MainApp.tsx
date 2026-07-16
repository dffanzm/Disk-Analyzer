import React, { useState } from 'react';
import DriveSelector from './DriveSelector';
import ScanProgressTracker from './ScanProgress';
import TreemapVisualizer from './TreemapVisualizer';
import FolderList from './FolderList';
import { startScan } from '../lib/api';
import type { FileNode } from '../lib/types';

export default function MainApp() {
  const [selectedPath, setSelectedPath] = useState('');
  const [scanId, setScanId] = useState<string | null>(null);
  const [result, setResult] = useState<FileNode | null>(null);
  const [viewMode, setViewMode] = useState<'treemap' | 'list'>('treemap');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!selectedPath) return;
    try {
      setError(null);
      setResult(null);
      setIsScanning(true);
      const id = await startScan(selectedPath, undefined, 10); // min 10MB to keep UI fast
      setScanId(id);
    } catch (err: any) {
      setError(err.message);
      setIsScanning(false);
    }
  };

  const handleScanComplete = (data: FileNode) => {
    setResult(data);
    setScanId(null);
    setIsScanning(false);
  };

  const handleCancel = () => {
    setScanId(null);
    setIsScanning(false);
  };

  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <div className="bg-secondary p-4 rounded-lg shadow-md border border-border flex flex-col sm:flex-row items-end gap-4">
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Select Local Drive</label>
          <DriveSelector
            onSelect={setSelectedPath}
            disabled={isScanning}
          />
        </div>
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Or Enter Custom Path</label>
          <input
            type="text"
            placeholder="e.g. C:\Users\Username"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            disabled={isScanning}
            className="bg-muted border border-border text-foreground text-sm font-mono rounded-lg focus:ring-accent focus:border-accent block w-full p-2.5 disabled:opacity-50 transition-colors"
          />
        </div>
        <button
          onClick={handleScan}
          disabled={!selectedPath || isScanning}
          className="w-full sm:w-auto px-6 py-2.5 bg-accent hover:bg-accent/90 disabled:bg-muted disabled:text-slate-500 text-primary font-medium rounded-lg transition-colors shadow-sm"
        >
          {isScanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500 text-red-200 rounded">
          {error}
        </div>
      )}

      {/* Progress Overlay */}
      {isScanning && scanId && (
        <ScanProgressTracker
          scanId={scanId}
          onComplete={handleScanComplete}
          onCancel={handleCancel}
        />
      )}

      {/* Results View */}
      {result && !isScanning && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-foreground flex items-center">
              Scan Results: <span className="text-accent ml-2 font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">{result.path}</span>
            </h2>
            <div className="flex space-x-1 bg-muted p-1 rounded-lg border border-border">
              <button
                onClick={() => setViewMode('treemap')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${viewMode === 'treemap' ? 'bg-accent text-primary shadow-sm' : 'text-slate-400 hover:text-foreground hover:bg-secondary'}`}
              >
                Treemap
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${viewMode === 'list' ? 'bg-accent text-primary shadow-sm' : 'text-slate-400 hover:text-foreground hover:bg-secondary'}`}
              >
                List View
              </button>
            </div>
          </div>

          <div className="w-full overflow-x-auto pb-8">
            {viewMode === 'treemap' ? (
              <TreemapVisualizer data={result} width={1200} height={700} />
            ) : (
              <FolderList data={result} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
