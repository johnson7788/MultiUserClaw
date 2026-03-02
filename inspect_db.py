#!/usr/bin/env python3
"""Inspect nanobot_platform PostgreSQL database: list all tables and their contents.
可能需要安装依赖：sudo apt install libpq-dev
然后安装pip install psycopg2
"""

import psycopg2
from psycopg2.extras import RealDictCursor

DB_CONFIG = {
    "host": "localhost",
    "port": 15432,
    "dbname": "nanobot_platform",
    "user": "nanobot",
    "password": "nanobot",
}


def main():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # List all tables in public schema
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
    """)
    tables = [row["table_name"] for row in cur.fetchall()]

    print(f"Database: {DB_CONFIG['dbname']}")
    print(f"Tables found: {len(tables)}")
    print("=" * 80)

    for table in tables:
        # Get column info
        cur.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
        """, (table,))
        columns = cur.fetchall()

        # Get row count
        cur.execute(f'SELECT COUNT(*) AS cnt FROM "{table}"')
        count = cur.fetchone()["cnt"]

        print(f"\n{'─' * 80}")
        print(f"Table: {table}  ({count} rows)")
        print(f"{'─' * 80}")

        # Print columns
        print("Columns:")
        for col in columns:
            nullable = "NULL" if col["is_nullable"] == "YES" else "NOT NULL"
            print(f"  {col['column_name']:30s} {col['data_type']:20s} {nullable}")

        # Print rows (limit to 50 to avoid flooding)
        if count > 0:
            cur.execute(f'SELECT * FROM "{table}" LIMIT 50')
            rows = cur.fetchall()
            print(f"\nData ({min(count, 50)} of {count} rows):")
            for i, row in enumerate(rows, 1):
                print(f"\n  --- Row {i} ---")
                for k, v in row.items():
                    val = str(v)
                    if len(val) > 120:
                        val = val[:120] + "..."
                    print(f"    {k}: {val}")
        else:
            print("\n  (empty)")

    print(f"\n{'=' * 80}")
    print("Done.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
