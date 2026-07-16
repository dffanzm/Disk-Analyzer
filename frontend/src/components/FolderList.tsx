import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FileNode } from '../lib/types';
import { formatBytes, openInExplorer, deletePath } from '../lib/api';
import { getInsightForPath } from '../lib/heuristics';

interface Props {
  data: FileNode;
}

export default function FolderList({ data }: Props) {
  const [localData, setLocalData] = useState<FileNode>(data);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([data.path]));
  const [sortCol, setSortCol] = useState<'size' | 'name' | 'files'>('size');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const handleDelete = async () => {
    if (!selectedNode) return;
    const node = selectedNode;
    if (window.confirm(`Move "${node.name}" to Recycle Bin?\n\nThis will safely move the file/folder to the system trash.`)) {
      setIsDeleting(true);
      try {
        await deletePath(node.path);
        
        // Remove locally
        const removeNode = (parent: FileNode): boolean => {
          if (!parent.children) return false;
          const idx = parent.children.findIndex(c => c.path === node.path);
          if (idx !== -1) {
            parent.children.splice(idx, 1);
            return true;
          }
          for (const child of parent.children) {
            if (child.is_dir && removeNode(child)) {
              return true;
            }
          }
          return false;
        };

        const newData = JSON.parse(JSON.stringify(localData));
        if (newData.path === node.path) {
          alert("Cannot delete the root directory.");
        } else {
          removeNode(newData);
          setLocalData(newData);
        }
      } catch (e: any) {
        alert(e.message);
      }
      setIsDeleting(false);
      setSelectedNode(null);
    }
  };

  const toggleExpand = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setExpanded(next);
  };

  const handleSort = (col: 'size' | 'name' | 'files') => {
    if (sortCol === col) {
      setSortDesc(!sortDesc);
    } else {
      setSortCol(col);
      setSortDesc(true);
    }
  };

  const renderNode = (node: FileNode, depth: number, parentSize: number) => {
    const isExpanded = expanded.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    const pct = parentSize > 0 ? (node.size / parentSize) * 100 : 100;

    // Sort children
    const children = hasChildren ? [...node.children].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'size') cmp = a.size - b.size;
      else if (sortCol === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortCol === 'files') cmp = a.file_count - b.file_count;
      return sortDesc ? -cmp : cmp;
    }) : [];

    return (
      <React.Fragment key={node.path}>
        <tr className="group hover:bg-muted/80 border-b border-border/50 text-sm transition-colors duration-150">
          <td className="py-2 pl-4 pr-2">
            <div className="flex items-center" style={{ paddingLeft: `${depth * 1.5}rem` }}>
              {node.is_dir ? (
                <button
                  onClick={() => toggleExpand(node.path)}
                  className="w-5 h-5 flex items-center justify-center mr-1 text-slate-400 hover:text-white"
                >
                  {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
                </button>
              ) : (
                <span className="w-5 h-5 mr-1 flex items-center justify-center text-slate-500">📄</span>
              )}
              <span className="truncate max-w-sm mr-2" title={node.name}>{node.name}</span>
              <div className="opacity-0 group-hover:opacity-100 flex items-center ml-auto mr-2 transition-opacity space-x-2">
                <button
                  onClick={() => openInExplorer(node.path)}
                  className="text-accent hover:text-accent/80"
                  title="Open in Explorer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </button>
                <button
                  onClick={() => setSelectedNode(node)}
                  className="text-slate-400 hover:text-red-400"
                  title="Info & Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          </td>
          <td className="py-2 px-2 text-right">
            <div className="flex items-center justify-end space-x-2">
              <span className="font-mono text-xs text-foreground/90">{formatBytes(node.size)}</span>
              <div className="w-16 h-1.5 bg-muted rounded overflow-hidden border border-border/30">
                <div className="h-full bg-accent" style={{ width: `${pct}%` }}></div>
              </div>
            </div>
          </td>
          <td className="py-2 px-2 text-right text-slate-400 font-mono text-xs">
            {node.is_dir ? node.file_count.toLocaleString() : '-'}
          </td>
          <td className="py-2 pl-2 pr-4 text-right text-slate-400 font-mono text-xs">
            {node.last_modified ? new Date(node.last_modified * 1000).toLocaleDateString() : '-'}
          </td>
        </tr>
        {isExpanded && children.map(child => renderNode(child, depth + 1, node.size))}
      </React.Fragment>
    );
  };

  return (
    <div className="bg-secondary border border-border rounded-lg overflow-hidden shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted text-slate-300 text-xs uppercase tracking-wider font-mono">
              <th className="py-3 pl-4 pr-2 font-medium cursor-pointer hover:text-foreground transition-colors" onClick={() => handleSort('name')}>
                Name {sortCol === 'name' && (sortDesc ? '↓' : '↑')}
              </th>
              <th className="py-3 px-2 font-medium text-right cursor-pointer hover:text-foreground transition-colors w-48" onClick={() => handleSort('size')}>
                Size {sortCol === 'size' && (sortDesc ? '↓' : '↑')}
              </th>
              <th className="py-3 px-2 font-medium text-right cursor-pointer hover:text-foreground transition-colors w-24" onClick={() => handleSort('files')}>
                Files {sortCol === 'files' && (sortDesc ? '↓' : '↑')}
              </th>
              <th className="py-3 pl-2 pr-4 font-medium text-right w-32">
                Modified
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {renderNode(localData, 0, localData.size)}
          </tbody>
        </table>
      </div>

      {/* Centered Modal for Info & Delete */}
      <AnimatePresence>
        {selectedNode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden w-full max-w-md flex flex-col"
            >
              <div className="px-5 py-4 bg-muted border-b border-border flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-foreground text-base truncate pr-4" title={selectedNode.name}>
                    {selectedNode.name}
                  </h3>
                  <p className="text-sm text-slate-400 mt-1">
                    {selectedNode.is_dir ? 'Folder' : 'File'} • {formatBytes(selectedNode.size)}
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedNode(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="px-5 py-5 bg-secondary">
                {(() => {
                  const insight = getInsightForPath(selectedNode.name, selectedNode.is_dir);
                  let badgeColor = 'bg-slate-600 text-white';
                  if (insight.risk === 'SAFE') badgeColor = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                  if (insight.risk === 'MEDIUM') badgeColor = 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
                  if (insight.risk === 'DANGER') badgeColor = 'bg-red-500/10 text-red-400 border border-red-500/20';

                  return (
                    <div className="space-y-3 text-sm">
                      <p className="text-slate-300 leading-relaxed text-base">{insight.description}</p>
                      <div className={`mt-4 p-4 rounded-lg ${badgeColor}`}>
                        <span className="font-bold block mb-2 flex items-center text-base">
                          {insight.risk === 'SAFE' ? (
                            <><svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg> Aman Dihapus</>
                          ) : insight.risk === 'MEDIUM' ? (
                            <><svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg> Perlu Diperiksa</>
                          ) : insight.risk === 'DANGER' ? (
                            <><svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Risiko Tinggi</>
                          ) : 'ℹ️ Tidak Ada Data'}
                        </span>
                        <span className="opacity-90 block mt-1">{insight.recommendation}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-3 bg-muted/30">
                <button
                  onClick={() => setSelectedNode(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors flex items-center disabled:opacity-50"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  {isDeleting ? 'Menghapus...' : 'Kirim ke Recycle Bin'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
