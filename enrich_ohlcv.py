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

conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [t[0] for t in cursor.fetchall() if t[0].startswith("candles_")]

def get_tf_minutes(name):
    for tf, mins in timeframe_minutes.items():
        if name.endswith(tf):
            return tf, mins
    return None, None

def ensure_column(table, column, dtype):
    cursor.execute(f"PRAGMA table_info({table})")
    if column not in [r[1] for r in cursor.fetchall()]:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {dtype}")

# --------------------
# Phase 1: Enrich D1 Tables First
# --------------------
for table in tables:
    tf_suffix, tf_mins = get_tf_minutes(table)
    if tf_suffix != "D1":
        continue

    print(f"🧱 Enriching D1 table: {table}")
    df = pd.read_sql(f"SELECT * FROM {table}", conn)
    if "timestamp" not in df.columns or df.empty:
        continue
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s")
    df["date"] = df["dt"].dt.date

    ensure_column(table, "atr_20d", "REAL")
    ensure_column(table, "avg_volume_20d", "REAL")
    ensure_column(table, "rvol", "REAL")

    df["tr"] = df["high"] - df["low"]
    df["atr_20d"] = df["tr"].rolling(20).mean()
    df["avg_volume_20d"] = df["volume"].rolling(20).mean()
    df["rvol"] = df["volume"] / df["avg_volume_20d"]

    for i, row in df.iterrows():
        cursor.execute(
            f"UPDATE {table} SET atr_20d = ?, avg_volume_20d = ?, rvol = ? WHERE timestamp = ?",
            (
                float(row["atr_20d"]) if pd.notnull(row["atr_20d"]) else None,
                float(row["avg_volume_20d"]) if pd.notnull(row["avg_volume_20d"]) else None,
                float(row["rvol"]) if pd.notnull(row["rvol"]) else None,
                int(row["timestamp"])
            )
        )
    conn.commit()
    print(f"✅ {table} enriched")

# --------------------
# Phase 2: Enrich All Other Tables
# --------------------
for table in tables:
    tf_suffix, tf_mins = get_tf_minutes(table)
    if tf_suffix == "D1" or not tf_suffix:
        continue

    print(f"⏳ Enriching {table} ({tf_suffix})")
    df = pd.read_sql(f"SELECT * FROM {table}", conn)
    if "timestamp" not in df.columns or df.empty:
        continue
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s")
    df["date"] = df["dt"].dt.date

    for col in ["atr_20d", "avg_volume_20d", "rvol"]:
        ensure_column(table, col, "REAL")
    for p in movement_periods:
        ensure_column(table, f"move_{p}", "REAL")
        ensure_column(table, f"move_{p}_atr", "REAL")
    for p in range_periods:
        ensure_column(table, f"range_{p}", "REAL")
        ensure_column(table, f"range_{p}_atr", "REAL")

    # Try to join D1 metrics
    d1_table = table.replace(f"_{tf_suffix}", "_D1")
    if d1_table in tables:
        cursor.execute(f"PRAGMA table_info({d1_table})")
        d1_cols = [row[1] for row in cursor.fetchall()]
        required = ["atr_20d", "avg_volume_20d", "rvol"]
        if all(col in d1_cols for col in required):
            d1_df = pd.read_sql(f"SELECT * FROM {d1_table}", conn)
            d1_df["dt"] = pd.to_datetime(d1_df["timestamp"], unit="s")
            d1_df["date"] = d1_df["dt"].dt.date
            df = df.merge(d1_df[["date"] + required], on="date", how="left")
        else:
            print(f"⚠️ Skipping D1 merge for {table} — missing required columns")

    # Movement
    for label, mins in movement_periods.items():
        shift = int(mins / tf_mins)
        df[f"move_{label}"] = df["close"] - df["close"].shift(shift)
        if "atr_20d" in df.columns:
            df[f"move_{label}_atr"] = df[f"move_{label}"] / df["atr_20d"]
        else:
            df[f"move_{label}_atr"] = None

    # Range
    for label, mins in range_periods.items():
        window = int(mins / tf_mins)
        df[f"range_{label}"] = df["high"].rolling(window).max() - df["low"].rolling(window).min()
        if "atr_20d" in df.columns:
            df[f"range_{label}_atr"] = df[f"range_{label}"] / df["atr_20d"]
        else:
            df[f"range_{label}_atr"] = None

    # Write to DB
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
