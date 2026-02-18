# LineSync - Inventory Tracking Demo

A barcode-based inventory intake and consumption demo for manufacturing intralogistics, powered by Databricks Lakebase and Delta Live Tables.

## Features

- **Camera-Based Barcode Scanning**: Hands-free intake and consumption using device cameras
- **AI Packing Slip Parsing**: Upload photos or PDFs of packing slips - GPT-5 vision extracts line items automatically
- **Real-Time Inventory Dashboard**: Live view of current inventory levels and recent activity
- **Automatic Replenishment Signals**: Kanban-style alerts when inventory drops below threshold
- **Analytics-Ready Architecture**: Append-only schema with DLT pipeline for downstream analytics

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI (Python) |
| Database | Databricks Lakebase Autoscaling (Managed PostgreSQL) |
| AI/Vision | Databricks Foundation Model (GPT-5) |
| Analytics | Delta Live Tables (Bronze/Silver/Gold) |
| Deployment | Databricks Apps |
| Authentication | OAuth (Databricks-managed) |

## Quick Start (Local Development)

```bash
# Install dependencies
uv sync

# Copy and configure environment
cp .env.example .env
# Edit .env with your Databricks workspace host and user email

# Provision Lakebase infrastructure and write connection details to .env
uv run inventory-demo provision --write-env

# Initialize database tables
uv run inventory-demo init-db

# Run the API server (backend)
uv run uvicorn inventory_demo.api.main:app --reload --port 8000

# Run the frontend (in another terminal)
cd frontend && npm install && npm run dev
```

## Deployment (Databricks Apps)

### Prerequisites

- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/install.html) installed and configured
- Workspace with Lakebase, Databricks Apps, Unity Catalog, and Foundation Model APIs enabled
- Python 3.11+ with `uv`

### 1. Provision Lakebase Autoscaling

```bash
cp .env.example .env
# Edit .env with DATABRICKS_HOST and USER_EMAIL

uv sync
uv run inventory-demo provision --write-env
```

This creates a Lakebase project, branch, endpoint, and user role, then writes the connection details to `.env`.

### 2. Initialize Database

```bash
uv run inventory-demo init-db
uv run inventory-demo status       # verify connection
```

### 3. Configure and Deploy the Bundle

Update `databricks.yml` variables to match your workspace (project ID, catalogs, workspace profile), then:

```bash
databricks bundle validate -t dev
databricks bundle deploy -t dev
```

The frontend is built automatically by Databricks Apps during deployment.

### 4. Grant App Permissions

The deployed app runs as its own service principal, which needs table access:

```bash
uv run inventory-demo grant-app-access inventory-demo-dev
```

### 5. Access the App

```bash
databricks apps get inventory-demo-dev | grep url
```

Or find it in the Databricks UI under **Compute > Apps**.

> For the full deployment guide including DLT pipeline setup, troubleshooting, and production considerations, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data models, and design decisions |
| [Analytics](docs/ANALYTICS.md) | DLT pipeline, medallion architecture, and analytics queries |
| [API Reference](docs/API.md) | Complete API endpoint documentation |
| [Deployment](docs/DEPLOYMENT.md) | Detailed deployment guide for Databricks Apps |

## Project Structure

```
warehouse-mgmt/
├── src/inventory_demo/       # Python backend
│   ├── api/                  # FastAPI routes and schemas
│   │   ├── main.py          # API endpoints
│   │   ├── schemas.py       # Pydantic models
│   │   ├── barcode_parser.py
│   │   └── packing_slip_parser.py  # GPT-5 vision integration
│   ├── core/                 # Business logic
│   │   ├── inventory_service.py
│   │   └── models.py
│   ├── db/                   # Database layer
│   │   ├── postgres.py      # Lakebase operations
│   │   └── schemas.py       # SQLAlchemy ORM models
│   ├── config.py            # Settings management
│   ├── infra.py             # Lakebase provisioner
│   └── cli.py               # CLI commands
├── frontend/                 # React frontend
│   └── src/
│       ├── components/      # UI components
│       └── pages/           # Page views (Intake, Inventory, Consume)
├── pipelines/               # DLT pipelines
│   └── lakebase_to_delta.py # Lakebase → Delta Lake ETL
├── resources/               # Databricks bundle resources
│   └── lakebase_pipeline.yml
└── databricks.yml           # Databricks Asset Bundle config
```

## Barcode Format

Barcodes encode item ID and quantity in a simple format:

```
ITEM=<item_id>;QTY=<quantity>
```

**Example:** `ITEM=PART-88219;QTY=24`

Generate test barcodes at [barcode.tec-it.com](https://barcode.tec-it.com/en/Code128?data=ITEM%3DPART-88219%3BQTY%3D24).

## CLI Commands

```bash
# Provision Lakebase infrastructure (project, branch, endpoint, role)
uv run inventory-demo provision --write-env

# Initialize database tables (creates schema from scratch)
uv run inventory-demo init-db

# Apply migrations (for schema updates)
uv run inventory-demo migrate

# Check database status and table counts
uv run inventory-demo status

# Clear all data (with confirmation)
uv run inventory-demo clear-db

# Grant app service principal access to tables
uv run inventory-demo grant-app-access inventory-demo-dev
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Databricks Workspace                            │
│  ┌────────────────┐      ┌────────────────┐      ┌────────────────────────┐ │
│  │   Databricks   │      │    Lakebase    │      │   Delta Live Tables    │ │
│  │      Apps      │─────▶│  (PostgreSQL)  │─────▶│  (Bronze/Silver/Gold)  │ │
│  └────────────────┘      └────────────────┘      └────────────────────────┘ │
│         │                        │                          │               │
│         │                        │                          ▼               │
│         │                        │               ┌────────────────────────┐ │
│         │                        │               │    Unity Catalog       │ │
│         │                        │               │    (Delta Tables)      │ │
│         │                        │               └────────────────────────┘ │
└─────────┼────────────────────────┼──────────────────────────────────────────┘
          │                        │
          ▼                        ▼
   ┌─────────────┐         ┌─────────────┐
   │   Browser   │         │  Analytics  │
   │  (React UI) │         │  (SQL/BI)   │
   └─────────────┘         └─────────────┘
```

## Data Flow

1. **Intake/Consume**: User scans barcode → API creates `scan_events` row
2. **Real-Time View**: Dashboard queries `inventory_current` view
3. **Replenishment**: Consume triggers check → creates `replenishment_signals` row if below threshold
4. **Analytics**: DLT pipeline syncs Lakebase → Delta Lake for BI/ML workloads

## Contributing

This is a demo application. For production use, consider:

- Adding proper authentication and authorization
- Implementing idempotency keys for event creation
- Adding comprehensive error handling and retry logic
- Setting up monitoring and alerting
