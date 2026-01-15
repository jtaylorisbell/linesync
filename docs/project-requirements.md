

# 📦 Barcode-Based Inventory Intake & Consumption Demo

**Product Requirements Document (PRD)**

## 1. Purpose

Build a **simple, end-to-end demo application** that simulates how a manufacturing plant tracks parts using **barcode scanning** for:

* Inbound intake
* Line-side consumption
* Inventory visibility
* Automatic replenishment signaling (Kanban-style)

This is a **demo-quality but realistic** system intended to visually and functionally demonstrate the process, not replicate full ERP/MES complexity.

---

## 2. Goals & Non-Goals

### Goals

* Demonstrate **hands-free barcode scanning via camera**
* Persist intake and consumption events to Postgres
* Compute real-time inventory from events
* Trigger a replenishment signal when inventory drops below a threshold
* Provide a clean, intuitive UI suitable for live demos

### Non-Goals

* No supplier ASN handling
* No user authentication or roles
* No hardware scanners (camera-only)
* No external ERP or WMS integrations
* No RFID, RTLS, or PLC integration
* No guaranteed exactly-once semantics (best-effort is fine)

---

## 3. Core Capabilities (MVP)

### 3.1 Intake (Inbound Scan)

**Description**
A user points a camera at a barcode representing a container of parts being received.

**Behavior**

* App automatically detects when a barcode is visible
* Barcode is decoded without user interaction
* Barcode contents are parsed into structured fields
* An `INTAKE` event is written to Postgres

**Barcode Format (Option B – required)**

```
ITEM=<item_id>;QTY=<integer>
```

**Example**

```
ITEM=PART-88219;QTY=24
```

**Result**

* Inventory for the item increases by `QTY`

---

### 3.2 Sink (Consumption Scan)

**Description**
A user scans a barcode when a container is consumed at the line.

**Behavior**

* Camera auto-detects and decodes barcode
* Barcode is parsed identically to Intake
* A `CONSUME` event is written to Postgres
* Inventory is decremented
* Replenishment logic is evaluated immediately

**Result**

* Inventory decreases by `QTY`
* If inventory drops below reorder threshold, a replenishment signal is created

---

### 3.3 Inventory View

**Description**
A read-only dashboard showing current inventory and basic operational metrics.

**Required Views**

* Current on-hand quantity by item
* Net inventory = sum(INTAKE) − sum(CONSUME)
* Recent scan activity
* Replenishment signals (if any)

**Optional Metrics (nice-to-have)**

* Usage rate (e.g., last 15 minutes)
* Time since last scan per item

---

## 4. User Interface Requirements

### Pages

1. **Intake**
2. **Inventory**
3. **Sink**

### Camera UX (Intake & Sink)

* Live camera preview
* Automatic detection (no “Scan” button)
* Visual indicator when barcode is detected
* Success feedback when event is saved
* Debounce logic to prevent duplicate scans

### Debounce Rules

* Same barcode should not be processed more than once within ~3 seconds
* Barcode must be stable/visible for a short window (≈300–500ms)

---

## 5. Backend Requirements

### API Endpoints

#### `POST /events/intake`

Creates an intake event.

#### `POST /events/consume`

Creates a consumption event and evaluates replenishment rules.

**Request Payload**

```json
{
  "station_id": "INTAKE_CAM_1",
  "barcode_raw": "ITEM=PART-88219;QTY=24"
}
```

**Backend Responsibilities**

* Parse `barcode_raw`
* Validate required fields
* Normalize into structured fields
* Persist event to Postgres
* Trigger replenishment logic for CONSUME events

---

## 6. Data Model (Minimal)

### `scan_events`

| Column      | Type        | Notes                     |
| ----------- | ----------- | ------------------------- |
| event_id    | UUID (PK)   | Generated                 |
| event_ts    | TIMESTAMPTZ | Default now()             |
| event_type  | TEXT        | `INTAKE` or `CONSUME`     |
| station_id  | TEXT        | Camera/station identifier |
| barcode_raw | TEXT        | Full decoded string       |
| item_id     | TEXT        | Parsed from barcode       |
| qty         | INT         | Parsed from barcode       |

---

### `inventory_current` (view or derived query)

Computed dynamically from `scan_events`:

```
on_hand_qty =
  SUM(qty WHERE event_type = 'INTAKE')
- SUM(qty WHERE event_type = 'CONSUME')
```

---

### `replenishment_signals` (simple table)

| Column           | Type        | Notes             |
| ---------------- | ----------- | ----------------- |
| signal_id        | UUID (PK)   | Generated         |
| created_ts       | TIMESTAMPTZ |                   |
| item_id          | TEXT        |                   |
| current_qty      | INT         | After consumption |
| reorder_point    | INT         | Configured value  |
| reorder_qty      | INT         | Suggested qty     |
| trigger_event_id | UUID        | FK → scan_events  |

---

## 7. Replenishment Logic (Simple by Design)

Replenishment is triggered **only** on `CONSUME` events.

### Rule

If:

```
on_hand_qty <= reorder_point
```

Then:

* Create a replenishment signal (if one does not already exist for that item)

### Defaults (hardcoded acceptable for MVP)

* `reorder_point = 10`
* `reorder_qty = 24`

(No optimization, batching, or lead-time modeling required.)

---

## 8. Technical Constraints

* Camera access must work in a modern browser
* Barcode detection should:

  * Prefer native browser APIs if available
  * Fall back to a JS/WASM library if not
* System should be deployable as a **single app**
* Postgres is the system of record
* Stateless backend preferred

---

## 9. Success Criteria

The demo is successful if:

1. A barcode printed on paper can be scanned via webcam
2. Intake scans increase inventory
3. Consumption scans decrease inventory
4. Inventory view updates correctly
5. Replenishment signal appears automatically when threshold is crossed
6. Entire flow can be demoed live in under 3 minutes

---

## 10. Future Extensions (Out of Scope)

* Container-level tracking
* Lot / batch traceability
* RFID / RTLS integration
* Multi-line or multi-plant support
* ERP / MES integration
* Predictive analytics or AI

---

If you want, next I can:

* Generate **`schema.sql`**
* Generate **OpenAPI spec**
* Create a **repo layout for Databricks Apps**
* Or write a **“README.md for demo operators”**

Just tell me what artifact your coding agent needs next.
