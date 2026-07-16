mod api;
mod error;
mod models;
mod scanner;

use api::{build_router, AppState};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    // Initialise tracing.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // CORS — allow the Astro dev server (and same-origin prod builds).
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState::new();
    let app = build_router(state).layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    info!("Disk Analyzer API listening on http://0.0.0.0:3000");
    axum::serve(listener, app)
        .await
        .expect("Server error");
}
