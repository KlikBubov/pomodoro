#!/usr/bin/env python3
import sqlite3
import argparse
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'app.db')


def main():
    parser = argparse.ArgumentParser(description="View latest Pomodoro errors from SQLite logs.")
    parser.add_argument("-n", "--number", type=int, default=10,
                        help="Number of errors to display (default 10)")
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        print(f"Database file not found: {DB_PATH}")
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.execute('SELECT timestamp, source, message, stack FROM errors ORDER BY id DESC LIMIT ?',
                              (args.number,))
        rows = cursor.fetchall()

        if not rows:
            print("No errors found.")

        for row in rows:
            print(f"--- {row[0]} [{row[1]}] ---")
            print(f"Message: {row[2]}")
            if row[3]:
                print(f"Stack:\n{row[3]}")
            print()
    except Exception as e:
        print(f"Database read error: {e}")
    finally:
        if 'conn' in locals():
            conn.close()


if __name__ == "__main__":
    main()
