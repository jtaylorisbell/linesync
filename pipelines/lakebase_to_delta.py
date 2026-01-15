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
    """Clean and enrich replenishment signals."""
    return (
        dlt.read("bronze_replenishment_signals")
        .withColumn("signal_date", F.to_date("created_ts"))
        .withColumn("qty_below_reorder", F.col("reorder_point") - F.col("current_qty"))
    )


# =============================================================================
# Gold Layer: Aggregated business metrics
# =============================================================================


@dlt.table(
    name="gold_inventory_summary",
    comment="Current inventory levels by item",
    table_properties={"quality": "gold"},
)
def gold_inventory_summary():
    """Calculate current on-hand quantity for each item."""
    return (
        dlt.read("silver_scan_events")
        .groupBy("item_id")
        .agg(
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
    comment="Daily inventory activity summary",
    table_properties={"quality": "gold"},
)
def gold_daily_activity():
    """Aggregate daily inventory activity."""
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
    comment="Open replenishment signals requiring action",
    table_properties={"quality": "gold"},
)
def gold_open_replenishment_signals():
    """Get open replenishment signals with current inventory context."""
    signals = dlt.read("silver_replenishment_signals").filter(
        F.col("status") == "OPEN"
    )
    inventory = dlt.read("gold_inventory_summary")

    return (
        signals.join(inventory, "item_id", "left")
        .select(
            signals["signal_id"],
            signals["item_id"],
            signals["current_qty"].alias("qty_at_signal"),
            inventory["on_hand_qty"].alias("current_on_hand"),
            signals["reorder_point"],
            signals["reorder_qty"],
            signals["created_ts"],
            signals["signal_date"],
            (inventory["on_hand_qty"] > signals["reorder_point"]).alias(
                "already_restocked"
            ),
        )
    )


@dlt.table(
    name="gold_replenishment_metrics",
    comment="Replenishment signal metrics and SLA tracking",
    table_properties={"quality": "gold"},
)
def gold_replenishment_metrics():
    """Calculate replenishment metrics."""
    return (
        dlt.read("silver_replenishment_signals")
        .groupBy("status")
        .agg(
            F.count("*").alias("signal_count"),
            F.countDistinct("item_id").alias("unique_items"),
            F.avg("qty_below_reorder").alias("avg_qty_below_reorder"),
        )
    )
