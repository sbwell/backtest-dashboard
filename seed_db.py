import sqlite3
import json
from datetime import datetime, timedelta

DB_PATH = "backtests.db"

def seed():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # --- Sample backtests ---
    backtests = [
        {
            "symbol": "EURUSD",
            "strategy": "breakout",
            "run_name": "EURUSD Breakout",
            "start_date": "2025-05-01",
            "end_date": "2025-05-15",
            "timestamp": datetime.utcnow().isoformat(),
            "win_rate": 0.6,
            "profit": 1200.0,
            "trade_count": 3,
            "settings_json": json.dumps({"ma": 34}),
            "user_id": "testuser"
        },
        {
            "symbol": "GBPUSD",
            "strategy": "mean-reversion",
            "run_name": "GBPUSD Reversion",
            "start_date": "2025-05-01",
            "end_date": "2025-05-15",
            "timestamp": datetime.utcnow().isoformat(),
            "win_rate": 0.5,
            "profit": 800.0,
            "trade_count": 2,
            "settings_json": json.dumps({"rsi": 14}),
            "user_id": "testuser"
        }
    ]

    for bt in backtests:
        cur.execute("""
            INSERT INTO backtests (symbol, strategy, run_name, start_date, end_date, timestamp,
                                   win_rate, profit, trade_count, settings_json, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            bt["symbol"], bt["strategy"], bt["run_name"],
            bt["start_date"], bt["end_date"], bt["timestamp"],
            bt["win_rate"], bt["profit"], bt["trade_count"],
            bt["settings_json"], bt["user_id"]
        ))
        bt["id"] = cur.lastrowid

    # --- Sample trades for each backtest ---
    now = datetime.utcnow()
    trades = [
        {
            "backtest_id": backtests[0]["id"],
            "symbol": "EURUSD",
            "entry_time": now.isoformat(),
            "exit_time": (now + timedelta(minutes=30)).isoformat(),
            "entry_price": 1.0800,
            "exit_price": 1.0840,
            "pnl": 40,
            "duration_bars": 6,
            "side": "buy",
            "tags": "breakout",
            "notes": "Clean breakout",
            "details_json": json.dumps({"ma_dist": 0.0015, "rsi": 60})
        },
        {
            "backtest_id": backtests[0]["id"],
            "symbol": "EURUSD",
            "entry_time": (now + timedelta(hours=1)).isoformat(),
            "exit_time": (now + timedelta(hours=1, minutes=30)).isoformat(),
            "entry_price": 1.0850,
            "exit_price": 1.0830,
            "pnl": -20,
            "duration_bars": 6,
            "side": "sell",
            "tags": "false breakout",
            "notes": "Failed follow-through",
            "details_json": json.dumps({"ma_dist": -0.0008, "volatility": 0.9})
        },
        {
            "backtest_id": backtests[1]["id"],
            "symbol": "GBPUSD",
            "entry_time": now.isoformat(),
            "exit_time": (now + timedelta(minutes=20)).isoformat(),
            "entry_price": 1.2650,
            "exit_price": 1.2670,
            "pnl": 20,
            "duration_bars": 4,
            "side": "buy",
            "tags": "rsi-rebound",
            "notes": "",
            "details_json": json.dumps({"rsi": 28, "oversold": True})
        }
    ]

    for trade in trades:
        cur.execute("""
            INSERT INTO trades (backtest_id, symbol, entry_time, exit_time, entry_price, exit_price,
                                pnl, duration_bars, side, tags, notes, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            trade["backtest_id"], trade["symbol"],
            trade["entry_time"], trade["exit_time"],
            trade["entry_price"], trade["exit_price"],
            trade["pnl"], trade["duration_bars"],
            trade["side"], trade["tags"], trade["notes"],
            trade["details_json"]
        ))

    conn.commit()
    conn.close()
    print("✅ Sample backtests and trades seeded.")

if __name__ == "__main__":
    seed()
