# Inventory Demo

Barcode-based inventory intake and consumption demo for manufacturing intralogistics.

## Features

- **Intake Scanning**: Camera-based barcode scanning for receiving inventory
- **Consumption Scanning**: Line-side scanning for consuming inventory
- **Real-time Inventory**: Dashboard showing current inventory levels
- **Automatic Replenishment**: Signals generated when inventory drops below threshold

## Quick Start

```bash
# Install dependencies
uv sync

# Run the API server
uvicorn inventory_demo.api.main:app --reload --port 8000
```

## Barcode Format

Barcodes should follow the format:
```
ITEM=<item_id>;QTY=<quantity>
```

Example:
```
ITEM=PART-88219;QTY=24
```

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/events/intake` - Create intake event
- `POST /api/events/consume` - Create consume event
- `GET /api/inventory` - List inventory
- `GET /api/signals` - List replenishment signals
- `GET /api/events/recent` - Recent activity

## Configuration

Set the following environment variables:

- `LAKEBASE_HOST` - PostgreSQL host
- `LAKEBASE_PORT` - PostgreSQL port (default: 5432)
- `LAKEBASE_DATABASE` - Database name
- `LAKEBASE_INSTANCE_NAME` - Lakebase instance for OAuth
- `DATABRICKS_HOST` - Databricks workspace URL
