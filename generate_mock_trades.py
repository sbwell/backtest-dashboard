import sqlite3
import requests
import random
import json
from datetime import datetime, timedelta

# 🔧 CONFIG
DB_PATH = "/opt/chart_dashboard/backtests.db"
BASE_URL = "http://localhost:8000"
TIMEFRAME = "M5"
BACKTEST_ID = 999
SYMBOLS = ["EURUSD", "USDJPY", "GBPUSD", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD"]
NUM_TRADES_PER_SYMBOL = 5

def fetch_candles(symbol):
    url = f"{BASE_URL}/candles?symbol={symbol}&timeframe={TIMEFRAME}"
    res = requests.get(url)
    res.raise_for_status()
    return res.json()

def parse_time(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except:
        return datetime.utcfromtimestamp(ts)

def to_js_utc(dt):
    return dt.isoformat(timespec="seconds") + "Z"

def generate_trades(symbol, candles, count, backtest_id):
    if len(candles) < 20:
        print(f"⚠️ Not enough candles for {symbol}")
        return []

    latest_time = parse_time(candles[-1]["time"])
    cutoff_time = latest_time - timedelta(days=5)
    recent_candles = [c for c in candles if parse_time(c["time"]) >= cutoff_time]

    if len(recent_candles) < 20:
        print(f"⚠️ Not enough recent candles for {symbol}")
        return []

    trades = []
    max_start = len(recent_candles) - 15

    for _ in range(count):
        i = random.randint(0, max_start)
        j = i + random.randint(3, 10)

        entry = recent_candles[i]
        exit = recent_candles[j]
        side = random.choice(["buy", "sell"])

        entry_time = to_js_utc(parse_time(entry["time"]))
        exit_time = to_js_utc(parse_time(exit["time"]))
        entry_price = entry["open"]
        exit_price = exit["close"]
        pnl = round((exit_price - entry_price) * (1 if side == "buy" else -1), 5)

        trades.append({
            "backtest_id": backtest_id,
            "symbol": symbol,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "pnl": pnl,
            "duration_bars": j - i,
            "side": side,
            "details_json": json.dumps({
                "bars_held": j - i,
                "entry_index": i,
                "exit_index": j
            })
        })
    return trades

def insert_trades(trades):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    for t in trades:
        cur.execute("""
            INSERT INTO trades (
                backtest_id, symbol, entry_time, exit_time,
                entry_price, exit_price, pnl, duration_bars,
                side, tags, notes, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            t["backtest_id"],
            t["symbol"],
            t["entry_time"],
            t["exit_time"],
            t["entry_price"],
            t["exit_price"],
            t["pnl"],
            t["duration_bars"],
            t["side"],
            "",  # tags
            "",  # notes
            t["details_json"]
        ))

    conn.commit()
    conn.close()

def main():
    for symbol in SYMBOLS:
        print(f"Generating trades for {symbol}...")
        candles = fetch_candles(symbol)
        trades = generate_trades(symbol, candles, NUM_TRADES_PER_SYMBOL, BACKTEST_ID)
        insert_trades(trades)
        print(f"Inserted {len(trades)} trades for {symbol}")

if __name__ == "__main__":
    main()
