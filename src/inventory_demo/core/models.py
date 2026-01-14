"""Domain models for Inventory Demo."""

from enum import Enum


class EventType(str, Enum):
    """Type of scan event."""

    INTAKE = "INTAKE"
    CONSUME = "CONSUME"


class SignalStatus(str, Enum):
    """Status of a replenishment signal."""

    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    FULFILLED = "FULFILLED"
