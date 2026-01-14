# Inventory Demo

Barcode-based inventory intake and consumption demo for manufacturing intralogistics.

## Features

- **Intake Scanning**: Camera-based barcode scanning for receiving inventory
- **Consumption Scanning**: Line-side scanning for consuming inventory
- **Real-time Inventory**: Dashboard showing current inventory levels
- **Automatic Replenishment**: Signals generated when inventory drops below threshold

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

## Deploying to Databricks Apps

### 1. Build the frontend

```bash
cd frontend && npm run build
```

### 2. Deploy the bundle

```bash
databricks bundle deploy -t dev
```

### 3. Deploy the app source code

```bash
databricks apps deploy inventory-demo-dev \
  --source-code-path /Workspace/Users/<your-email>/.bundle/inventory-demo/dev/files
```

### 4. Grant table permissions to the app service principal

**IMPORTANT**: The app runs as its own service principal, which won't have access to tables created by you. After the first deployment, you must grant permissions.

1. Get the app's service principal ID:
```bash
databricks apps get inventory-demo-dev | grep service_principal_client_id
```

2. Run the following SQL in Lakebase (replace `<APP_SERVICE_PRINCIPAL_ID>` with the actual ID):
```sql
GRANT ALL ON scan_events TO "<APP_SERVICE_PRINCIPAL_ID>";
GRANT ALL ON replenishment_signals TO "<APP_SERVICE_PRINCIPAL_ID>";
```

You can run this via the Lakebase Query Editor in the Databricks UI, or programmatically:
```bash
uv run python -c "
from inventory_demo.config import get_settings, _token_manager
import psycopg

settings = get_settings()
token = _token_manager.get_token(
    instance_name=settings.lakebase.instance_name,
    workspace_host=settings.databricks.host,
)

conn = psycopg.connect(
    host=settings.lakebase.host,
    port=5432,
    dbname=settings.lakebase.database,
    user=settings.lakebase.user,
    password=token,
    sslmode='require',
)
cur = conn.cursor()

app_sp = '<APP_SERVICE_PRINCIPAL_ID>'  # Replace with actual ID
cur.execute(f'GRANT ALL ON scan_events TO \"{app_sp}\"')
cur.execute(f'GRANT ALL ON replenishment_signals TO \"{app_sp}\"')
conn.commit()
print('Permissions granted!')
conn.close()
"
```

### 5. Access the app

The app URL will be shown in the deployment output, or get it with:
```bash
databricks apps get inventory-demo-dev | grep url
```

## CLI Commands

```bash
# Initialize database tables
uv run inventory-demo init-db

# Clear all data (with confirmation)
uv run inventory-demo clear-db

# Apply migrations (add new columns)
uv run inventory-demo migrate

# Check database status
uv run inventory-demo status
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
- `GET /api/me` - Current user info
- `POST /api/events/intake` - Create intake event
- `POST /api/events/consume` - Create consume event
- `GET /api/events/recent` - Recent activity
- `GET /api/inventory` - List inventory
- `GET /api/inventory/{item_id}` - Get item details
- `GET /api/signals` - List replenishment signals
- `POST /api/signals/{id}/acknowledge` - Acknowledge a signal

## Configuration

### Local Development

Set the following in `.env`:

- `LAKEBASE_HOST` - Lakebase PostgreSQL host
- `LAKEBASE_DATABASE` - Database name (default: `databricks_postgres`)
- `LAKEBASE_INSTANCE_NAME` - Lakebase instance name for OAuth
- `LAKEBASE_USER` - Database user (default: `lakebase`)
- `DATABRICKS_HOST` - Databricks workspace URL
- `USER_EMAIL` - Your email (for local user identification)

### Databricks Apps

When deployed to Databricks Apps:
- `PGHOST` and `PGDATABASE` are automatically set by the Lakebase resource
- Authentication uses the app's service principal OAuth token
- User identification comes from `X-Forwarded-Email` header

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React Frontend │────▶│   FastAPI       │────▶│   Lakebase      │
│   (Vite + TS)   │     │   Backend       │     │   (PostgreSQL)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │                       ▼
        │               ┌─────────────────┐
        └──────────────▶│ BarcodeDetector │
                        │ (Browser API)   │
                        └─────────────────┘
```
