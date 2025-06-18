import os
import sqlite3
import pandas as pd
from datetime import datetime

# Config
db_path = "/opt/chart_dashboard/ohlcv.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all candles_* tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [t[0] for t in cursor.fetchall() if t[0].startswith("candles_")]

def get_tf_minutes(name):
    suffixes = {"M1": 1, "M5": 5, "M15": 15, "H1": 60, "H4": 240, "D1": 1440}
    for tf, mins in suffixes.items():
        if name.endswith(tf):
            return tf, mins
    return None, None

def ensure_column(table, column, dtype):
    cursor.execute(f"PRAGMA table_info({table})")
    if column not in [r[1] for r in cursor.fetchall()]:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {dtype}")

# --- Enrich D1 Tables ---
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

    # ✅ Correct ATR calculation
    df["prev_close"] = df["close"].shift(1)
    df["tr"] = df[["high", "prev_close"]].max(axis=1) - df[["low", "prev_close"]].min(axis=1)
    df["atr_20d"] = df["tr"].rolling(20).mean()

    df["avg_volume_20d"] = df["volume"].rolling(20).mean()
    df["rvol"] = df["volume"] / df["avg_volume_20d"]

    for _, row in df.iterrows():
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

conn.close()
