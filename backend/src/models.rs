use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::SystemTime;

/// Represents a file or directory node in the scan tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
    pub file_count: u32,
    pub last_modified: Option<u64>, // Unix timestamp seconds
}

impl FileNode {
    /// Create a new file node.
    pub fn new_file(path: PathBuf, name: String, size: u64, last_modified: Option<SystemTime>) -> Self {
        FileNode {
            path,
            name,
            size,
            is_dir: false,
            children: vec![],
            file_count: 1,
            last_modified: last_modified.and_then(|t| {
                t.duration_since(SystemTime::UNIX_EPOCH).ok().map(|d| d.as_secs())
            }),
        }
    }

    /// Create a new directory node.
    pub fn new_dir(
        path: PathBuf,
        name: String,
        size: u64,
        file_count: u32,
        children: Vec<FileNode>,
        last_modified: Option<SystemTime>,
    ) -> Self {
        FileNode {
            path,
            name,
            size,
            is_dir: true,
            children,
            file_count,
            last_modified: last_modified.and_then(|t| {
                t.duration_since(SystemTime::UNIX_EPOCH).ok().map(|d| d.as_secs())
            }),
        }
    }

    /// Sort children by size descending, recursively.
    pub fn sort_by_size(&mut self) {
        self.children.sort_unstable_by(|a, b| b.size.cmp(&a.size));
        for child in &mut self.children {
            if child.is_dir {
                child.sort_by_size();
            }
        }
    }

    /// Filter out nodes smaller than `min_bytes`, recursively.
    /// Always keeps directories even if they are small (to preserve structure),
    /// but prunes file-leaf nodes below threshold.
    pub fn filter_min_size(&mut self, min_bytes: u64) {
        self.children.retain(|c| c.size >= min_bytes);
        for child in &mut self.children {
            if child.is_dir {
                child.filter_min_size(min_bytes);
            }
        }
    }
}

/// Lightweight progress snapshot sent over WebSocket / channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub current_path: String,
    pub files_scanned: u64,
    pub bytes_scanned: u64,
    pub dirs_scanned: u64,
}

/// Summarised drive information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub letter: String,
    pub mount_point: String,
    pub total_space: u64,
    pub free_space: u64,
    pub used_space: u64,
    pub name: String,
}

/// Payload for POST /api/scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRequest {
    pub path: String,
    pub max_depth: Option<usize>,
    pub min_size_mb: Option<u64>,
    pub skip_system: Option<bool>,
}

/// Response for POST /api/scan that includes the scan id for WS subscription.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResponse {
    pub scan_id: String,
}

/// Status of an in-progress or completed scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanStatus {
    pub scan_id: String,
    pub state: ScanState,
    pub progress: Option<ScanProgress>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScanState {
    Running,
    Complete,
    Error,
}

/// WebSocket message variants sent to the client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    Progress {
        current_path: String,
        files_scanned: u64,
        bytes_scanned: u64,
        dirs_scanned: u64,
    },
    Complete {
        tree: FileNode,
    },
    Error {
        message: String,
    },
}
