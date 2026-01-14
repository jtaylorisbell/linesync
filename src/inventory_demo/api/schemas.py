"""Pydantic request/response schemas for Inventory Demo API."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from inventory_demo.core.models import EventType, SignalStatus


# Request models


class ScanRequest(BaseModel):
    """Request body for intake/consume scan endpoints."""

    station_id: str = Field(..., description="Camera/station identifier")
    barcode_raw: str = Field(..., description="Raw barcode string")


# Response models


class ScanEventResponse(BaseModel):
    """Response for a scan event."""

    event_id: UUID
    event_ts: datetime
    event_type: EventType
    station_id: str
    item_id: str
    qty: int
    on_hand_qty: int = Field(description="Current inventory after this event")

    model_config = {"from_attributes": True}


class InventoryItemResponse(BaseModel):
    """Response for an inventory item."""

    item_id: str
    on_hand_qty: int
    intake_total: int
    consume_total: int
    last_activity_ts: datetime | None
    below_reorder_point: bool


class InventoryListResponse(BaseModel):
    """Response for inventory list."""

    items: list[InventoryItemResponse]
    total_items: int


class ReplenishmentSignalResponse(BaseModel):
    """Response for a replenishment signal."""

    signal_id: UUID
    created_ts: datetime
    item_id: str
    current_qty: int
    reorder_point: int
    reorder_qty: int
    status: SignalStatus

    model_config = {"from_attributes": True}


class SignalListResponse(BaseModel):
    """Response for signal list."""

    signals: list[ReplenishmentSignalResponse]
    total_open: int


class RecentActivityResponse(BaseModel):
    """Response for recent scan events."""

    events: list[ScanEventResponse]
    limit: int


class HealthResponse(BaseModel):
    """Response for health check."""

    status: str
    version: str
    database: str


class CurrentUserResponse(BaseModel):
    """Response for current user info."""

    email: str | None
    name: str | None
    display_name: str
    is_authenticated: bool
