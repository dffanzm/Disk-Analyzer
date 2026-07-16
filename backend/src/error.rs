use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("Permission denied: {0:?}")]
    PermissionDenied(PathBuf),

    #[error("Path not found: {0:?}")]
    PathNotFound(PathBuf),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Scan not found: {0}")]
    ScanNotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for ScanError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ScanError::PermissionDenied(p) => (
                StatusCode::FORBIDDEN,
                format!("Permission denied: {}", p.display()),
            ),
            ScanError::PathNotFound(p) => (
                StatusCode::NOT_FOUND,
                format!("Path not found: {}", p.display()),
            ),
            ScanError::IoError(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            ScanError::ScanNotFound(id) => {
                (StatusCode::NOT_FOUND, format!("Scan '{}' not found", id))
            }
            ScanError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ScanError>;
