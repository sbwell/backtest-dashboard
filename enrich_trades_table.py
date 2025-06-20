import sqlite3
from datetime import datetime

# Open both databases
bt_db = sqlite3.connect("backtests.db")
bt_db.row_factory = sqlite3.Row
bt_cursor = bt_db.cursor()

ohlcv_db = sqlite3.connect("/opt/chart_dashboard/ohlcv.db")
ohlcv_db.row_factory = sqlite3.Row
ohlcv_cursor = ohlcv_db.cursor()

# Load all trades
trades = bt_cursor.execute("SELECT * FROM trades").fetchall()

for trade in trades:
    symbol = trade["symbol"]
    entry_ts = int(datetime.fromisoformat(trade["entry_time"].replace("Z", "+00:00")).timestamp())
    timeframe = "M1"  # You can adjust this if needed

    ohlcv_table = f"candles_{symbol}_{timeframe}"

    try:
        ohlcv_cursor.execute(f"""
            SELECT atr_20d, avg_volume_20d, rvol,
                   move_1h, move_1h_atr, move_2h, move_2h_atr, move_1d, move_1d_atr,
                   range_15m, range_15m_atr, range_60m, range_60m_atr,
                   range_2h, range_2h_atr, range_1d, range_1d_atr
            FROM {ohlcv_table}
            WHERE timestamp <= ?
            ORDER BY timestamp DESC
            LIMIT 1
        """, (entry_ts,))
        row = ohlcv_cursor.fetchone()
    except sqlite3.OperationalError as e:
        print(f"⚠️ Skipping {ohlcv_table}: {e}")
        continue

    if row:
        update_fields = list(row.keys())
        update_values = [row[k] for k in update_fields]
        set_clause = ", ".join(f"{k} = ?" for k in update_fields)
        update_values.append(trade["id"])

        sql = f"UPDATE trades SET {set_clause} WHERE id = ?"
        bt_cursor.execute(sql, update_values)

bt_db.commit()
print("✅ Enrichment complete.")
