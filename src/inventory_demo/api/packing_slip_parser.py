"""Packing slip parser using Databricks GPT-5 vision API."""

import base64
import json
from typing import Literal

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class ParsedLineItem(BaseModel):
    """A single line item extracted from a packing slip."""

    item_id: str = Field(description="Part number or item identifier")
    qty: int = Field(description="Quantity", ge=1)
    description: str | None = Field(default=None, description="Item description if available")
    confidence: Literal["high", "medium", "low"] = Field(
        default="medium",
        description="Confidence level in the extraction",
    )


class PackingSlipParseResult(BaseModel):
    """Result of parsing a packing slip image."""

    items: list[ParsedLineItem] = Field(default_factory=list)
    vendor: str | None = Field(default=None, description="Vendor/supplier name if detected")
    po_number: str | None = Field(default=None, description="Purchase order number if detected")
    ship_date: str | None = Field(default=None, description="Ship date if detected")
    notes: str | None = Field(default=None, description="Any additional notes or warnings")


SYSTEM_PROMPT = """\
You are an expert at extracting structured data from packing slips, invoices, and shipping documents.

Your task is to extract line items (parts/products) from the provided image. For each item, identify:
1. item_id: The part number, SKU, or item identifier (prioritize alphanumeric codes like "PART-12345", "SKU-ABC123")
2. qty: The quantity being shipped/received
3. description: A brief description of the item if visible
4. confidence: Your confidence in the extraction ("high", "medium", "low")

Also extract metadata if visible:
- vendor: The supplier/vendor name
- po_number: Purchase order number
- ship_date: Shipping or delivery date

Guidelines:
- If an item ID is unclear, make your best guess and mark confidence as "low"
- Quantities should always be positive integers
- If you can't determine the quantity, default to 1 and mark confidence as "low"
- Ignore header rows, totals, and non-item rows
- If the image is not a packing slip or is unreadable, return empty items with a note explaining why

Return your response as valid JSON matching this schema:
{
  "items": [
    {"item_id": "string", "qty": integer, "description": "string or null", "confidence": "high|medium|low"}
  ],
  "vendor": "string or null",
  "po_number": "string or null",
  "ship_date": "string or null",
  "notes": "string or null"
}

Return ONLY the JSON, no other text."""


class PackingSlipParser:
    """Parse packing slips using Databricks GPT-5 vision API."""

    def __init__(self):
        """Initialize the parser with Databricks client."""
        from databricks.sdk import WorkspaceClient

        from inventory_demo.config import get_settings

        # Get workspace host from settings to ensure we use the correct workspace
        settings = get_settings()
        host = settings.databricks.host or None

        self._workspace_client = WorkspaceClient(host=host)
        self._client = self._workspace_client.serving_endpoints.get_open_ai_client()

        logger.info("packing_slip_parser_initialized", model="databricks-gpt-5-2", host=host)

    def parse_image(
        self,
        image_data: bytes,
        media_type: str = "image/jpeg",
    ) -> PackingSlipParseResult:
        """Parse a packing slip image and extract line items.

        Args:
            image_data: Raw image bytes
            media_type: MIME type of the image (image/jpeg, image/png, image/webp, image/gif)

        Returns:
            PackingSlipParseResult with extracted items and metadata
        """
        # Encode image to base64
        image_b64 = base64.b64encode(image_data).decode("utf-8")

        logger.info(
            "parsing_packing_slip",
            image_size=len(image_data),
            media_type=media_type,
        )

        try:
            completion = self._client.chat.completions.create(
                model="databricks-gpt-5-2",
                max_tokens=2048,
                messages=[
                    {
                        "role": "system",
                        "content": SYSTEM_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Extract all line items from this packing slip.",
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{media_type};base64,{image_b64}",
                                },
                            },
                        ],
                    },
                ],
            )

            # Extract the text response
            response_text = completion.choices[0].message.content

            # Parse JSON from response (handle markdown code blocks)
            json_str = response_text
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0]
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0]

            parsed = json.loads(json_str.strip())
            result = PackingSlipParseResult(**parsed)

            logger.info(
                "packing_slip_parsed",
                item_count=len(result.items),
                vendor=result.vendor,
                po_number=result.po_number,
            )

            return result

        except Exception as e:
            logger.error("packing_slip_parse_error", error=str(e))
            return PackingSlipParseResult(
                items=[],
                notes=f"Failed to parse image: {e}",
            )


# Global parser instance (lazy-loaded)
_parser: PackingSlipParser | None = None


def get_parser() -> PackingSlipParser:
    """Get the global packing slip parser instance."""
    global _parser
    if _parser is None:
        _parser = PackingSlipParser()
    return _parser
