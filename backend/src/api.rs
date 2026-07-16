use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::{mpsc, oneshot};
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    error::{ApiResult, ScanError},
    models::{DriveInfo, FileNode, ScanRequest, ScanResponse, ScanState, ScanStatus, WsMessage},
    scanner::{scan_directory, ScanCache},
};

// ──────────────────────────────────────────────────────────────────────────────
//  Shared application state
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    /// Completed scan trees, keyed by scan_id.
    pub cache: Arc<ScanCache>,
    /// In-flight scans: scan_id → shared status + progress channel.
    pub running: Arc<DashMap<String, Arc<RunningState>>>,
}

pub struct RunningState {
    pub status: Mutex<ScanStatus>,
    /// Broadcast channel: sender held by the scanner task, receivers by WS handlers.
    pub progress_tx: tokio::sync::broadcast::Sender<WsMessage>,
    /// Signal the scanner to stop.
    pub cancel_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            cache: Arc::new(DashMap::new()),
            running: Arc::new(DashMap::new()),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Router
// ──────────────────────────────────────────────────────────────────────────────

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/scan", post(start_scan))
        .route("/api/scan/:id/status", get(scan_status))
        .route("/api/scan/progress", get(ws_progress_handler))
        .route("/api/drives", get(list_drives))
        .route("/api/cache", delete(clear_cache))
        .route("/api/open", post(open_in_explorer))
        .route("/api/delete", post(delete_path))
        .with_state(state)
}

// ──────────────────────────────────────────────────────────────────────────────
//  POST /api/scan
// ──────────────────────────────────────────────────────────────────────────────

async fn start_scan(
    State(state): State<AppState>,
    Json(req): Json<ScanRequest>,
) -> ApiResult<Json<ScanResponse>> {
    let root = PathBuf::from(&req.path);

    if !root.exists() {
        return Err(ScanError::PathNotFound(root));
    }

    let scan_id = Uuid::new_v4().to_string();

    let (broadcast_tx, _) = tokio::sync::broadcast::channel::<WsMessage>(256);
    let (cancel_tx, _cancel_rx) = oneshot::channel::<()>();

    let initial_status = ScanStatus {
        scan_id: scan_id.clone(),
        state: ScanState::Running,
        progress: None,
        error: None,
    };

    let running_state = Arc::new(RunningState {
        status: Mutex::new(initial_status),
        progress_tx: broadcast_tx.clone(),
        cancel_tx: Mutex::new(Some(cancel_tx)),
    });

    state
        .running
        .insert(scan_id.clone(), running_state.clone());

    // Spawn a blocking task for the CPU-heavy scan.
    let state_clone = state.clone();
    let sid = scan_id.clone();
    let skip_system = req.skip_system.unwrap_or(false);
    let max_depth = req.max_depth;
    let min_size_mb = req.min_size_mb.unwrap_or(0);

    tokio::spawn(async move {
        // Create mpsc progress channel bridging the sync scanner → async broadcast.
        let (progress_mpsc_tx, mut progress_mpsc_rx) =
            mpsc::unbounded_channel::<crate::models::ScanProgress>();

        let root_clone = root.clone();
        let progress_tx_clone = progress_mpsc_tx.clone();

        // Forward mpsc → broadcast in a separate async task.
        let bcast_tx = broadcast_tx.clone();
        let sid_fwd = sid.clone();
        let _rs_fwd = running_state.clone();
        let state_inner = state_clone.clone();
        tokio::spawn(async move {
            while let Some(prog) = progress_mpsc_rx.recv().await {
                // Update shared status.
                if let Some(rs) = state_inner.running.get(&sid_fwd) {
                    let mut status = rs.status.lock().unwrap();
                    status.progress = Some(prog.clone());
                }
                let msg = WsMessage::Progress {
                    current_path: prog.current_path,
                    files_scanned: prog.files_scanned,
                    bytes_scanned: prog.bytes_scanned,
                    dirs_scanned: prog.dirs_scanned,
                };
                let _ = bcast_tx.send(msg);
            }
        });

        // Run the scan on a blocking thread pool.
        let scan_result = tokio::task::spawn_blocking(move || {
            scan_directory(&root_clone, max_depth, skip_system, Some(progress_tx_clone))
        })
        .await;

        match scan_result {
            Ok(Ok(mut tree)) => {
                tree.sort_by_size();
                if min_size_mb > 0 {
                    tree.filter_min_size(min_size_mb * 1024 * 1024);
                }

                let arc_tree = Arc::new(tree.clone());
                state_clone.cache.insert(sid.clone(), arc_tree);
                state_clone.running.remove(&sid);

                let msg = WsMessage::Complete { tree };
                let _ = broadcast_tx.send(msg);
                info!("Scan {} complete", sid);
            }
            Ok(Err(e)) => {
                error!("Scan {} failed: {}", sid, e);
                if let Some((_, rs)) = state_clone.running.remove(&sid) {
                    let mut status = rs.status.lock().unwrap();
                    status.state = ScanState::Error;
                    status.error = Some(e.to_string());
                }
                let msg = WsMessage::Error {
                    message: e.to_string(),
                };
                let _ = broadcast_tx.send(msg);
            }
            Err(join_err) => {
                error!("Scan task panicked: {}", join_err);
                state_clone.running.remove(&sid);
            }
        }
    });

    Ok(Json(ScanResponse { scan_id }))
}

// ──────────────────────────────────────────────────────────────────────────────
//  GET /api/scan/:id/status
// ──────────────────────────────────────────────────────────────────────────────

async fn scan_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<ScanStatus>> {
    // Check running first.
    if let Some(rs) = state.running.get(&id) {
        let status = rs.status.lock().unwrap().clone();
        return Ok(Json(status));
    }

    // Check completed cache.
    if state.cache.contains_key(&id) {
        return Ok(Json(ScanStatus {
            scan_id: id.clone(),
            state: ScanState::Complete,
            progress: None,
            error: None,
        }));
    }

    Err(ScanError::ScanNotFound(id))
}

// ──────────────────────────────────────────────────────────────────────────────
//  WS /api/scan/progress?id=<scan_id>
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct WsQuery {
    id: String,
}

async fn ws_progress_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<WsQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state, q.id))
}

async fn handle_ws(mut socket: WebSocket, state: AppState, scan_id: String) {
    // If the scan is already complete, send the cached tree immediately.
    if let Some(tree) = state.cache.get(&scan_id) {
        let msg = WsMessage::Complete {
            tree: tree.as_ref().clone(),
        };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = socket.send(Message::Text(json)).await;
        }
        return;
    }

    // Subscribe to the broadcast channel.
    let mut rx = match state.running.get(&scan_id) {
        Some(rs) => rs.progress_tx.subscribe(),
        None => {
            let err = WsMessage::Error {
                message: format!("Scan '{}' not found", scan_id),
            };
            if let Ok(json) = serde_json::to_string(&err) {
                let _ = socket.send(Message::Text(json)).await;
            }
            return;
        }
    };

    loop {
        tokio::select! {
            msg_result = rx.recv() => {
                match msg_result {
                    Ok(msg) => {
                        if let Ok(json) = serde_json::to_string(&msg) {
                            if socket.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                        // Stop after Complete or Error.
                        match msg {
                            WsMessage::Complete { .. } | WsMessage::Error { .. } => break,
                            _ => {}
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        error!("WS receiver lagged by {} messages", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            // Also forward any incoming client messages (e.g., cancel).
            Some(client_msg) = socket.next() => {
                match client_msg {
                    Ok(Message::Text(t)) if t == "cancel" => {
                        if let Some(rs) = state.running.get(&scan_id) {
                            let mut lock = rs.cancel_tx.lock().unwrap();
                            if let Some(tx) = lock.take() {
                                let _ = tx.send(());
                            }
                        }
                        break;
                    }
                    Ok(Message::Close(_)) => break,
                    Err(_) => break,
                    _ => {}
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
//  GET /api/drives
// ──────────────────────────────────────────────────────────────────────────────

async fn list_drives() -> Json<Vec<DriveInfo>> {
    use sysinfo::Disks;

    let disks = Disks::new_with_refreshed_list();
    let drives: Vec<DriveInfo> = disks
        .iter()
        .map(|d| {
            let mount = d.mount_point().to_string_lossy().into_owned();
            let total = d.total_space();
            let free = d.available_space();
            DriveInfo {
                letter: mount.clone(),
                mount_point: mount,
                total_space: total,
                free_space: free,
                used_space: total.saturating_sub(free),
                name: d.name().to_string_lossy().into_owned(),
            }
        })
        .collect();

    Json(drives)
}

// ──────────────────────────────────────────────────────────────────────────────
//  DELETE /api/cache
// ──────────────────────────────────────────────────────────────────────────────

async fn clear_cache(State(state): State<AppState>) -> Json<serde_json::Value> {
    state.cache.clear();
    Json(json!({ "ok": true }))
}

// ──────────────────────────────────────────────────────────────────────────────
//  POST /api/open  — open a path in the OS file explorer
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenRequest {
    path: String,
}

async fn open_in_explorer(Json(req): Json<OpenRequest>) -> impl IntoResponse {
    let path = req.path;

    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .ok();
    }
    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .ok();
    }

    Json(json!({ "ok": true }))
}

// ──────────────────────────────────────────────────────────────────────────────
//  POST /api/delete  — move a path to the Recycle Bin
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct DeleteRequest {
    path: String,
}

async fn delete_path(Json(req): Json<DeleteRequest>) -> impl IntoResponse {
    let path = std::path::PathBuf::from(&req.path);
    
    if !path.exists() {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "Path not found" })));
    }

    match tokio::task::spawn_blocking(move || trash::delete(&path)).await {
        Ok(Ok(_)) => {
            tracing::info!("Moved to recycle bin: {}", req.path);
            (StatusCode::OK, Json(json!({ "ok": true })))
        }
        Ok(Err(e)) => {
            tracing::error!("Failed to delete {}: {}", req.path, e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("Failed to move to recycle bin: {}", e) })))
        }
        Err(e) => {
            tracing::error!("Task panic while deleting {}: {}", req.path, e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Task panicked" })))
        }
    }
}
