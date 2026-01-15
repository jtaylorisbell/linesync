# Analytics Guide

This guide covers the Delta Live Tables pipeline, medallion architecture, and example analytics queries for the LineSync inventory demo.

## Delta Live Tables Pipeline

The DLT pipeline syncs data from Lakebase (PostgreSQL) to Delta Lake for analytics workloads.

### Pipeline Configuration

Location: `pipelines/lakebase_to_delta.py`

```yaml
# resources/lakebase_pipeline.yml
pipelines:
  lakebase_to_delta:
    name: inventory-lakebase-to-delta-${bundle.target}
    catalog: ${var.target_catalog}
    target: inventory
    configuration:
      pipeline.source_catalog: ${var.lakebase_catalog}
      pipeline.source_schema: ${var.lakebase_schema}
    serverless: true
```

### Running the Pipeline

```bash
# Deploy the pipeline
databricks bundle deploy -t dev

# Trigger a refresh
databricks pipelines start-update <pipeline-id>

# Or use the Databricks UI:
# Workflows > Delta Live Tables > inventory-lakebase-to-delta-dev > Start
```

## Medallion Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────────┐
│     BRONZE      │     │     SILVER      │     │           GOLD              │
│   (Raw Copy)    │────▶│   (Cleaned)     │────▶│  (Business Aggregates)      │
└─────────────────┘     └─────────────────┘     └─────────────────────────────┘
```

### Bronze Layer (Raw)

Direct copy from Lakebase with no transformations.

| Table | Source | Description |
|-------|--------|-------------|
| `bronze_scan_events` | `scan_events` | All intake/consume events |
| `bronze_replenishment_signals` | `replenishment_signals` | All signal rows (append-only) |

### Silver Layer (Cleaned)

Data quality rules applied, enriched with computed columns.

| Table | Description | Quality Rules |
|-------|-------------|---------------|
| `silver_scan_events` | Validated events with date/hour | `event_type IN ('INTAKE', 'CONSUME')`, `qty > 0`, `item_id IS NOT NULL` |
| `silver_replenishment_signals` | Enriched signals | `status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED')` |

**Enrichments Applied**:
- `event_date`: Date extracted from `event_ts`
- `event_hour`: Hour extracted from `event_ts`
- `signal_date`: Date extracted from `created_ts`
- `qty_below_reorder`: `reorder_point - triggered_at_qty`

### Gold Layer (Business Metrics)

Pre-aggregated tables for dashboards and reporting.

| Table | Description |
|-------|-------------|
| `gold_inventory_summary` | Current inventory by item |
| `gold_daily_activity` | Daily intake/consume aggregates |
| `gold_open_replenishment_signals` | Open signals with current inventory |
| `gold_replenishment_metrics` | Signal counts by status |

## Data Quality Expectations

The pipeline uses DLT expectations to enforce data quality:

```python
@dlt.expect_or_drop("valid_event_type", "event_type IN ('INTAKE', 'CONSUME')")
@dlt.expect_or_drop("valid_qty", "qty > 0")
@dlt.expect_or_drop("valid_item_id", "item_id IS NOT NULL AND LENGTH(item_id) > 0")
```

Rows failing expectations are dropped and logged to the pipeline's event log.

## Example Analytics Queries

### Current Inventory Levels

```sql
SELECT
    item_id,
    on_hand_qty,
    total_intake,
    total_consumed,
    last_activity
FROM inventory.gold_inventory_summary
ORDER BY on_hand_qty ASC;
```

### Daily Activity Trends

```sql
SELECT
    event_date,
    event_type,
    event_count,
    total_qty,
    unique_items
FROM inventory.gold_daily_activity
WHERE event_date >= CURRENT_DATE - INTERVAL 30 DAYS
ORDER BY event_date DESC;
```

### Open Replenishment Signals

```sql
SELECT
    signal_id,
    item_id,
    qty_at_signal,        -- Inventory when signal was triggered
    current_on_hand,      -- Current inventory (may have changed)
    reorder_point,
    reorder_qty,
    created_ts,
    already_restocked     -- TRUE if inventory now above reorder_point
FROM inventory.gold_open_replenishment_signals
ORDER BY created_ts ASC;
```

### Replenishment SLA Analysis

Track how long signals stay open before being fulfilled:

```sql
WITH signal_lifecycle AS (
    SELECT
        signal_id,
        item_id,
        MIN(CASE WHEN status = 'OPEN' THEN created_ts END) AS opened_at,
        MIN(CASE WHEN status = 'ACKNOWLEDGED' THEN created_ts END) AS acknowledged_at,
        MIN(CASE WHEN status = 'FULFILLED' THEN created_ts END) AS fulfilled_at
    FROM inventory.silver_replenishment_signals
    GROUP BY signal_id, item_id
)
SELECT
    signal_id,
    item_id,
    opened_at,
    fulfilled_at,
    fulfilled_at - opened_at AS time_to_fulfill,
    acknowledged_at - opened_at AS time_to_acknowledge
FROM signal_lifecycle
WHERE fulfilled_at IS NOT NULL
ORDER BY time_to_fulfill DESC;
```

### Consumption Rate by Item

```sql
WITH daily_consumption AS (
    SELECT
        item_id,
        event_date,
        SUM(qty) AS consumed_qty
    FROM inventory.silver_scan_events
    WHERE event_type = 'CONSUME'
      AND event_date >= CURRENT_DATE - INTERVAL 7 DAYS
    GROUP BY item_id, event_date
)
SELECT
    item_id,
    AVG(consumed_qty) AS avg_daily_consumption,
    MAX(consumed_qty) AS max_daily_consumption,
    COUNT(DISTINCT event_date) AS active_days
FROM daily_consumption
GROUP BY item_id
ORDER BY avg_daily_consumption DESC;
```

### Peak Activity Hours

```sql
SELECT
    event_hour,
    SUM(CASE WHEN event_type = 'INTAKE' THEN 1 ELSE 0 END) AS intake_events,
    SUM(CASE WHEN event_type = 'CONSUME' THEN 1 ELSE 0 END) AS consume_events,
    COUNT(*) AS total_events
FROM inventory.silver_scan_events
GROUP BY event_hour
ORDER BY event_hour;
```

### Items Frequently Below Reorder Point

```sql
SELECT
    item_id,
    COUNT(DISTINCT signal_id) AS signal_count,
    AVG(qty_below_reorder) AS avg_qty_below,
    MIN(triggered_at_qty) AS min_triggered_qty
FROM inventory.silver_replenishment_signals
WHERE status = 'OPEN'
GROUP BY item_id
HAVING COUNT(DISTINCT signal_id) > 1
ORDER BY signal_count DESC;
```

## Window Function Pattern for Append-Only Tables

The replenishment_signals table is append-only. To get the current state of each signal:

```sql
-- Get latest row per signal_id
WITH latest AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY signal_id
               ORDER BY created_ts DESC
           ) as rn
    FROM inventory.silver_replenishment_signals
)
SELECT *
FROM latest
WHERE rn = 1;
```

This pattern is used in:
- `gold_open_replenishment_signals`
- `gold_replenishment_metrics`
- API endpoints that return signal status

## Connecting BI Tools

### Databricks SQL

Delta tables are directly queryable in Databricks SQL:

```sql
USE CATALOG your_catalog;
USE SCHEMA inventory;

SELECT * FROM gold_inventory_summary;
```

### External BI Tools (Tableau, Power BI, etc.)

1. Use Databricks SQL Connector or JDBC/ODBC
2. Connect to Unity Catalog
3. Query tables: `catalog.inventory.gold_*`

### Python (pandas/spark)

```python
# In a Databricks notebook
df = spark.table("your_catalog.inventory.gold_inventory_summary")
display(df)

# Or with pandas
import pandas as pd
pdf = df.toPandas()
```

## Monitoring Pipeline Health

### Event Log Queries

```sql
-- Check for data quality failures
SELECT
    timestamp,
    details:expectation_name,
    details:passed_records,
    details:failed_records
FROM event_log(TABLE(inventory_lakebase_to_delta))
WHERE event_type = 'flow_progress'
  AND details:expectation_name IS NOT NULL;
```

### Data Freshness

```sql
-- Check when gold tables were last updated
SELECT
    table_name,
    MAX(event_ts) AS latest_event,
    CURRENT_TIMESTAMP - MAX(event_ts) AS staleness
FROM (
    SELECT 'scan_events' AS table_name, event_ts FROM inventory.bronze_scan_events
    UNION ALL
    SELECT 'replenishment_signals', created_ts FROM inventory.bronze_replenishment_signals
)
GROUP BY table_name;
```

## Best Practices

1. **Query Gold Tables First**: Pre-aggregated for common use cases
2. **Use Silver for Ad-Hoc**: When you need row-level detail with quality guarantees
3. **Avoid Bronze in Production**: Raw data without quality checks
4. **Schedule Regular Refreshes**: Set pipeline to run on schedule for near-real-time analytics
5. **Monitor Data Quality**: Check event logs for dropped rows
