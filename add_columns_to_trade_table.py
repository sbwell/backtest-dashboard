import sqlite3

enriched_columns = [
    "atr_20d", "avg_volume_20d", "rvol",
    "move_1h", "move_1h_atr", "move_2h", "move_2h_atr", "move_1d", "move_1d_atr",
    "range_15m", "range_15m_atr", "range_60m", "range_60m_atr",
    "range_2h", "range_2h_atr", "range_1d", "range_1d_atr"
]

conn = sqlite3.connect("backtests.db")
cursor = conn.cursor()

for col in enriched_columns:
    try:
        cursor.execute(f"ALTER TABLE trades ADD COLUMN {col} REAL")
        print(f"✅ Added column: {col}")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print(f"⚠️ Column already exists: {col}")
        else:
            raise

conn.commit()
conn.close()
