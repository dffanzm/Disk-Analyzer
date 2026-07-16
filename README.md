<div align="center">

# 💾 Disk Analyzer

**Fast, visual disk space analyzer — Rust backend + Astro/React frontend.**

Scan drives, visualize usage with interactive treemap, clean up large files.

![Rust](https://img.shields.io/badge/Backend-Rust-orange?logo=rust&logoColor=white)
![Astro](https://img.shields.io/badge/Frontend-Astro-blueviolet?logo=astro&logoColor=white)
![React](https://img.shields.io/badge/UI-React-61DAFB?logo=react&logoColor=black)
![TailwindCSS](https://img.shields.io/badge/Styling-TailwindCSS-38B2AC?logo=tailwind-css&logoColor=white)

</div>

---

## Features

- 🚀 Multi-threaded scanning (Rust + Rayon)
- 🗺️ Interactive D3.js treemap with drill-down
- 📋 Sortable list view with size bars
- 🧠 Smart delete recommendations (safe / risky / danger)
- 🗑️ Safe delete to Recycle Bin
- 📂 Open in Explorer
- 📡 Real-time WebSocket progress
- 🎨 Dark mode UI

---

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+

### Setup

```bash
# Clone
git clone https://github.com/<your-username>/disk-analyzer.git
cd disk-analyzer

# Backend (terminal 1)
cd backend
cargo run --release
# → API running at http://localhost:3000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev
# → UI at http://localhost:4321
```

Buka `http://localhost:4321`, pilih drive, klik **Scan Now**.

---

## Project Structure

```
disk-analyzer/
├── backend/              # Rust (Axum) API + WebSocket
│   └── src/
│       ├── main.rs       # Server entrypoint
│       ├── api.rs        # Routes & WS handlers
│       ├── scanner.rs    # Multi-threaded dir scanner
│       ├── models.rs     # Data types
│       └── error.rs      # Error handling
├── frontend/             # Astro + React + Tailwind
│   └── src/
│       ├── components/   # React components
│       ├── lib/          # API client, types, heuristics
│       └── pages/        # Astro pages
├── .gitignore
└── README.md
```

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/drives` | List drives |
| `POST` | `/api/scan` | Start scan |
| `GET` | `/api/scan/:id/status` | Scan status |
| `WS` | `/api/scan/progress?id=<id>` | Live progress |
| `POST` | `/api/open` | Open in Explorer |
| `POST` | `/api/delete` | Move to Recycle Bin |
| `DELETE` | `/api/cache` | Clear cache |

---

## Tech Stack

| | |
|---|---|
| **Backend** | Rust, Axum, Tokio, Rayon, DashMap, Serde |
| **Frontend** | Astro, React 18, TypeScript, D3.js, Framer Motion |
| **Styling** | TailwindCSS, Fira Sans/Code |

---

## License

MIT
