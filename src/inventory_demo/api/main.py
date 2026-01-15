"""FastAPI application for Inventory Demo."""

from pathlib import Path
from uuid import UUID

import structlog
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from inventory_demo import __version__
from inventory_demo.api.barcode_parser import BarcodeParseError
from inventory_demo.api.schemas import (
    BulkIntakeRequest,
    BulkIntakeResponse,
    CurrentUserResponse,
    HealthResponse,
    InventoryItemResponse,
    InventoryListResponse,
    PackingSlipParseResponse,
    ParsedLineItemResponse,
    RecentActivityResponse,
    ReplenishmentSignalResponse,
    ScanEventResponse,
    ScanRequest,
    SignalListResponse,
)
from inventory_demo.api.user import CurrentUser, get_current_user
from inventory_demo.config import get_settings
from inventory_demo.core.inventory_service import DuplicateScanError, get_service
from inventory_demo.core.models import EventType, SignalStatus
from inventory_demo.db.postgres import get_db

logger = structlog.get_logger()

app = FastAPI(
    title="Inventory Demo API",
    description="Barcode-based inventory intake & consumption demo",
    version=__version__,
)

# CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check endpoint with database connectivity status."""
    db = get_db()
    db_status = "connected" if db.health_check() else "disconnected"
    return HealthResponse(
        status="ok",
        version=__version__,
        database=db_status,
    )


@app.get("/api/me", response_model=CurrentUserResponse)
async def get_me(request: Request) -> CurrentUserResponse:
    """Get current user information.

    In Databricks Apps, user is extracted from X-Forwarded-* headers.
    In development, falls back to USER_EMAIL environment variable.
    """
    user = get_current_user(request)
    return CurrentUserResponse(
        email=user.email,
        name=user.name,
        display_name=user.display_name,
        is_authenticated=user.is_authenticated,
    )


@app.post("/api/events/intake", response_model=ScanEventResponse)
async def create_intake_event(
    request: ScanRequest, http_request: Request
) -> ScanEventResponse:
    """Create an INTAKE scan event.

    Parses the barcode, validates format, and creates the event.
    User is automatically extracted from headers (prod) or env (dev).
    """
    user = get_current_user(http_request)
    service = get_service()
    try:
        event, on_hand_qty = service.create_intake_event(
            station_id=request.station_id,
            barcode_raw=request.barcode_raw,
            user_email=user.email,
        )
    except BarcodeParseError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DuplicateScanError as e:
        raise HTTPException(status_code=429, detail=str(e))

    return ScanEventResponse(
        event_id=event.event_id,
        event_ts=event.event_ts,
        event_type=EventType(event.event_type),
        station_id=event.station_id,
        item_id=event.item_id,
        qty=event.qty,
        on_hand_qty=on_hand_qty,
    )


@app.post("/api/events/consume", response_model=ScanEventResponse)
async def create_consume_event(
    request: ScanRequest, http_request: Request
) -> ScanEventResponse:
    """Create a CONSUME scan event and check for replenishment.

    Parses the barcode, validates format, creates the event,
    and triggers replenishment if inventory falls below threshold.
    User is automatically extracted from headers (prod) or env (dev).
    """
    user = get_current_user(http_request)
    service = get_service()
    try:
        event, on_hand_qty, signal = service.create_consume_event(
            station_id=request.station_id,
            barcode_raw=request.barcode_raw,
            user_email=user.email,
        )
    except BarcodeParseError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DuplicateScanError as e:
        raise HTTPException(status_code=429, detail=str(e))

    return ScanEventResponse(
        event_id=event.event_id,
        event_ts=event.event_ts,
        event_type=EventType(event.event_type),
        station_id=event.station_id,
        item_id=event.item_id,
        qty=event.qty,
        on_hand_qty=on_hand_qty,
    )


@app.get("/api/inventory", response_model=InventoryListResponse)
async def list_inventory(limit: int = 100) -> InventoryListResponse:
    """Get current inventory levels for all items."""
    db = get_db()
    settings = get_settings().inventory
    inventory = db.get_all_inventory(limit=limit)

    items = [
        InventoryItemResponse(
            item_id=item["item_id"],
            on_hand_qty=item["on_hand_qty"],
            intake_total=item["intake_total"],
            consume_total=item["consume_total"],
            last_activity_ts=item["last_activity_ts"],
            below_reorder_point=item["on_hand_qty"] <= settings.reorder_point,
        )
        for item in inventory
    ]

    return InventoryListResponse(
        items=items,
        total_items=len(items),
    )


@app.get("/api/inventory/{item_id}", response_model=InventoryItemResponse)
async def get_inventory_item(item_id: str) -> InventoryItemResponse:
    """Get current inventory for a specific item."""
    db = get_db()
    settings = get_settings().inventory
    item = db.get_inventory_item(item_id)

    if item is None:
        raise HTTPException(status_code=404, detail=f"Item not found: {item_id}")

    return InventoryItemResponse(
        item_id=item["item_id"],
        on_hand_qty=item["on_hand_qty"],
        intake_total=item["intake_total"],
        consume_total=item["consume_total"],
        last_activity_ts=item["last_activity_ts"],
        below_reorder_point=item["on_hand_qty"] <= settings.reorder_point,
    )


@app.get("/api/signals", response_model=SignalListResponse)
async def list_signals(status: str | None = None, limit: int = 50) -> SignalListResponse:
    """List replenishment signals, optionally filtered by status."""
    db = get_db()
    signals = db.get_signals(status=status, limit=limit)

    signal_responses = [
        ReplenishmentSignalResponse(
            signal_id=s.signal_id,
            created_ts=s.created_ts,
            item_id=s.item_id,
            current_qty=s.current_qty,
            reorder_point=s.reorder_point,
            reorder_qty=s.reorder_qty,
            status=SignalStatus(s.status),
        )
        for s in signals
    ]

    # Count open signals
    total_open = sum(1 for s in signal_responses if s.status == SignalStatus.OPEN)

    return SignalListResponse(
        signals=signal_responses,
        total_open=total_open,
    )


@app.post("/api/signals/{signal_id}/acknowledge", response_model=ReplenishmentSignalResponse)
async def acknowledge_signal(signal_id: UUID) -> ReplenishmentSignalResponse:
    """Acknowledge a replenishment signal."""
    db = get_db()
    signal = db.update_signal_status(signal_id, SignalStatus.ACKNOWLEDGED.value)

    if signal is None:
        raise HTTPException(status_code=404, detail=f"Signal not found: {signal_id}")

    return ReplenishmentSignalResponse(
        signal_id=signal.signal_id,
        created_ts=signal.created_ts,
        item_id=signal.item_id,
        current_qty=signal.current_qty,
        reorder_point=signal.reorder_point,
        reorder_qty=signal.reorder_qty,
        status=SignalStatus(signal.status),
    )


@app.get("/api/events/recent", response_model=RecentActivityResponse)
async def get_recent_events(limit: int = 20) -> RecentActivityResponse:
    """Get recent scan events for activity feed."""
    db = get_db()
    events = db.get_recent_events(limit=limit)

    event_responses = []
    for event in events:
        # Get current on-hand qty for each item
        on_hand_qty = db.get_on_hand_qty(event.item_id)
        event_responses.append(
            ScanEventResponse(
                event_id=event.event_id,
                event_ts=event.event_ts,
                event_type=EventType(event.event_type),
                station_id=event.station_id,
                item_id=event.item_id,
                qty=event.qty,
                on_hand_qty=on_hand_qty,
            )
        )

    return RecentActivityResponse(
        events=event_responses,
        limit=limit,
    )


@app.post("/api/parse-packing-slip", response_model=PackingSlipParseResponse)
async def parse_packing_slip(
    file: UploadFile = File(..., description="Packing slip image"),
) -> PackingSlipParseResponse:
    """Parse a packing slip image using Claude vision.

    Upload an image of a packing slip to extract line items.
    Supported formats: JPEG, PNG, WebP, GIF.
    """
    # Validate file type
    content_type = file.content_type or "image/jpeg"
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"File must be an image, got: {content_type}",
        )

    # Map content types to supported media types
    media_type_map = {
        "image/jpeg": "image/jpeg",
        "image/jpg": "image/jpeg",
        "image/png": "image/png",
        "image/webp": "image/webp",
        "image/gif": "image/gif",
    }
    media_type = media_type_map.get(content_type, "image/jpeg")

    # Read file content
    image_data = await file.read()
    if len(image_data) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(
            status_code=400,
            detail="Image too large. Maximum size is 20MB.",
        )

    # Parse using Databricks GPT-5 vision
    try:
        from inventory_demo.api.packing_slip_parser import get_parser

        parser = get_parser()
        result = parser.parse_image(image_data, media_type)

        return PackingSlipParseResponse(
            items=[
                ParsedLineItemResponse(
                    item_id=item.item_id,
                    qty=item.qty,
                    description=item.description,
                    confidence=item.confidence,
                )
                for item in result.items
            ],
            vendor=result.vendor,
            po_number=result.po_number,
            ship_date=result.ship_date,
            notes=result.notes,
        )
    except Exception as e:
        logger.error("packing_slip_parse_error", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to parse packing slip: {e}")


@app.post("/api/events/bulk-intake", response_model=BulkIntakeResponse)
async def create_bulk_intake(
    request: BulkIntakeRequest, http_request: Request
) -> BulkIntakeResponse:
    """Create multiple INTAKE events at once.

    Used for processing packing slips where multiple items are received together.
    Each item creates a separate scan event with a synthetic barcode.
    """
    user = get_current_user(http_request)
    service = get_service()

    events = []
    for item in request.items:
        # Create synthetic barcode for tracking
        barcode_raw = f"ITEM={item.item_id};QTY={item.qty}"

        try:
            event, on_hand_qty = service.create_intake_event(
                station_id=request.station_id,
                barcode_raw=barcode_raw,
                user_email=user.email,
            )
            events.append(
                ScanEventResponse(
                    event_id=event.event_id,
                    event_ts=event.event_ts,
                    event_type=EventType(event.event_type),
                    station_id=event.station_id,
                    item_id=event.item_id,
                    qty=event.qty,
                    on_hand_qty=on_hand_qty,
                )
            )
        except DuplicateScanError:
            # Skip duplicates in bulk operations
            logger.warning("duplicate_scan_in_bulk", item_id=item.item_id)
            continue

    total_qty = sum(e.qty for e in events)

    return BulkIntakeResponse(
        events=events,
        total_items=len(events),
        total_qty=total_qty,
    )


# Serve static files for frontend (when built)
frontend_dist = Path(__file__).parent.parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
