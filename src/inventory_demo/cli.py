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
    """Apply database migrations (add missing columns)."""

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

        # Check if user_email column exists
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'scan_events' AND column_name = 'user_email'
        """)
        has_user_email = cur.fetchone() is not None

        if has_user_email:
            console.print(
                "[green]✓ No migrations needed - database is up to date[/green]"
            )
            cur.close()
            conn.close()
            return

        console.print("[yellow]  Adding user_email column to scan_events...[/yellow]")
        cur.execute("ALTER TABLE scan_events ADD COLUMN user_email TEXT")
        conn.commit()
        cur.close()
        conn.close()

        console.print("[green]✓ Migration completed successfully![/green]")

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

        cur.execute(
            "SELECT COUNT(*) FROM replenishment_signals WHERE status = 'OPEN'"
        )
        open_signals = cur.fetchone()[0]

        cur.close()
        conn.close()

        console.print("[bold]Table Statistics:[/bold]")
        console.print(f"  scan_events: {events_count} rows")
        console.print(
            f"  replenishment_signals: {signals_count} rows ({open_signals} open)"
        )

    except Exception as e:
        console.print(f"[red]✗ Error: {e}[/red]")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
