# Architecture

This document describes the system architecture, data models, and key design decisions for the LineSync inventory tracking demo.

## System Overview

LineSync is a warehouse inventory tracking application that demonstrates:

1. **Real-time inventory management** using barcode scanning
2. **AI-powered document processing** for packing slips
3. **Analytics-ready data architecture** with append-only patterns

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    Frontend (React)                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Intake Page │  │ Inventory    │  │ Consume Page │  │  Packing Slip Upload   │  │
│  │  (Camera)    │  │ Dashboard    │  │  (Camera)    │  │  (Photo/PDF + AI)      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────────────────┘  │
└───────────────────────────────────────────┬─────────────────────────────────────────┘
                                            │ HTTP/REST
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   Backend (FastAPI)                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │   API Routes     │  │ Inventory        │  │   Packing Slip Parser            │  │
│  │   /api/events/*  │  │ Service          │  │   (GPT-5 Vision)                 │  │
│  │   /api/signals/* │  │ (Business Logic) │  │                                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────────────┘  │
└───────────────────────────────────────────┬─────────────────────────────────────────┘
                                            │ SQL (psycopg)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Databricks Lakebase (PostgreSQL)                           │
│  ┌──────────────────┐  ┌──────────────────────────┐  ┌────────────────────────┐    │
│  │   scan_events    │  │  replenishment_signals   │  │   inventory_current    │    │
│  │   (Table)        │  │  (Table - Append-Only)   │  │   (View)               │    │
│  └──────────────────┘  └──────────────────────────┘  └────────────────────────┘    │
└───────────────────────────────────────────┬─────────────────────────────────────────┘
                                            │ Unity Catalog Foreign Table
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          Delta Live Tables Pipeline                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────────────────┐│
│  │    Bronze    │────▶│    Silver    │────▶│              Gold                     ││
│  │  (Raw Copy)  │     │  (Cleaned)   │     │  (Aggregated Business Metrics)       ││
│  └──────────────┘     └──────────────┘     └──────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Models

### scan_events (Core Transaction Table)

Records every inventory movement - both intake and consumption.

```sql
CREATE TABLE scan_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL CHECK (event_type IN ('INTAKE', 'CONSUME')),
    station_id TEXT NOT NULL,
    barcode_raw TEXT NOT NULL,
    item_id TEXT NOT NULL,
    qty INT NOT NULL CHECK (qty > 0),
    user_email TEXT
);
```

| Column | Description |
|--------|-------------|
| `event_id` | Unique identifier for this event |
| `event_ts` | Timestamp when the event was recorded |
| `event_type` | Either `INTAKE` (receiving) or `CONSUME` (usage) |
| `station_id` | Identifies the scanning station/camera |
| `barcode_raw` | Original barcode string as scanned |
| `item_id` | Part number extracted from barcode |
| `qty` | Quantity in this transaction |
| `user_email` | Email of user who performed the scan |

### replenishment_signals (Append-Only Pattern)

Tracks when items need restocking. Uses an **append-only pattern** for downstream analytics.

```sql
CREATE TABLE replenishment_signals (
    id SERIAL PRIMARY KEY,                    -- Surrogate key (each row)
    signal_id UUID NOT NULL,                  -- Logical signal identifier
    created_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    item_id TEXT NOT NULL,
    triggered_at_qty INT NOT NULL,            -- Historical snapshot
    reorder_point INT NOT NULL DEFAULT 10,
    reorder_qty INT NOT NULL DEFAULT 24,
    trigger_event_id UUID REFERENCES scan_events(event_id),
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED'))
);
```

**Key Design Decision: Append-Only Schema**

Instead of updating rows in place, each status change creates a new row:

```
┌─────────────────────────────────────────────────────────────────┐
│  Traditional UPDATE Pattern (NOT used)                          │
├─────────────────────────────────────────────────────────────────┤
│  UPDATE replenishment_signals                                   │
│  SET status = 'FULFILLED', updated_ts = NOW()                   │
│  WHERE signal_id = '...'                                        │
│                                                                 │
│  Problem: Loses history, breaks analytics                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Append-Only Pattern (USED)                                     │
├─────────────────────────────────────────────────────────────────┤
│  INSERT INTO replenishment_signals                              │
│  (signal_id, status, item_id, ...)                             │
│  VALUES ('...', 'FULFILLED', ...)                              │
│                                                                 │
│  Benefit: Full history preserved for analytics                  │
└─────────────────────────────────────────────────────────────────┘
```

**Getting Current State (Window Function)**:

```sql
WITH latest AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY signal_id
               ORDER BY created_ts DESC
           ) as rn
    FROM replenishment_signals
)
SELECT * FROM latest WHERE rn = 1;
```

### inventory_current (Computed View)

Calculates real-time inventory from scan events:

```sql
CREATE VIEW inventory_current AS
SELECT
    item_id,
    SUM(CASE WHEN event_type = 'INTAKE' THEN qty ELSE 0 END) AS intake_total,
    SUM(CASE WHEN event_type = 'CONSUME' THEN qty ELSE 0 END) AS consume_total,
    SUM(CASE WHEN event_type = 'INTAKE' THEN qty ELSE 0 END) -
    SUM(CASE WHEN event_type = 'CONSUME' THEN qty ELSE 0 END) AS on_hand_qty,
    MAX(event_ts) AS last_activity_ts
FROM scan_events
GROUP BY item_id;
```

## Key Design Decisions

### 1. Event Sourcing for Inventory

**Decision**: Calculate inventory from events rather than maintaining a separate inventory table.

**Rationale**:
- Full audit trail of all movements
- No risk of inventory count drift
- Simplifies the data model
- Enables time-travel queries ("what was inventory at 3pm?")

**Trade-off**: Requires aggregation on read, but acceptable for demo scale.

### 2. Append-Only Replenishment Signals

**Decision**: Never UPDATE the replenishment_signals table; only INSERT.

**Rationale**:
- Preserves complete signal lifecycle for analytics
- Enables tracking fulfillment time (SLA metrics)
- Compatible with streaming analytics (Delta Live Tables)
- Avoids CDC complexity in downstream pipelines

**Implementation**:
- `id` is the row-level surrogate key (auto-increment)
- `signal_id` groups related rows (logical identifier)
- Use window functions to find latest state

### 3. Live Inventory in API Responses

**Decision**: Join with live inventory instead of returning stale `triggered_at_qty`.

**Rationale**:
- `triggered_at_qty` is a historical snapshot (useful for analytics)
- UI needs current values for actionable display
- The join is fast enough for real-time use

```sql
SELECT
    s.signal_id,
    s.item_id,
    s.triggered_at_qty,              -- Historical (when signal was created)
    COALESCE(i.on_hand_qty, 0) AS current_qty  -- LIVE (actual inventory now)
FROM replenishment_signals_current s
LEFT JOIN inventory_current i ON s.item_id = i.item_id;
```

### 4. OAuth-Only Authentication

**Decision**: Use Databricks OAuth exclusively, never Personal Access Tokens.

**Rationale**:
- Automatic token refresh
- Proper audit trail
- Service principal support for deployed apps
- Follows Databricks security best practices

### 5. PDF-to-Image Conversion (Client-Side)

**Decision**: Convert PDFs to images in the browser before sending to vision API.

**Rationale**:
- GPT-5 vision API expects images, not PDFs
- Client-side conversion with PDF.js reduces backend complexity
- First page is typically sufficient for packing slips
- Maintains quality at 2x scale for OCR accuracy

## Security Considerations

### Authentication Flow

**Local Development**:
1. Uses `databricks-sdk` OAuth flow
2. Tokens managed by `TokenManager` singleton
3. User identified via `USER_EMAIL` env var

**Databricks Apps**:
1. App runs as service principal
2. User identified via `X-Forwarded-Email` header
3. Tokens automatically refreshed by Databricks runtime

### Data Access

- Lakebase tables require explicit GRANT for app service principal
- Unity Catalog provides governance for Delta tables
- All connections use SSL/TLS

## Performance Characteristics

| Operation | Expected Latency |
|-----------|------------------|
| Single barcode scan | < 100ms |
| Inventory dashboard | < 200ms |
| Packing slip parse | 2-5 seconds (AI model) |
| DLT pipeline refresh | Minutes (batch) |

## Scaling Considerations

This is a demo application. For production scale:

1. **Add caching**: Redis for hot inventory data
2. **Partition tables**: By date for time-series queries
3. **Add indexes**: Based on query patterns
4. **Consider streaming**: Real-time DLT for lower latency
5. **Add connection pooling**: PgBouncer for high concurrency
