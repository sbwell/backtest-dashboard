import sqlite3
import json
from datetime import datetime

DB_PATH = "/opt/chart_dashboard/backtests.db"

def get_db():
    return sqlite3.connect(DB_PATH, check_same_thread=False)

def init_db():
    with get_db() as conn:
        with open("/opt/chart_dashboard/schema.sql", "r") as f:
            conn.executescript(f.read())

def insert_mock_backtest():
    conn = get_db()
    cursor = conn.cursor()

    settings = {
        "strategy": "sma34_crossover",
        "timeframe": "M5",
        "atr_filter": 1.2
    }

    cursor.execute("""
        INSERT INTO backtests (
            symbol, strategy, run_name, start_date, end_date, timestamp,
            win_rate, profit, trade_count, settings_json, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "EURUSD", "sma34", "test1", "2025-05-01", "2025-05-15", datetime.utcnow().isoformat(),
        0.65, 420.5, 10, json.dumps(settings), "user1"
    ))

    backtest_id = cursor.lastrowid

    trades = [
        ("EURUSD", "2025-05-02T09:30:00", "2025-05-02T10:15:00", 1.1153, 1.1172, 190, 9, "long", "breakout", ""),
        ("EURUSD", "2025-05-05T14:00:00", "2025-05-05T15:20:00", 1.1121, 1.1112, -90, 11, "short", "divergence", "")
    ]

    for t in trades:
        cursor.execute("""
            INSERT INTO trades (
                backtest_id, symbol, entry_time, exit_time, entry_price, exit_price,
                pnl, duration_bars, side, tags, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (backtest_id, *t))

    conn.commit()
    conn.close()
