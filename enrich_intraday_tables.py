import os
import sqlite3
import pandas as pd
from datetime import datetime

# Config
db_path = "/opt/chart_dashboard/ohlcv.db"
timeframe_minutes = {
    "M1": 1, "M5": 5, "M15": 15, "H1": 60, "H4": 240, "D1": 1440
}
movement_periods = {"1h": 60, "2h": 120, "1d": 1440}
range_periods = {"15m": 15, "60m": 60, "2h": 120, "1d": 1440}
priority_order = ["H4", "H1", "M15", "M5"]

# Load tables
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [t[0] for t in cursor.fetchall() if t[0].startswith("candles_")]

# Helper functions
def get_tf_minutes(name):
    for tf, mins in timeframe_minutes.items():
        if name.endswith(tf):
            return tf, mins
    return None, None

def ensure_column(table, column, dtype):
    cursor.execute(f"PRAGMA table_info({table})")
    if column not in [r[1] for r in cursor.fetchall()]:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {dtype}")

# Order tables based on priority
def get_sort_key(table_name):
    tf_suffix, _ = get_tf_minutes(table_name)
    return priority_order.index(tf_suffix) if tf_suffix in priority_order else 999

tables_to_process = sorted(
    [t for t in tables if get_tf_minutes(t)[0] in priority_order],
    key=get_sort_key
)

# Main enrichment loop
for table in tables_to_process:
    tf_suffix, tf_mins = get_tf_minutes(table)
    if not tf_suffix or tf_suffix == "D1":
        continue

    print(f"⏳ Enriching {table} ({tf_suffix})")

    df = pd.read_sql(f"SELECT * FROM {table}", conn)
    if "timestamp" not in df.columns or df.empty:
        continue

    df = df.sort_values("timestamp").reset_index(drop=True)
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s")
    df["date"] = df["dt"].dt.date

    # Ensure columns exist in table
    for col in ["atr_20d", "avg_volume_20d", "rvol"]:
        ensure_column(table, col, "REAL")
    for p in movement_periods:
        ensure_column(table, f"move_{p}", "REAL")
        ensure_column(table, f"move_{p}_atr", "REAL")
    for p in range_periods:
        ensure_column(table, f"range_{p}", "REAL")
        ensure_column(table, f"range_{p}_atr", "REAL")

    # Merge D1 metrics
    d1_table = table.replace(f"_{tf_suffix}", "_D1")
    atr_available = False
    if d1_table in tables:
        cursor.execute(f"PRAGMA table_info({d1_table})")
        d1_cols = [row[1] for row in cursor.fetchall()]
        required = ["atr_20d", "avg_volume_20d", "rvol"]
        if all(col in d1_cols for col in required):
            d1_df = pd.read_sql(f"SELECT * FROM {d1_table}", conn)
            d1_df["dt"] = pd.to_datetime(d1_df["timestamp"], unit="s")
            d1_df["date"] = d1_df["dt"].dt.date
            df = df.merge(d1_df[["date"] + required], on="date", how="left")
            atr_available = True
        else:
            print(f"⚠️ Skipping D1 merge for {table} — missing required columns")

    # Movement
    for label, mins in movement_periods.items():
        shift = int(mins / tf_mins)
        df[f"move_{label}"] = df["close"] - df["close"].shift(shift)
        if atr_available and "atr_20d" in df.columns:
            df[f"move_{label}_atr"] = df[f"move_{label}"] / df["atr_20d"]

    # Range
    for label, mins in range_periods.items():
        window = int(mins / tf_mins)
        df[f"range_{label}"] = df["high"].rolling(window).max() - df["low"].rolling(window).min()
        if atr_available and "atr_20d" in df.columns:
            df[f"range_{label}_atr"] = df[f"range_{label}"] / df["atr_20d"]

    # Update values back to table
    update_cols = [f"move_{p}" for p in movement_periods] + [f"move_{p}_atr" for p in movement_periods] + \
                  [f"range_{p}" for p in range_periods] + [f"range_{p}_atr" for p in range_periods] + \
                  ["atr_20d", "avg_volume_20d", "rvol"]
    valid_update_cols = [col for col in update_cols if col in df.columns]

    for _, row in df.iterrows():
        values = [row[c] if pd.notnull(row[c]) else None for c in valid_update_cols]
        values.append(int(row["timestamp"]))
        sql = f"UPDATE {table} SET {', '.join([f'{c} = ?' for c in valid_update_cols])} WHERE timestamp = ?"
        cursor.execute(sql, values)

    conn.commit()
    print(f"✅ {table} enriched")

conn.close()
