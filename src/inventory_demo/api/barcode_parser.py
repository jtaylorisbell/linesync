"""Barcode parsing for Inventory Demo."""

import re
from dataclasses import dataclass


class BarcodeParseError(ValueError):
    """Raised when barcode cannot be parsed."""

    pass


@dataclass
class ParsedBarcode:
    """Parsed barcode data."""

    item_id: str
    qty: int


def parse_barcode(barcode_raw: str) -> ParsedBarcode:
    """Parse barcode in format: ITEM=<item_id>;QTY=<qty>

    Args:
        barcode_raw: Raw barcode string to parse

    Returns:
        ParsedBarcode with extracted item_id and qty

    Raises:
        BarcodeParseError: If barcode format is invalid

    Examples:
        >>> parse_barcode("ITEM=PART-88219;QTY=24")
        ParsedBarcode(item_id='PART-88219', qty=24)
    """
    pattern = r"^ITEM=([^;]+);QTY=(\d+)$"
    match = re.match(pattern, barcode_raw.strip())

    if not match:
        raise BarcodeParseError(
            f"Invalid barcode format: '{barcode_raw}'. "
            "Expected format: ITEM=<item_id>;QTY=<quantity>"
        )

    item_id = match.group(1)
    qty = int(match.group(2))

    if qty <= 0:
        raise BarcodeParseError(f"Quantity must be positive, got: {qty}")

    return ParsedBarcode(item_id=item_id, qty=qty)
