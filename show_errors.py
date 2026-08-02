#!/usr/bin/env python3
import sqlite3
import argparse
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'app.db')


def main():
    parser = argparse.ArgumentParser(description="Просмотр последних ошибок Pomodoro из логов SQLite.")
    parser.add_argument("-n", "--number", type=int, default=10,
                        help="Количество ошибок для вывода (по умолчанию 10)")
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        print(f"Файл базы данных не найден: {DB_PATH}")
        return

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.execute('SELECT timestamp, source, message, stack FROM errors ORDER BY id DESC LIMIT ?',
                              (args.number,))
        rows = cursor.fetchall()

        if not rows:
            print("Ошибок не найдено.")

        for row in rows:
            print(f"--- {row[0]} [{row[1]}] ---")
            print(f"Message: {row[2]}")
            if row[3]:
                print(f"Stack:\n{row[3]}")
            print()
    except Exception as e:
        print(f"Ошибка чтения БД: {e}")
    finally:
        if 'conn' in locals():
            conn.close()


if __name__ == "__main__":
    main()
