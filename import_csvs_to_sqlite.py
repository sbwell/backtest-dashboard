import os
import sqlite3
import pandas as pd
from datetime import datetime

# Path to your CSVs and output DB
csv_folder = "/opt/chart_dashboard/data"
db_path = "/opt/chart_dashboard/ohlcv.db"

# Connect to SQLite
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Convert timestamp like "20200101 170100" to Unix
def parse_timestamp(ts_str):
    return int(datetime.strptime(ts_str, "%Y%m%d %H%M%S").timestamp())

# Loop through all CSVs
for filename in os.listdir(csv_folder):
    if not filename.endswith(".csv"):
        continue

    parts = filename.replace(".csv", "").split("_")
    if len(parts) != 2:
        continue

    symbol, tf = parts
    table_name = f"candles_{symbol}_{tf}"

    file_path = os.path.join(csv_folder, filename)
    df = pd.read_csv(file_path, sep=";", header=None, names=["timestamp_str", "open", "high", "low", "close", "volume"])

    df["timestamp"] = df["timestamp_str"].apply(parse_timestamp)
    df = df[["timestamp", "open", "high", "low", "close", "volume"]]

    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            timestamp INTEGER PRIMARY KEY,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL
        );
    """)

    cursor.executemany(
        f"INSERT OR IGNORE INTO {table_name} (timestamp, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?)",
        df.values.tolist()
    )

    print(f"✅ Imported {len(df)} rows into {table_name}")

conn.commit()
conn.close()
