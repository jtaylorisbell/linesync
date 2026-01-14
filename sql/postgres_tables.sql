-- Lakebase DDL for Inventory Demo
-- Run this against your Lakebase PostgreSQL instance

-- Drop existing objects if they exist (for clean re-deployment)
DROP VIEW IF EXISTS inventory_current;
DROP TABLE IF EXISTS replenishment_signals;
DROP TABLE IF EXISTS scan_events;

-- Scan events table: records all intake and consumption events
CREATE TABLE scan_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL CHECK (event_type IN ('INTAKE', 'CONSUME')),
    station_id TEXT NOT NULL,
    barcode_raw TEXT NOT NULL,
    item_id TEXT NOT NULL,
    qty INT NOT NULL CHECK (qty > 0),
    user_email TEXT  -- User who performed the scan (from IdP headers in prod, env in dev)
);

-- Index for efficient inventory calculations by item
CREATE INDEX idx_scan_events_item_id ON scan_events (item_id, event_ts DESC);

-- Index for recent activity queries
CREATE INDEX idx_scan_events_ts ON scan_events (event_ts DESC);

-- Replenishment signals table: tracks when items need restocking
CREATE TABLE replenishment_signals (
    signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    item_id TEXT NOT NULL,
    current_qty INT NOT NULL,
    reorder_point INT NOT NULL DEFAULT 10,
    reorder_qty INT NOT NULL DEFAULT 24,
    trigger_event_id UUID REFERENCES scan_events(event_id),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED'))
);

-- Index for querying signals by item and status
CREATE INDEX idx_replenishment_signals_item_status ON replenishment_signals (item_id, status);

-- Ensure only one OPEN signal per item at a time
CREATE UNIQUE INDEX idx_replenishment_signals_item_open
ON replenishment_signals (item_id)
WHERE status = 'OPEN';

-- Computed view for current inventory levels
CREATE VIEW inventory_current AS
SELECT
    item_id,
    COALESCE(SUM(CASE WHEN event_type = 'INTAKE' THEN qty ELSE 0 END), 0) AS intake_total,
    COALESCE(SUM(CASE WHEN event_type = 'CONSUME' THEN qty ELSE 0 END), 0) AS consume_total,
    COALESCE(SUM(CASE WHEN event_type = 'INTAKE' THEN qty ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN event_type = 'CONSUME' THEN qty ELSE 0 END), 0) AS on_hand_qty,
    MAX(event_ts) AS last_activity_ts
FROM scan_events
GROUP BY item_id;
