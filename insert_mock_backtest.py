import sqlite3
import json
from datetime import datetime, timedelta

DB_PATH = "/opt/chart_dashboard/backtests.db"
BACKTEST_ID = 999
RUN_NAME = "Mock Trades - M5"

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Check if it already exists
    cur.execute("SELECT id FROM backtests WHERE id = ?", (BACKTEST_ID,))
    if cur.fetchone():
        print(f"✅ Backtest ID {BACKTEST_ID} already exists.")
        conn.close()
        return

    now = datetime.utcnow()
    start_date = (now - timedelta(days=5)).isoformat()
    end_date = now.isoformat()
    timestamp = now.isoformat()

    settings = {
        "mock": True,
        "source": "generated",
        "timeframe": "M5"
    }

    cur.execute("""
        INSERT INTO backtests (
            id, symbol, strategy, run_name,
            start_date, end_date, timestamp,
            win_rate, profit, trade_count,
            settings_json, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        BACKTEST_ID,
        "multi",
        "mock_strategy",
        RUN_NAME,
        start_date,
        end_date,
        timestamp,
        None,      # win_rate
        None,      # profit
        None,      # trade_count
        json.dumps(settings),
        None       # user_id
    ))

    conn.commit()
    conn.close()
    print(f"✅ Inserted backtest ID {BACKTEST_ID} with run_name '{RUN_NAME}'")

if __name__ == "__main__":
    main()
