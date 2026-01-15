"""CLI for Inventory Demo database management."""

import psycopg
import typer
from rich.console import Console
from rich.panel import Panel

from inventory_demo.config import get_settings, _token_manager

app = typer.Typer(
    name="inventory-demo",
    help="Inventory Demo CLI - manage Lakebase tables",
    add_completion=False,
)
console = Console()


def get_local_connection() -> psycopg.Connection:
    """Get a database connection using local credentials."""
    settings = get_settings()
    token = _token_manager.get_token(
        instance_name=settings.lakebase.instance_name,
        workspace_host=settings.databricks.host,
    )
    return psycopg.connect(
        host=settings.lakebase.host,
        port=5432,
        dbname=settings.lakebase.database,
        user=settings.lakebase.user,
        password=token,
        sslmode="require",
    )


@app.command()
def init_db(
    dry_run: bool = typer.Option(False, "--dry-run", help="Show SQL without executing"),
):
    """Initialize Lakebase tables (create tables and views)."""

    init_sql = """
-- Drop existing objects if they exist (for clean re-deployment)
DROP VIEW IF EXISTS inventory_current;
DROP VIEW IF EXISTS replenishment_signals_current;
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
    user_email TEXT  -- User who performed the scan
);

-- Index for efficient inventory calculations by item
CREATE INDEX idx_scan_events_item_id ON scan_events (item_id, event_ts DESC);

-- Index for recent activity queries
CREATE INDEX idx_scan_events_ts ON scan_events (event_ts DESC);

-- Replenishment signals table: tracks when items need restocking
-- This is an APPEND-ONLY table for analytics. Each status change creates a new row.
-- Use signal_id to group related rows, created_ts to find the latest state.
CREATE TABLE replenishment_signals (
    id SERIAL PRIMARY KEY,                    -- Surrogate key for each row
    signal_id UUID NOT NULL DEFAULT gen_random_uuid(),  -- Logical signal identifier
    created_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    item_id TEXT NOT NULL,
    triggered_at_qty INT NOT NULL,            -- Qty when this status was recorded (historical)
    reorder_point INT NOT NULL DEFAULT 10,
    reorder_qty INT NOT NULL DEFAULT 24,
    trigger_event_id UUID REFERENCES scan_events(event_id),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED'))
);

-- Index for querying signals by item and status
CREATE INDEX idx_replenishment_signals_item_status ON replenishment_signals (item_id, status);

-- Index for efficient latest-state queries (window function optimization)
CREATE INDEX idx_replenishment_signals_signal_id_ts ON replenishment_signals (signal_id, created_ts DESC);

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

-- View for current state of each replenishment signal (for convenience)
CREATE VIEW replenishment_signals_current AS
WITH latest AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY signal_id ORDER BY created_ts DESC) as rn
    FROM replenishment_signals
)
SELECT signal_id, created_ts, item_id, triggered_at_qty, reorder_point,
       reorder_qty, trigger_event_id, status
FROM latest WHERE rn = 1;
"""

    settings = get_settings()
    console.print(Panel.fit(
        f"[bold]Database:[/bold] {settings.lakebase.database}\n"
        f"[bold]Host:[/bold] {settings.lakebase.host}",
        title="Lakebase Connection",
    ))

    if dry_run:
        console.print("\n[yellow]Dry run mode - SQL that would be executed:[/yellow]\n")
        console.print(init_sql)
        return

    console.print("\n[blue]Initializing database tables...[/blue]")

    try:
        conn = get_local_connection()
        cur = conn.cursor()
        # Execute each statement separately
        for statement in init_sql.split(';'):
            statement = statement.strip()
            if statement:
                cur.execute(statement)
        conn.commit()
        cur.close()
        conn.close()

        console.print("[green]✓ Database tables initialized successfully![/green]")
    except Exception as e:
        console.print(f"[red]✗ Error initializing database: {e}[/red]")
        raise typer.Exit(1)


@app.command()
def clear_db(
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation prompt"),
):
    """Clear all data from Lakebase tables (truncate)."""

    settings = get_settings()
    console.print(Panel.fit(
        f"[bold]Database:[/bold] {settings.lakebase.database}\n"
        f"[bold]Host:[/bold] {settings.lakebase.host}",
        title="Lakebase Connection",
    ))

    if not force:
        confirm = typer.confirm(
            "\n⚠️  This will DELETE ALL DATA from scan_events and "
            "replenishment_signals. Continue?"
        )
        if not confirm:
            console.print("[yellow]Aborted.[/yellow]")
            raise typer.Exit(0)

    console.print("\n[blue]Clearing database tables...[/blue]")

    try:
        conn = get_local_connection()
        cur = conn.cursor()
        # Delete in order to respect foreign key constraints
        cur.execute("DELETE FROM replenishment_signals")
        cur.execute("DELETE FROM scan_events")
        conn.commit()
        cur.close()
        conn.close()

        console.print("[green]✓ All data cleared successfully![/green]")
    except Exception as e:
        console.print(f"[red]✗ Error clearing database: {e}[/red]")
        raise typer.Exit(1)


@app.command()
def migrate():
    """Apply database migrations (add missing columns, convert to append-only)."""

    settings = get_settings()
    console.print(Panel.fit(
        f"[bold]Database:[/bold] {settings.lakebase.database}\n"
        f"[bold]Host:[/bold] {settings.lakebase.host}",
        title="Lakebase Connection",
    ))

    console.print("\n[blue]Checking for pending migrations...[/blue]")

    try:
        conn = get_local_connection()
        cur = conn.cursor()

        migrations_applied = []

        # Migration 1: Add user_email column to scan_events
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'scan_events' AND column_name = 'user_email'
        """)
        if cur.fetchone() is None:
            console.print("[yellow]  Adding user_email column to scan_events...[/yellow]")
            cur.execute("ALTER TABLE scan_events ADD COLUMN user_email TEXT")
            migrations_applied.append("user_email column")

        # Migration 2: Convert replenishment_signals to append-only schema
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'replenishment_signals' AND column_name = 'triggered_at_qty'
        """)
        if cur.fetchone() is None:
            console.print("[yellow]  Converting replenishment_signals to append-only schema...[/yellow]")

            # Step 1: Add new columns
            console.print("    - Adding id column...")
            cur.execute("""
                ALTER TABLE replenishment_signals
                ADD COLUMN id SERIAL
            """)

            console.print("    - Renaming current_qty to triggered_at_qty...")
            cur.execute("""
                ALTER TABLE replenishment_signals
                RENAME COLUMN current_qty TO triggered_at_qty
            """)

            # Step 2: Drop old unique constraint and primary key
            console.print("    - Dropping old constraints...")
            cur.execute("""
                DROP INDEX IF EXISTS idx_replenishment_signals_item_open
            """)
            cur.execute("""
                ALTER TABLE replenishment_signals
                DROP CONSTRAINT IF EXISTS replenishment_signals_pkey
            """)

            # Step 3: Set id as new primary key
            console.print("    - Setting id as primary key...")
            cur.execute("""
                ALTER TABLE replenishment_signals
                ADD PRIMARY KEY (id)
            """)

            # Step 4: Add new index for window function optimization
            console.print("    - Adding signal_id timestamp index...")
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_replenishment_signals_signal_id_ts
                ON replenishment_signals (signal_id, created_ts DESC)
            """)

            # Step 5: Create current state view
            console.print("    - Creating replenishment_signals_current view...")
            cur.execute("""
                CREATE OR REPLACE VIEW replenishment_signals_current AS
                WITH latest AS (
                    SELECT *,
                           ROW_NUMBER() OVER (PARTITION BY signal_id ORDER BY created_ts DESC) as rn
                    FROM replenishment_signals
                )
                SELECT signal_id, created_ts, item_id, triggered_at_qty, reorder_point,
                       reorder_qty, trigger_event_id, status
                FROM latest WHERE rn = 1
            """)

            migrations_applied.append("append-only schema")

        conn.commit()
        cur.close()
        conn.close()

        if migrations_applied:
            console.print(f"[green]✓ Migrations applied: {', '.join(migrations_applied)}[/green]")
        else:
            console.print("[green]✓ No migrations needed - database is up to date[/green]")

    except Exception as e:
        console.print(f"[red]✗ Error running migration: {e}[/red]")
        raise typer.Exit(1)


@app.command()
def grant_app_access(
    app_name: str = typer.Argument(
        "inventory-demo-dev",
        help="Name of the Databricks App to grant access to"
    ),
):
    """Grant table access to a Databricks App's service principal.

    After deploying to Databricks Apps, the app runs as its own service
    principal which needs permissions on the tables.
    """
    import subprocess
    import json

    settings = get_settings()
    console.print(Panel.fit(
        f"[bold]Database:[/bold] {settings.lakebase.database}\n"
        f"[bold]Host:[/bold] {settings.lakebase.host}",
        title="Lakebase Connection",
    ))

    console.print(f"\n[blue]Getting service principal for app: {app_name}...[/blue]")

    # Get the app's service principal ID
    try:
        result = subprocess.run(
            ["databricks", "apps", "get", app_name, "--output", "json"],
            capture_output=True,
            text=True,
            check=True,
        )
        app_info = json.loads(result.stdout)
        sp_id = app_info.get("service_principal_client_id")

        if not sp_id:
            console.print("[red]✗ Could not find service principal ID for app[/red]")
            raise typer.Exit(1)

        console.print(f"  Service Principal: [cyan]{sp_id}[/cyan]")

    except subprocess.CalledProcessError as e:
        console.print(f"[red]✗ Error getting app info: {e.stderr}[/red]")
        raise typer.Exit(1)
    except json.JSONDecodeError:
        console.print("[red]✗ Error parsing app info[/red]")
        raise typer.Exit(1)

    console.print("\n[blue]Granting table permissions...[/blue]")

    try:
        conn = get_local_connection()
        cur = conn.cursor()

        cur.execute(f'GRANT ALL ON scan_events TO "{sp_id}"')
        cur.execute(f'GRANT ALL ON replenishment_signals TO "{sp_id}"')
        conn.commit()
        cur.close()
        conn.close()

        console.print("[green]✓ Permissions granted successfully![/green]")
        console.print(f"\n  The app [cyan]{app_name}[/cyan] now has access to:")
        console.print("    • scan_events")
        console.print("    • replenishment_signals")

    except Exception as e:
        console.print(f"[red]✗ Error granting permissions: {e}[/red]")
        raise typer.Exit(1)


@app.command()
def status():
    """Check database connection and show table counts."""

    settings = get_settings()
    console.print(Panel.fit(
        f"[bold]Database:[/bold] {settings.lakebase.database}\n"
        f"[bold]Host:[/bold] {settings.lakebase.host}\n"
        f"[bold]User:[/bold] {settings.lakebase.user}\n"
        f"[bold]OAuth:[/bold] {'Enabled' if settings.lakebase.use_oauth else 'Disabled'}",
        title="Lakebase Connection",
    ))

    console.print("\n[blue]Checking database connection...[/blue]")

    try:
        conn = get_local_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        console.print("[green]✓ Database connected[/green]\n")

        # Get table counts
        cur.execute("SELECT COUNT(*) FROM scan_events")
        events_count = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM replenishment_signals")
        signals_count = cur.fetchone()[0]

        # Count open signals using window function (latest state per signal_id)
        cur.execute("""
            WITH latest AS (
                SELECT signal_id, status,
                       ROW_NUMBER() OVER (PARTITION BY signal_id ORDER BY created_ts DESC) as rn
                FROM replenishment_signals
            )
            SELECT COUNT(*) FROM latest WHERE rn = 1 AND status = 'OPEN'
        """)
        open_signals = cur.fetchone()[0]

        # Count unique signals
        cur.execute("SELECT COUNT(DISTINCT signal_id) FROM replenishment_signals")
        unique_signals = cur.fetchone()[0]

        cur.close()
        conn.close()

        console.print("[bold]Table Statistics:[/bold]")
        console.print(f"  scan_events: {events_count} rows")
        console.print(
            f"  replenishment_signals: {signals_count} rows "
            f"({unique_signals} unique signals, {open_signals} currently open)"
        )

    except Exception as e:
        console.print(f"[red]✗ Error: {e}[/red]")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
