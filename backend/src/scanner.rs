use crate::models::{FileNode, ScanProgress};
use dashmap::DashMap;
use rayon::prelude::*;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Folders skipped when `skip_system` is true.
const SYSTEM_SKIP_NAMES: &[&str] = &[
    "System Volume Information",
    "$Recycle.Bin",
    "$RECYCLE.BIN",
    "Windows",
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
];

/// Global counters shared between rayon threads.
struct Counters {
    files: AtomicU64,
    bytes: AtomicU64,
    dirs: AtomicU64,
}

impl Counters {
    fn new() -> Self {
        Counters {
            files: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            dirs: AtomicU64::new(0),
        }
    }
}

/// Scan context passed recursively.
struct ScanCtx {
    max_depth: Option<usize>,
    skip_system: bool,
    counters: Arc<Counters>,
    /// Channel to forward periodic progress updates (best-effort, non-blocking).
    progress_tx: Option<mpsc::UnboundedSender<ScanProgress>>,
    /// Visited canonical paths for symlink-loop detection.
    visited: Arc<Mutex<HashSet<PathBuf>>>,
}

/// Scan a directory tree rooted at `root_path`.
///
/// # Arguments
/// * `root_path`     – directory to scan
/// * `max_depth`     – maximum recursion depth (None = unlimited)
/// * `skip_system`   – skip OS-protected folders
/// * `progress_tx`   – optional channel for streaming progress events
pub fn scan_directory(
    root_path: &Path,
    max_depth: Option<usize>,
    skip_system: bool,
    progress_tx: Option<mpsc::UnboundedSender<ScanProgress>>,
) -> std::io::Result<FileNode> {
    let ctx = Arc::new(ScanCtx {
        max_depth,
        skip_system,
        counters: Arc::new(Counters::new()),
        progress_tx,
        visited: Arc::new(Mutex::new(HashSet::new())),
    });

    // Mark root as visited.
    if let Ok(canonical) = root_path.canonicalize() {
        let mut visited = ctx.visited.lock().unwrap();
        visited.insert(canonical);
    }

    let root_name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root_path.to_string_lossy().into_owned());

    let node = scan_dir_recursive(root_path, &root_name, 0, &ctx)?;
    Ok(node)
}

/// Recursive inner function.
/// Returns `None` when the entry should be silently skipped.
fn scan_dir_recursive(
    path: &Path,
    name: &str,
    depth: usize,
    ctx: &Arc<ScanCtx>,
) -> std::io::Result<FileNode> {
    ctx.counters.dirs.fetch_add(1, Ordering::Relaxed);

    // Depth limit check (don't recurse but still create node).
    let at_depth_limit = ctx.max_depth.map_or(false, |max| depth >= max);

    // Read directory entries.
    let read_result = std::fs::read_dir(path);
    let entries = match read_result {
        Ok(rd) => rd
            .filter_map(|e| {
                match e {
                    Ok(entry) => Some(entry),
                    Err(err) => {
                        warn!("Could not read entry in {:?}: {}", path, err);
                        None
                    }
                }
            })
            .collect::<Vec<_>>(),
        Err(err) => {
            warn!("Cannot read dir {:?}: {}", path, err);
            // Return an empty dir node rather than failing.
            return Ok(FileNode::new_dir(
                path.to_path_buf(),
                name.to_string(),
                0,
                0,
                vec![],
                path.metadata().ok().and_then(|m| m.modified().ok()),
            ));
        }
    };

    // Partition entries into (subdirs, files) so we can parallelize subdirs.
    let mut subdirs: Vec<(PathBuf, String)> = vec![];
    let mut file_nodes: Vec<FileNode> = vec![];
    let mut total_size: u64 = 0;
    let mut total_files: u32 = 0;

    for entry in &entries {
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().into_owned();

        // Skip system paths if requested.
        if ctx.skip_system && SYSTEM_SKIP_NAMES.contains(&entry_name.as_str()) {
            debug!("Skipping system path: {:?}", entry_path);
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(err) => {
                warn!("Cannot read metadata for {:?}: {}", entry_path, err);
                continue;
            }
        };

        if metadata.is_symlink() || (metadata.file_type().is_symlink()) {
            // Skip symlinks to avoid loops.
            debug!("Skipping symlink: {:?}", entry_path);
            continue;
        }

        if metadata.is_file() {
            let size = metadata.len();
            let modified = metadata.modified().ok();

            ctx.counters.files.fetch_add(1, Ordering::Relaxed);
            ctx.counters.bytes.fetch_add(size, Ordering::Relaxed);
            total_size += size;
            total_files += 1;

            file_nodes.push(FileNode::new_file(entry_path.clone(), entry_name, size, modified));

            // Emit progress every ~2000 files.
            let fc = ctx.counters.files.load(Ordering::Relaxed);
            if fc % 2000 == 0 {
                emit_progress(ctx, &entry_path.to_string_lossy());
            }
        } else if metadata.is_dir() {
            // Symlink-loop check via canonicalize.
            match entry_path.canonicalize() {
                Ok(canonical) => {
                    let mut visited = ctx.visited.lock().unwrap();
                    if visited.contains(&canonical) {
                        debug!("Symlink loop detected, skipping {:?}", entry_path);
                        continue;
                    }
                    visited.insert(canonical);
                }
                Err(_) => {
                    // If we can't canonicalize just proceed cautiously.
                }
            }
            subdirs.push((entry_path, entry_name));
        }
    }

    // Recurse into subdirectories — use rayon for top-level parallelism.
    let subdir_nodes: Vec<FileNode> = if !at_depth_limit && depth == 0 && subdirs.len() > 1 {
        // Parallel at depth-0 only (top-level) to avoid thread-pool saturation.
        subdirs
            .par_iter()
            .filter_map(|(subpath, subname)| {
                scan_dir_recursive(subpath, subname, depth + 1, ctx).ok()
            })
            .collect()
    } else if !at_depth_limit {
        subdirs
            .iter()
            .filter_map(|(subpath, subname)| {
                scan_dir_recursive(subpath, subname, depth + 1, ctx).ok()
            })
            .collect()
    } else {
        vec![]
    };

    // Aggregate size & file count from subdir results.
    for sub in &subdir_nodes {
        total_size += sub.size;
        total_files += sub.file_count;
    }

    // Combine children.
    let mut children: Vec<FileNode> = file_nodes;
    children.extend(subdir_nodes);

    let last_modified = path.metadata().ok().and_then(|m| m.modified().ok());

    Ok(FileNode::new_dir(
        path.to_path_buf(),
        name.to_string(),
        total_size,
        total_files,
        children,
        last_modified,
    ))
}

fn emit_progress(ctx: &Arc<ScanCtx>, current_path: &str) {
    if let Some(tx) = &ctx.progress_tx {
        let progress = ScanProgress {
            current_path: current_path.to_string(),
            files_scanned: ctx.counters.files.load(Ordering::Relaxed),
            bytes_scanned: ctx.counters.bytes.load(Ordering::Relaxed),
            dirs_scanned: ctx.counters.dirs.load(Ordering::Relaxed),
        };
        // Non-blocking send; drop if receiver is gone.
        let _ = tx.send(progress);
    }
}

/// In-memory cache for completed scans.
/// Key: scan_id (UUID string), Value: finished FileNode.
pub type ScanCache = DashMap<String, Arc<FileNode>>;
