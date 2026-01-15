"""Declarative Pipeline: Lakebase to Delta Lake.

Reads from Lakebase tables (registered as Unity Catalog catalog) and writes
to Delta tables with bronze/silver/gold medallion architecture.

Configure the source catalog in pipeline settings:
  - source_catalog: The UC catalog for your Lakebase instance
  - source_schema: The schema containing scan_events and replenishment_signals
"""

# ruff: noqa: F821
# spark and dbutils are provided by Databricks runtime

import dlt  # type: ignore
from pyspark.sql import functions as F  # type: ignore


# =============================================================================
# Bronze Layer: Raw tables from Lakebase
# =============================================================================


@dlt.table(
    name="bronze_scan_events",
    comment="Raw scan events from Lakebase - intake and consumption",
    table_properties={"quality": "bronze"},
)
def bronze_scan_events():
    """Ingest scan_events table from Lakebase."""
    catalog = spark.conf.get("pipeline.source_catalog", "lakebase")
    schema = spark.conf.get("pipeline.source_schema", "public")
    return spark.table(f"{catalog}.{schema}.scan_events")


@dlt.table(
    name="bronze_replenishment_signals",
    comment="Raw replenishment signals from Lakebase - low inventory alerts",
    table_properties={"quality": "bronze"},
)
def bronze_replenishment_signals():
    """Ingest replenishment_signals table from Lakebase."""
    catalog = spark.conf.get("pipeline.source_catalog", "lakebase")
    schema = spark.conf.get("pipeline.source_schema", "public")
    return spark.table(f"{catalog}.{schema}.replenishment_signals")


# =============================================================================
# Silver Layer: Cleaned and enriched data
# =============================================================================


@dlt.table(
    name="silver_scan_events",
    comment="Cleaned scan events with standardized types and validation",
    table_properties={"quality": "silver"},
)
@dlt.expect_or_drop("valid_event_type", "event_type IN ('INTAKE', 'CONSUME')")
@dlt.expect_or_drop("valid_qty", "qty > 0")
@dlt.expect_or_drop("valid_item_id", "item_id IS NOT NULL AND LENGTH(item_id) > 0")
def silver_scan_events():
    """Clean and validate scan events."""
    return (
        dlt.read("bronze_scan_events")
        .withColumn("event_date", F.to_date("event_ts"))
        .withColumn("event_hour", F.hour("event_ts"))
    )


@dlt.table(
    name="silver_replenishment_signals",
    comment="Cleaned replenishment signals with enrichment",
    table_properties={"quality": "silver"},
)
@dlt.expect_or_drop("valid_status", "status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED')")
def silver_replenishment_signals():
    """Clean and enrich replenishment signals.

    Note: triggered_at_qty is the historical snapshot of inventory when the signal was created.
    """
    return (
        dlt.read("bronze_replenishment_signals")
        .withColumn("signal_date", F.to_date("created_ts"))
        .withColumn("qty_below_reorder", F.col("reorder_point") - F.col("triggered_at_qty"))
    )


# =============================================================================
# Gold Layer: Aggregated business metrics
# =============================================================================
#
# Gold tables provide pre-aggregated, business-ready metrics optimized for
# dashboards, reporting, and analytics. These are the primary tables that
# end users and BI tools should query.
#
# Key design principles:
#   - Pre-computed aggregations for fast query performance
#   - Business-friendly column names and semantics
#   - Handles the append-only pattern complexity internally
#   - Joins related data for complete business context
# =============================================================================


@dlt.table(
    name="gold_inventory_summary",
    comment="""Current inventory levels by item - the authoritative source of truth for on-hand quantities.

Uses event sourcing: instead of maintaining a separate inventory table that could drift, we compute current state by aggregating all historical intake and consumption events.

COLUMNS:
- item_id: The unique part number / SKU identifier
- on_hand_qty: Current inventory = SUM(intake) - SUM(consumed)
- total_events: Count of all scan events (useful for activity analysis)
- total_intake: Lifetime quantity received (useful for velocity calculations)
- total_consumed: Lifetime quantity used (useful for demand forecasting)
- last_activity: Timestamp of most recent event (useful for stale inventory detection)

EXAMPLE QUERIES:
- Items below reorder point: WHERE on_hand_qty <= 10
- High-velocity items: ORDER BY total_consumed DESC
- Stale inventory: WHERE last_activity < CURRENT_DATE - INTERVAL 30 DAYS""",
    table_properties={"quality": "gold"},
)
def gold_inventory_summary():
    """Calculate current on-hand quantity for each item using event sourcing."""
    return (
        dlt.read("silver_scan_events")
        .groupBy("item_id")
        .agg(
            # Net inventory: intake adds, consumption subtracts
            F.sum(
                F.when(F.col("event_type") == "INTAKE", F.col("qty"))
                .otherwise(-F.col("qty"))
            ).alias("on_hand_qty"),
            F.count("*").alias("total_events"),
            F.sum(
                F.when(F.col("event_type") == "INTAKE", F.col("qty")).otherwise(0)
            ).alias("total_intake"),
            F.sum(
                F.when(F.col("event_type") == "CONSUME", F.col("qty")).otherwise(0)
            ).alias("total_consumed"),
            F.max("event_ts").alias("last_activity"),
        )
    )


@dlt.table(
    name="gold_daily_activity",
    comment="""Daily inventory activity summary - time-series view for trend analysis and capacity planning.

Provides warehouse operations broken down by day and event type. Essential for understanding operational patterns, capacity planning, and identifying anomalies.

COLUMNS:
- event_date: The calendar date (truncated from event_ts)
- event_type: Either 'INTAKE' or 'CONSUME'
- event_count: Number of scan events that day
- total_qty: Sum of quantities moved
- unique_items: Count of distinct SKUs touched (breadth of activity)
- unique_stations: Count of distinct scan stations used (operational footprint)

EXAMPLE QUERIES:
- Daily receiving volume: WHERE event_type = 'INTAKE' ORDER BY event_date
- Busiest days: ORDER BY event_count DESC LIMIT 10
- Consumption trends: WHERE event_type = 'CONSUME' AND event_date >= '2024-01-01'""",
    table_properties={"quality": "gold"},
)
def gold_daily_activity():
    """Aggregate daily inventory activity for trend analysis."""
    return (
        dlt.read("silver_scan_events")
        .groupBy("event_date", "event_type")
        .agg(
            F.count("*").alias("event_count"),
            F.sum("qty").alias("total_qty"),
            F.countDistinct("item_id").alias("unique_items"),
            F.countDistinct("station_id").alias("unique_stations"),
        )
        .orderBy("event_date", "event_type")
    )


@dlt.table(
    name="gold_open_replenishment_signals",
    comment="""Open replenishment signals requiring action - actionable alerts for the warehouse team.

Powers the replenishment workflow by showing signals that still need attention. Handles the append-only signal pattern using window functions to find the latest state of each signal.

IMPORTANT: The replenishment_signals table is append-only (each status change creates a new row). We use ROW_NUMBER() to get only the most recent row per signal_id, then filter to those still in 'OPEN' status.

Joins with gold_inventory_summary to show CURRENT inventory levels, not the stale snapshot from when the signal was created. This lets users see if an item has already been restocked.

COLUMNS:
- signal_id: Unique identifier for this replenishment signal
- item_id: The part number that needs restocking
- qty_at_signal: Inventory level when signal was triggered (historical snapshot)
- current_on_hand: LIVE inventory level (may differ if restocked since signal)
- reorder_point: The threshold that triggered this signal
- reorder_qty: Suggested quantity to order
- created_ts: When the signal was originally created
- signal_date: Date portion of created_ts for easier filtering
- already_restocked: TRUE if current inventory > reorder point (signal may be closeable)

EXAMPLE QUERIES:
- Urgent signals (out of stock): WHERE current_on_hand <= 0
- Signals that can be auto-closed: WHERE already_restocked = true
- Oldest open signals (SLA risk): ORDER BY created_ts ASC""",
    table_properties={"quality": "gold"},
)
def gold_open_replenishment_signals():
    """Get currently open replenishment signals enriched with live inventory data."""
    from pyspark.sql.window import Window

    # Window function to get the most recent row per signal_id
    # This handles our append-only pattern where status changes create new rows
    window_spec = Window.partitionBy("signal_id").orderBy(F.col("created_ts").desc())
    latest_signals = (
        dlt.read("silver_replenishment_signals")
        .withColumn("rn", F.row_number().over(window_spec))
        .filter(F.col("rn") == 1)  # Keep only the latest row per signal
        .drop("rn")
        .filter(F.col("status") == "OPEN")  # Only signals still needing action
    )

    # Join with live inventory to get current on-hand quantities
    inventory = dlt.read("gold_inventory_summary")

    return (
        latest_signals.join(inventory, "item_id", "left")
        .select(
            latest_signals["signal_id"],
            latest_signals["item_id"],
            latest_signals["triggered_at_qty"].alias("qty_at_signal"),
            inventory["on_hand_qty"].alias("current_on_hand"),
            latest_signals["reorder_point"],
            latest_signals["reorder_qty"],
            latest_signals["created_ts"],
            latest_signals["signal_date"],
            # Flag items where inventory has recovered above reorder point
            (inventory["on_hand_qty"] > latest_signals["reorder_point"]).alias(
                "already_restocked"
            ),
        )
    )


@dlt.table(
    name="gold_replenishment_metrics",
    comment="""Replenishment signal KPIs by status - executive dashboard for supply chain health.

High-level metrics for monitoring replenishment SLA performance. Handles the append-only pattern by finding the latest state of each signal before aggregating.

COLUMNS:
- status: One of 'OPEN', 'ACKNOWLEDGED', or 'FULFILLED'
- signal_count: Total signals currently in this status
- unique_items: Count of distinct items with signals in this status
- avg_qty_below_reorder: Average severity (how far below reorder point when triggered)

HOW TO INTERPRET:
- High OPEN count = backlog in replenishment process, warehouse team falling behind
- High ACKNOWLEDGED but low FULFILLED = bottleneck in fulfillment/ordering
- High avg_qty_below_reorder = signals being triggered too late, consider raising reorder points

EXAMPLE QUERIES:
- Current backlog: WHERE status = 'OPEN'
- Track fulfillment rate over time: Compare FULFILLED counts across pipeline runs""",
    table_properties={"quality": "gold"},
)
def gold_replenishment_metrics():
    """Calculate replenishment KPIs grouped by signal status."""
    from pyspark.sql.window import Window

    # Get the current state of each signal (latest row per signal_id)
    window_spec = Window.partitionBy("signal_id").orderBy(F.col("created_ts").desc())
    latest_signals = (
        dlt.read("silver_replenishment_signals")
        .withColumn("rn", F.row_number().over(window_spec))
        .filter(F.col("rn") == 1)
        .drop("rn")
    )

    return (
        latest_signals
        .groupBy("status")
        .agg(
            F.count("*").alias("signal_count"),
            F.countDistinct("item_id").alias("unique_items"),
            F.avg("qty_below_reorder").alias("avg_qty_below_reorder"),
        )
    )
