import React, { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'framer-motion';
import type { FileNode } from '../lib/types';
import { formatBytes, openInExplorer, deletePath } from '../lib/api';
import { getInsightForPath } from '../lib/heuristics';

interface Props {
  data: FileNode;
  width?: number;
  height?: number;
}

export default function TreemapVisualizer({ data, width = 1000, height = 600 }: Props) {
  const [currentNode, setCurrentNode] = useState<FileNode>(data);
  const [history, setHistory] = useState<FileNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);



  const handleDelete = async () => {
    if (!selectedNode) return;
    const node = selectedNode;
    if (window.confirm(`Move "${node.name}" to Recycle Bin?\n\nThis will safely move the file/folder to the system trash.`)) {
      setIsDeleting(true);
      try {
        await deletePath(node.path);
        
        // Remove locally to avoid full re-scan
        const removeNode = (parent: FileNode): boolean => {
          if (!parent.children) return false;
          const idx = parent.children.findIndex(c => c.path === node.path);
          if (idx !== -1) {
            const removed = parent.children.splice(idx, 1)[0];
            // Optionally subtract size from parents here, but keeping it simple triggers D3 recalculation.
            return true;
          }
          for (const child of parent.children) {
            if (child.is_dir && removeNode(child)) {
              return true;
            }
          }
          return false;
        };

        const newData = JSON.parse(JSON.stringify(currentNode));
        if (newData.path === node.path) {
          // Can't delete root of current view easily without going up
          alert("Cannot delete the currently opened root directory. Go up one level first.");
        } else {
          removeNode(newData);
          setCurrentNode(newData);
        }
      } catch (e: any) {
        alert(e.message);
      }
      setIsDeleting(false);
      setSelectedNode(null);
    }
  };

  // Calculate layout
  const root = useMemo(() => {
    // Need a copy because d3 hierarchy mutates
    const hierarchy = d3.hierarchy<FileNode>(currentNode)
      .sum(d => (d.children && d.children.length > 0) ? 0 : d.size)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const treemap = d3.treemap<FileNode>()
      .size([width, height])
      .paddingTop(24) // Space for folder label
      .paddingRight(2)
      .paddingBottom(2)
      .paddingLeft(2)
      .round(true);

    return treemap(hierarchy);
  }, [currentNode, width, height]);

  // Color scale for top-level folders to make them distinct and bold
  const color = d3.scaleOrdinal(d3.schemeCategory10);

  const handleDrillDown = (node: d3.HierarchyRectangularNode<FileNode>) => {
    if (node.data.is_dir && node.data.children?.length > 0) {
      setHistory([...history, currentNode]);
      setCurrentNode(node.data);
    }
  };

  const handleDrillUp = () => {
    if (history.length > 0) {
      const newHistory = [...history];
      const parent = newHistory.pop()!;
      setHistory(newHistory);
      setCurrentNode(parent);
    }
  };

  return (
    <div className="relative border border-border bg-secondary rounded-lg shadow-xl overflow-hidden" style={{ width, height }}>
      {/* Breadcrumb / Navbar */}
      <div className="absolute top-0 left-0 w-full bg-muted text-foreground text-sm p-2 flex items-center justify-between z-10 shadow-sm border-b border-border/50">
        <div className="flex items-center space-x-2 truncate">
          <button
            onClick={handleDrillUp}
            disabled={history.length === 0}
            className="p-1 hover:bg-secondary rounded disabled:opacity-50 flex-shrink-0 transition-colors"
            title="Go up"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </button>
          <span className="truncate font-mono" title={currentNode.path}>
            {currentNode.path} <span className="text-slate-400">({formatBytes(currentNode.size)})</span>
          </span>
        </div>
        <button
          onClick={() => openInExplorer(currentNode.path)}
          className="text-xs bg-secondary hover:bg-secondary/80 border border-border px-2 py-1 rounded transition-colors"
        >
          Open Explorer
        </button>
      </div>

      {/* SVG Canvas for Treemap */}
      <div className="absolute top-10 left-0 right-0 bottom-0">
        <AnimatePresence mode="wait">
          <motion.svg
            key={currentNode.path} // Force re-render/animation on drill
            width={width}
            height={height - 40}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.3 }}
            className="font-sans text-xs"
          >
            {root.descendants().map((node) => {
              // Exclude the root node itself to avoid drawing a giant box over the canvas background if we don't want to, 
              // but actually drawing the root is fine.
              let topParent = node;
              while (topParent.depth > 1 && topParent.parent) {
                topParent = topParent.parent;
              }
              const baseColor = topParent.data.name ? color(topParent.data.name) : '#1E293B';
              
              // Slightly darken based on depth to show hierarchy, but keep it bold
              const bg = node.data.is_dir 
                ? d3.color(baseColor)?.darker((node.depth - 1) * 0.15)?.formatHex() || baseColor
                : d3.color(baseColor)?.darker((node.depth - 1) * 0.15 + 0.4)?.formatHex() || baseColor;
                
              const isLeaf = !node.children || node.children.length === 0;

              return (
                <g
                  key={node.data.path}
                  transform={`translate(${node.x0},${node.y0})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDrillDown(node);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedNode(node.data);
                  }}
                  className={node.data.is_dir ? "cursor-pointer" : ""}
                >
                  <rect
                    width={Math.max(0, node.x1 - node.x0)}
                    height={Math.max(0, node.y1 - node.y0)}
                    fill={bg}
                    stroke="rgba(0,0,0,0.3)"
                    strokeWidth="1.5"
                    className="hover:brightness-125 transition-all"
                  >
                    <title>
                      {node.data.name}&#10;
                      Size: {formatBytes(node.data.size)}&#10;
                      {node.data.is_dir ? `Files: ${node.data.file_count}` : 'File'}
                    </title>
                  </rect>

                  {/* Label for directories (rendered in the 24px padding area) */}
                  {(node.data.is_dir && node.depth > 0 && node.x1 - node.x0 > 40 && node.y1 - node.y0 > 18) && (
                    <foreignObject
                      x={0}
                      y={0}
                      width={Math.max(0, node.x1 - node.x0)}
                      height={Math.min(24, Math.max(0, node.y1 - node.y0))}
                      className="pointer-events-none"
                    >
                      <div className="px-1.5 py-0.5 w-full h-full overflow-hidden flex items-center">
                        <span className="truncate text-white font-bold drop-shadow-md text-[11px] tracking-wide">
                          {node.data.name}
                        </span>
                      </div>
                    </foreignObject>
                  )}

                  {/* Label for files (leaves) */}
                  {(isLeaf && !node.data.is_dir && node.x1 - node.x0 > 40 && node.y1 - node.y0 > 25) && (
                    <foreignObject
                      x={0}
                      y={0}
                      width={Math.max(0, node.x1 - node.x0)}
                      height={Math.max(0, node.y1 - node.y0)}
                      className="pointer-events-none"
                    >
                      <div className="p-1.5 w-full h-full overflow-hidden flex flex-col justify-start">
                        <span className="truncate text-white font-bold drop-shadow-md text-[11px] leading-tight mb-0.5">
                          {node.data.name}
                        </span>
                        {(node.x1 - node.x0 > 50 && node.y1 - node.y0 > 40) && (
                          <span className="text-[10px] text-gray-200 drop-shadow-md font-semibold truncate">
                            {formatBytes(node.data.size)}
                          </span>
                        )}
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </motion.svg>
        </AnimatePresence>
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
