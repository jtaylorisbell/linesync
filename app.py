"""Databricks Apps entry point for Inventory Demo.

This wrapper adds the src directory to the Python path and starts the FastAPI app.
"""

import sys
from pathlib import Path

# Add src directory to Python path
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

# Import and expose the FastAPI app
from inventory_demo.api.main import app  # noqa: E402

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
