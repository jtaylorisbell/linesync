"""Database layer for Inventory Demo."""

from inventory_demo.db.postgres import PostgresDB, get_db

__all__ = ["PostgresDB", "get_db"]
