# API Reference

Complete reference for the LineSync Inventory API.

**Base URL**: `http://localhost:8000` (local) or `https://<app-name>.cloud.databricks.com` (deployed)

## Authentication

### Local Development
No authentication required. User identity comes from `USER_EMAIL` environment variable.

### Databricks Apps
User identity is automatically extracted from `X-Forwarded-Email` header (set by Databricks).

---

## Health & Status

### GET /api/health

Health check endpoint with database connectivity status.

**Response**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": "connected"
}
```

| Field | Description |
|-------|-------------|
| `status` | Always `"ok"` if the API is responding |
| `version` | Application version |
| `database` | `"connected"` or `"disconnected"` |

---

### GET /api/me

Get current user information.

**Response**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "display_name": "John D.",
  "is_authenticated": true
}
```

| Field | Description |
|-------|-------------|
| `email` | User email address |
| `name` | Full name (if available) |
| `display_name` | Display name for UI |
| `is_authenticated` | Whether user is authenticated |

---

## Scan Events

### POST /api/events/intake

Create an INTAKE scan event (receiving inventory).

**Request Body**
```json
{
  "station_id": "INTAKE_CAM_1",
  "barcode_raw": "ITEM=PART-88219;QTY=24"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `station_id` | string | Yes | Camera/station identifier |
| `barcode_raw` | string | Yes | Raw barcode string |

**Response** (200 OK)
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_ts": "2024-01-15T10:30:00Z",
  "event_type": "INTAKE",
  "station_id": "INTAKE_CAM_1",
  "item_id": "PART-88219",
  "qty": 24,
  "on_hand_qty": 48,
  "triggered_signal": null
}
```

**Error Responses**

| Status | Description |
|--------|-------------|
| 400 | Invalid barcode format |
| 429 | Duplicate scan (same barcode within debounce window) |

---

### POST /api/events/consume

Create a CONSUME scan event (using inventory) and check for replenishment.

**Request Body**
```json
{
  "station_id": "LINE_1_CAM",
  "barcode_raw": "ITEM=PART-88219;QTY=24"
}
```

**Response** (200 OK)
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440001",
  "event_ts": "2024-01-15T11:00:00Z",
  "event_type": "CONSUME",
  "station_id": "LINE_1_CAM",
  "item_id": "PART-88219",
  "qty": 24,
  "on_hand_qty": 8,
  "triggered_signal": {
    "signal_id": "660e8400-e29b-41d4-a716-446655440000",
    "item_id": "PART-88219",
    "current_qty": 8,
    "reorder_qty": 24
  }
}
```

**Notes**:
- `triggered_signal` is included if inventory dropped below reorder point (default: 10)
- A signal is only created if there isn't already an open signal for the item

---

### POST /api/events/bulk-intake

Create multiple INTAKE events at once (from packing slip).

**Request Body**
```json
{
  "station_id": "PACKING_SLIP",
  "items": [
    {"item_id": "PART-88219", "qty": 24},
    {"item_id": "PART-12345", "qty": 48}
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `station_id` | string | No | Defaults to `"PACKING_SLIP"` |
| `items` | array | Yes | List of items to intake |
| `items[].item_id` | string | Yes | Part number |
| `items[].qty` | integer | Yes | Quantity (must be >= 1) |

**Response** (200 OK)
```json
{
  "events": [
    {
      "event_id": "...",
      "event_ts": "2024-01-15T10:30:00Z",
      "event_type": "INTAKE",
      "station_id": "PACKING_SLIP",
      "item_id": "PART-88219",
      "qty": 24,
      "on_hand_qty": 48,
      "triggered_signal": null
    }
  ],
  "total_items": 2,
  "total_qty": 72
}
```

---

### GET /api/events/recent

Get recent scan events for activity feed.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Maximum events to return |

**Response**
```json
{
  "events": [
    {
      "event_id": "...",
      "event_ts": "2024-01-15T11:00:00Z",
      "event_type": "CONSUME",
      "station_id": "LINE_1_CAM",
      "item_id": "PART-88219",
      "qty": 24,
      "on_hand_qty": 8,
      "triggered_signal": null
    }
  ],
  "limit": 20
}
```

---

## Inventory

### GET /api/inventory

Get current inventory levels for all items.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 100 | Maximum items to return |

**Response**
```json
{
  "items": [
    {
      "item_id": "PART-88219",
      "on_hand_qty": 8,
      "intake_total": 96,
      "consume_total": 88,
      "last_activity_ts": "2024-01-15T11:00:00Z",
      "below_reorder_point": true
    }
  ],
  "total_items": 15
}
```

| Field | Description |
|-------|-------------|
| `on_hand_qty` | Current inventory (intake - consume) |
| `intake_total` | Total quantity received |
| `consume_total` | Total quantity consumed |
| `below_reorder_point` | True if `on_hand_qty <= 10` |

---

### GET /api/inventory/{item_id}

Get current inventory for a specific item.

**Path Parameters**

| Parameter | Description |
|-----------|-------------|
| `item_id` | Part number to look up |

**Response** (200 OK)
```json
{
  "item_id": "PART-88219",
  "on_hand_qty": 8,
  "intake_total": 96,
  "consume_total": 88,
  "last_activity_ts": "2024-01-15T11:00:00Z",
  "below_reorder_point": true
}
```

**Error Response** (404 Not Found)
```json
{
  "detail": "Item not found: PART-99999"
}
```

---

## Replenishment Signals

### GET /api/signals

List replenishment signals with LIVE inventory values.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | null | Filter by status: `OPEN`, `ACKNOWLEDGED`, `FULFILLED` |
| `limit` | integer | 50 | Maximum signals to return |

**Response**
```json
{
  "signals": [
    {
      "signal_id": "660e8400-e29b-41d4-a716-446655440000",
      "created_ts": "2024-01-15T11:00:00Z",
      "item_id": "PART-88219",
      "current_qty": 8,
      "reorder_point": 10,
      "reorder_qty": 24,
      "status": "OPEN"
    }
  ],
  "total_open": 3
}
```

**Important**: `current_qty` is the LIVE inventory value (computed from scan_events), not the historical snapshot from when the signal was created.

---

### POST /api/signals/{signal_id}/acknowledge

Acknowledge a replenishment signal.

**Path Parameters**

| Parameter | Description |
|-----------|-------------|
| `signal_id` | UUID of the signal to acknowledge |

**Response** (200 OK)
```json
{
  "signal_id": "660e8400-e29b-41d4-a716-446655440000",
  "created_ts": "2024-01-15T11:05:00Z",
  "item_id": "PART-88219",
  "current_qty": 8,
  "reorder_point": 10,
  "reorder_qty": 24,
  "status": "ACKNOWLEDGED"
}
```

**Notes**:
- This creates a new row with `ACKNOWLEDGED` status (append-only pattern)
- The `created_ts` reflects when the acknowledgment was recorded

**Error Response** (404 Not Found)
```json
{
  "detail": "Signal not found: 660e8400-..."
}
```

---

## Packing Slip Parsing

### POST /api/parse-packing-slip

Parse a packing slip image using GPT-5 vision.

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | Image file (JPEG, PNG, WebP, GIF) |

**Supported Formats**:
- JPEG / JPG
- PNG
- WebP
- GIF

**Size Limit**: 20MB

**Response** (200 OK)
```json
{
  "items": [
    {
      "item_id": "PART-88219",
      "qty": 24,
      "description": "Widget Assembly",
      "confidence": "high"
    },
    {
      "item_id": "PART-12345",
      "qty": 48,
      "description": "Fastener Kit",
      "confidence": "medium"
    }
  ],
  "vendor": "Acme Supplies Inc.",
  "po_number": "PO-2024-001234",
  "ship_date": "2024-01-14",
  "notes": "Partial shipment. Remaining items on backorder."
}
```

| Field | Description |
|-------|-------------|
| `items` | Extracted line items |
| `items[].confidence` | `"high"`, `"medium"`, or `"low"` |
| `vendor` | Detected vendor name (if found) |
| `po_number` | Purchase order number (if found) |
| `ship_date` | Ship date (if found) |
| `notes` | Any additional notes from the document |

**Error Responses**

| Status | Description |
|--------|-------------|
| 400 | Invalid file type or file too large |
| 500 | AI parsing failed |

**Usage Example (curl)**
```bash
curl -X POST \
  -F "file=@packing-slip.jpg" \
  http://localhost:8000/api/parse-packing-slip
```

**Usage Example (JavaScript)**
```javascript
const formData = new FormData();
formData.append('file', imageFile);

const response = await fetch('/api/parse-packing-slip', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

---

## Barcode Format

All endpoints that accept barcodes expect this format:

```
ITEM=<item_id>;QTY=<quantity>
```

**Examples**:
- `ITEM=PART-88219;QTY=24`
- `ITEM=12345;QTY=1`
- `ITEM=WIDGET-A;QTY=100`

**Parsing Rules**:
1. Split on `;`
2. Extract key-value pairs split on `=`
3. `ITEM` becomes `item_id`
4. `QTY` becomes `qty` (must be positive integer)

---

## Error Response Format

All error responses follow this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

**Common HTTP Status Codes**

| Status | Description |
|--------|-------------|
| 400 | Bad Request - Invalid input data |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Duplicate scan detected |
| 500 | Internal Server Error - Server-side failure |

---

## OpenAPI Schema

The API provides an auto-generated OpenAPI schema at:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
- **OpenAPI JSON**: `http://localhost:8000/openapi.json`
