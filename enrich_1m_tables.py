import sqlite3
import pandas as pd
from datetime import datetime

# Config
db_path = "/opt/chart_dashboard/ohlcv.db"
batch_size = 100_000
overlap = 500

movement_periods = {"1h": 60, "2h": 120, "1d": 1440}
range_periods = {"15m": 15, "60m": 60, "2h": 120, "1d": 1440}
timeframe_minutes = {"M1": 1, "M5": 5, "M15": 15, "H1": 60, "H4": 240, "D1": 1440}

# Utilities
def get_tf_minutes(name):
    for tf, mins in timeframe_minutes.items():
        if name.endswith(tf):
            return tf, mins
    return None, None

def ensure_column(cursor, table, column, dtype):
    cursor.execute(f"PRAGMA table_info({table})")
    if column not in [r[1] for r in cursor.fetchall()]:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {dtype}")

# Start
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [t[0] for t in cursor.fetchall() if t[0].endswith("M1") and t[0].startswith("candles_")]

for table in tables:
    print(f"📈 Enriching M1 table in batches: {table}")
    tf_suffix, tf_mins = get_tf_minutes(table)

    # Add columns if needed
    for col in ["atr_20d", "avg_volume_20d", "rvol"]:
        ensure_column(cursor, table, col, "REAL")
    for p in movement_periods:
        ensure_column(cursor, table, f"move_{p}", "REAL")
        ensure_column(cursor, table, f"move_{p}_atr", "REAL")
    for p in range_periods:
        ensure_column(cursor, table, f"range_{p}", "REAL")
        ensure_column(cursor, table, f"range_{p}_atr", "REAL")

    # Load corresponding D1 table
    d1_table = table.replace("_M1", "_D1")
    d1_df = None
    if d1_table in tables or d1_table in [t[0] for t in cursor.execute("SELECT name FROM sqlite_master")]:
        d1_df = pd.read_sql(f"SELECT timestamp, atr_20d, avg_volume_20d, rvol FROM {d1_table}", conn)
        d1_df["dt"] = pd.to_datetime(d1_df["timestamp"], unit="s")
        d1_df["date"] = d1_df["dt"].dt.date

    # Get total number of rows
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    total_rows = cursor.fetchone()[0]

    for offset in range(0, total_rows, batch_size):
        real_offset = max(0, offset - overlap)
        limit = batch_size + (offset - real_offset)

        df = pd.read_sql(f"SELECT * FROM {table} ORDER BY timestamp LIMIT {limit} OFFSET {real_offset}", conn)
        if df.empty or "timestamp" not in df.columns:
            continue

        df = df.sort_values("timestamp").reset_index(drop=True)
        df["dt"] = pd.to_datetime(df["timestamp"], unit="s")
        df["date"] = df["dt"].dt.date

        # Merge D1 metrics
        if d1_df is not None:
            df = df.merge(d1_df, on="date", how="left", suffixes=("", "_d1"))

        # Movement
        for label, mins in movement_periods.items():
            shift = int(mins / tf_mins)
            df[f"move_{label}"] = df["close"] - df["close"].shift(shift)
            df[f"move_{label}_atr"] = df[f"move_{label}"] / df["atr_20d"]

        # Range
        for label, mins in range_periods.items():
            window = int(mins / tf_mins)
            df[f"range_{label}"] = df["high"].rolling(window).max() - df["low"].rolling(window).min()
            df[f"range_{label}_atr"] = df[f"range_{label}"] / df["atr_20d"]

        update_cols = [f"move_{p}" for p in movement_periods] + [f"move_{p}_atr" for p in movement_periods] + \
                      [f"range_{p}" for p in range_periods] + [f"range_{p}_atr" for p in range_periods] + \
                      ["atr_20d", "avg_volume_20d", "rvol"]
        valid_cols = [col for col in update_cols if col in df.columns]

        for _, row in df.iterrows():
            values = [row[c] if pd.notnull(row[c]) else None for c in valid_cols]
            values.append(int(row["timestamp"]))
            sql = f"UPDATE {table} SET {', '.join([f'{c} = ?' for c in valid_cols])} WHERE timestamp = ?"
            cursor.execute(sql, values)

        conn.commit()
        print(f"✅ Batch starting at row {offset} committed")

print("🎉 All M1 tables enriched in batches.")
conn.close()
