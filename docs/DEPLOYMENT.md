# Deployment Guide

This guide covers deploying LineSync to Databricks Apps and setting up the complete data pipeline.

## Prerequisites

- Databricks CLI installed and configured
- Access to a Databricks workspace with:
  - Lakebase Autoscaling enabled
  - Databricks Apps enabled
  - Unity Catalog configured
  - Foundation Model APIs enabled (for packing slip parsing)
- Node.js 18+ and npm (for frontend build)
- Python 3.11+ and uv (for local development)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Databricks Workspace                        │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐│
│  │  Databricks │     │  Lakebase   │     │   Delta Live Tables ││
│  │    Apps     │────▶│ (PostgreSQL)│────▶│ (Bronze/Silver/Gold)││
│  └─────────────┘     └─────────────┘     └─────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Provision Lakebase Autoscaling

The CLI automates creating the Lakebase project, branch, endpoint, and user role:

```bash
cp .env.example .env
```

Edit `.env` with your Databricks workspace host and user email:

```bash
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
USER_EMAIL=your.email@company.com
```

Then provision the infrastructure:

```bash
uv sync
uv run inventory-demo provision --write-env
```

This will:
1. Create a Lakebase project (`linesync`)
2. Create a branch (`main`) with no expiration
3. Create a read-write endpoint (`default`) with 0.5-2.0 CU autoscaling
4. Create an OAuth role for your user email
5. Write the discovered host and resource IDs back to `.env`

You can customize the resource names:

```bash
uv run inventory-demo provision \
  --project-id my-project \
  --branch-id dev \
  --endpoint-id primary \
  --write-env
```

## Step 2: Initialize Database Schema

```bash
# Initialize tables
uv run inventory-demo init-db

# Verify connection
uv run inventory-demo status
```

Expected output:
```
╭───────────────────────────────────────────────────╮
│              Lakebase Connection                    │
├───────────────────────────────────────────────────┤
│ Database: postgres                                 │
│ Host: ep-xxx.database.cloud.databricks.com         │
│ User: your.email@company.com                       │
│ Endpoint: projects/linesync/branches/main/...      │
╰───────────────────────────────────────────────────╯

Database connected

Table Statistics:
  scan_events: 0 rows
  replenishment_signals: 0 rows (0 unique signals, 0 currently open)
```

## Step 3: Configure Databricks Bundle

Edit `databricks.yml` with your workspace profile and variable values:

```yaml
variables:
  lakebase_project_id:
    default: linesync
  lakebase_branch_id:
    default: main
  lakebase_endpoint_id:
    default: default
  lakebase_database:
    default: postgres
  lakebase_catalog:
    default: your_lakebase_catalog  # Unity Catalog for Lakebase
  target_catalog:
    default: your_target_catalog    # For Delta tables

targets:
  dev:
    workspace:
      profile: your-workspace-profile  # From ~/.databrickscfg
```

## Step 4: Deploy to Databricks Apps

> **Note:** The frontend is built automatically by Databricks Apps during deployment -- no manual build step is needed.

```bash
# Validate the bundle
databricks bundle validate -t dev

# Deploy
databricks bundle deploy -t dev
```

The first deployment will:
1. Upload all source code to the workspace
2. Create the Databricks App
3. Create the DLT pipeline

## Step 5: Grant Permissions to App Service Principal

After the first deployment, the app runs as its own service principal which needs table access.

### Option A: Using CLI Helper

```bash
# Get app name from deployment output, then:
uv run inventory-demo grant-app-access inventory-demo-dev
```

This creates a Lakebase role for the service principal and grants SQL-level table permissions.

### Option B: Manual SQL

1. Get the service principal ID:
```bash
databricks apps get inventory-demo-dev --output json | jq -r '.service_principal_client_id'
```

2. Run SQL in Lakebase Query Editor:
```sql
GRANT ALL ON scan_events TO "<service_principal_id>";
GRANT ALL ON replenishment_signals TO "<service_principal_id>";
```

## Step 6: Access the App

Get the app URL:

```bash
databricks apps get inventory-demo-dev | grep url
```

Or find it in the Databricks UI under **Compute** > **Apps**.

## Step 7: Configure DLT Pipeline (Optional)

The DLT pipeline syncs Lakebase data to Delta tables for analytics.

### Register Lakebase as Foreign Catalog

Before the pipeline can read from Lakebase, register it in Unity Catalog:

1. Go to **Catalog** > **External Data** > **Foreign Connections**
2. Create a new PostgreSQL connection to your Lakebase instance
3. Register the Lakebase tables as a foreign catalog

### Run the Pipeline

```bash
# Get the pipeline ID from bundle output, then:
databricks pipelines start-update <pipeline-id>
```

Or use the UI: **Workflows** > **Delta Live Tables** > **inventory-lakebase-to-delta-dev** > **Start**

## Deployment Checklist

- [ ] Lakebase provisioned (`provision --write-env`)
- [ ] Database schema initialized (`init-db`)
- [ ] Bundle deployed (`bundle deploy`)
- [ ] Service principal permissions granted (`grant-app-access`)
- [ ] App accessible via URL
- [ ] (Optional) DLT pipeline configured and running

## Updating the Deployment

After making changes:

```bash
databricks bundle deploy -t dev
```

The app will automatically restart with the new code.

## Troubleshooting

### "Database connection failed"

1. Verify Lakebase is provisioned: `uv run inventory-demo status`
2. Check `.env` has the correct host and resource IDs
3. Ensure your user has an OAuth role on the branch

### "Permission denied on tables"

1. Verify the app service principal has been granted access
2. Re-run: `uv run inventory-demo grant-app-access <app-name>`

### "DLT pipeline fails with catalog error"

1. Ensure Lakebase is registered as a foreign catalog in Unity Catalog
2. Verify the `lakebase_catalog` variable matches the catalog name
3. Check that the tables `scan_events` and `replenishment_signals` exist

### "Packing slip parsing fails"

1. Verify `DATABRICKS_HOST` is set correctly
2. Ensure Foundation Model APIs are enabled in your workspace
3. Check the model endpoint is accessible

### App shows "503 Service Unavailable"

1. The app may still be starting - wait 30-60 seconds
2. Check app logs in the Databricks UI
3. Verify all environment variables are correctly set

## Environment Variables Reference

### Set in app.yaml (Databricks Apps)

| Variable | Default | Description |
|----------|---------|-------------|
| `LAKEBASE_PROJECT_ID` | `linesync` | Lakebase project identifier |
| `LAKEBASE_BRANCH_ID` | `main` | Branch within the project |
| `LAKEBASE_ENDPOINT_ID` | `default` | Compute endpoint within the branch |
| `LAKEBASE_DATABASE` | `postgres` | Database name |

### Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `INVENTORY_REORDER_POINT` | `10` | Threshold for replenishment signals |
| `INVENTORY_REORDER_QTY` | `24` | Suggested reorder quantity |

## Production Considerations

For production deployments, consider:

1. **Use `prod` target**: `databricks bundle deploy -t prod`
2. **Set up monitoring**: Configure alerts for app errors
3. **Schedule DLT refreshes**: Set the pipeline to run on a schedule
4. **Backup strategy**: Configure Lakebase backups
5. **Access controls**: Set up proper RBAC for the app and data
