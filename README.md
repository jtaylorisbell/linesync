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
| Database | Databricks Lakebase (Managed PostgreSQL) |
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
# Edit .env with your Lakebase connection details

# Initialize database tables
uv run inventory-demo init-db

# Run the API server (backend)
uv run uvicorn inventory_demo.api.main:app --reload --port 8000

# Run the frontend (in another terminal)
cd frontend && npm install && npm run dev
```

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

## License

Internal demo - Databricks confidential.
