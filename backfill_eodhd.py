import requests
import pandas as pd
import sqlite3
import time
from datetime import datetime, timedelta
from pytz import timezone, utc

# Configuration
API_KEY = "68402b9a1aa451.77165073"
DB_PATH = "/opt/chart_dashboard/ohlcv.db"
SYMBOLS = ["EURUSD.FOREX"]  # Replace with full 28 symbols when ready
TIMEFRAMES = {"M5": 5, "M15": 15, "H1": 60, "H4": 240, "D1": 1440}
M1_TABLE = "candles_{symbol}_M1"
TABLE_TEMPLATE = "candles_{symbol}_{tf}"
EODHD_URL = "https://eodhd.com/api/intraday/{symbol}?api_token={token}&interval=1m&from={start}&to={end}&fmt=json"

# === Utilities ===
def clean_symbol(symbol):
    return symbol.replace(".FOREX", "").replace(".", "_")

def unix_time(dt):
    return int(dt.timestamp())

def convert_utc_to_est(ts):
    dt = datetime.utcfromtimestamp(ts).replace(tzinfo=utc)
    dt_est = dt.astimezone(timezone("US/Eastern"))
    return int(dt_est.timestamp())

def fetch_intraday(symbol, start_ts, end_ts):
    url = EODHD_URL.format(
        symbol=symbol,
        token=API_KEY,
        start=start_ts,
        end=end_ts
    )
    resp = requests.get(url)
    if resp.status_code != 200:
        print(f"[ERROR] HTTP {resp.status_code}: {resp.text}")
        return pd.DataFrame()

    data = resp.json()
    df = pd.DataFrame(data)
    if "timestamp" not in df or df["timestamp"].nunique() == 1:
        print("[WARNING] Dropping rows with invalid timestamps:")
        print(df.head())
        return pd.DataFrame()

    df = df.drop_duplicates(subset="timestamp")
    df = df.sort_values("timestamp")
    df["timestamp"] = df["timestamp"].apply(convert_utc_to_est)
    return df[["timestamp", "open", "high", "low", "close", "volume"]]

def overwrite_table(conn, table, df):
    if df.empty:
        return
    try:
        with conn:
            ts_list = df["timestamp"].tolist()
            placeholders = ",".join(["?"] * len(ts_list))
            conn.execute(f"DELETE FROM {table} WHERE timestamp IN ({placeholders})", ts_list)
            df.to_sql(table, conn, if_exists="append", index=False)
            print(f"[INFO] Wrote {len(df)} rows to {table}")
    except Exception as e:
        print(f"[ERROR] Failed inserting into {table}: {e}")
        print(df.head())

def aggregate(df_m1, interval_minutes):
    if df_m1.empty:
        return pd.DataFrame()

    df = df_m1.copy()
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s")
    df.set_index("datetime", inplace=True)
    rule = f"{interval_minutes}min"
    ohlcv = df.resample(rule, label="right", closed="right").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum"
    }).dropna().reset_index()
    ohlcv["timestamp"] = ohlcv["datetime"].astype(int) // 10**9
    return ohlcv[["timestamp", "open", "high", "low", "close", "volume"]]

def compute_d1_enrichment(df_d1):
    df = df_d1.copy()
    df["atr_20d"] = df["high"].rolling(20).max() - df["low"].rolling(20).min()
    df["avg_volume_20d"] = df["volume"].rolling(20).mean()
    df["rvol"] = df["volume"] / df["avg_volume_20d"]
    return df

def enrich_with_d1(df_tf, df_d1_enriched):
    if df_tf.empty or df_d1_enriched.empty:
        return df_tf

    d1_map = df_d1_enriched.set_index("timestamp")[["atr_20d", "avg_volume_20d", "rvol"]]
    df_tf["date"] = pd.to_datetime(df_tf["timestamp"], unit="s").dt.floor("D")
    df_tf["d1_ts"] = df_tf["date"].astype(int) // 10**9
    df_tf = df_tf.merge(d1_map, left_on="d1_ts", right_index=True, how="left")
    df_tf.drop(columns=["date", "d1_ts"], inplace=True)

    median_interval = df_tf["timestamp"].diff().median() / 60
    for label, n in [("1h", 60), ("2h", 120), ("1d", 1440)]:
        period = int(n // median_interval)
        df_tf[f"move_{label}"] = df_tf["close"] - df_tf["close"].shift(period)
        df_tf[f"move_{label}_atr"] = df_tf[f"move_{label}"] / df_tf["atr_20d"]

    for label, n in [("15m", 15), ("60m", 60), ("2h", 120), ("1d", 1440)]:
        period = int(n // median_interval)
        df_tf[f"range_{label}"] = df_tf["high"].rolling(period).max() - df_tf["low"].rolling(period).min()
        df_tf[f"range_{label}_atr"] = df_tf[f"range_{label}"] / df_tf["atr_20d"]

    return df_tf

# === Main Logic ===
def backfill_symbol(symbol):
    print(f"=== Backfilling {symbol} ===")
    conn = sqlite3.connect(DB_PATH)
    today = datetime.utcnow().date()
    start_date = datetime(2025, 5, 16).date()
    days = (today - start_date).days
    cleaned_symbol = clean_symbol(symbol)

    all_m1 = []
    for i in range(days):
        day = today - timedelta(days=i + 1)
        if day < start_date:
            continue
        if day.weekday() >= 5:
            print(f"[{symbol}] Skipping weekend: {day}")
            continue
        start = datetime(day.year, day.month, day.day)
        end = start + timedelta(days=1)
        df = fetch_intraday(symbol, unix_time(start), unix_time(end))
        if not df.empty:
            all_m1.append(df)
            table_name = M1_TABLE.format(symbol=cleaned_symbol)
            overwrite_table(conn, table_name, df)
            print(f"[INFO] Wrote {len(df)} rows to {table_name} for {day}")
        time.sleep(1)

    if not all_m1:
        print(f"[{symbol}] No M1 data fetched.")
        conn.close()
        return

    try:
        print(f"[INFO] Concatenating {len(all_m1)} M1 segments...")
        df_m1 = pd.concat(all_m1).drop_duplicates(subset="timestamp").sort_values("timestamp")
        print(f"[INFO] M1 total rows after concat: {len(df_m1)}")

        df_d1 = aggregate(df_m1, 1440)
        print(f"[INFO] Aggregated D1 rows: {len(df_d1)}")
        df_d1 = compute_d1_enrichment(df_d1)
        d1_table = TABLE_TEMPLATE.format(symbol=cleaned_symbol, tf="D1")
        overwrite_table(conn, d1_table, df_d1)

        for tf, mins in TIMEFRAMES.items():
            if tf == "D1":
                continue
            df_tf = aggregate(df_m1, mins)
            print(f"[INFO] Aggregated {tf} rows: {len(df_tf)}")
            df_tf = enrich_with_d1(df_tf, df_d1)
            table = TABLE_TEMPLATE.format(symbol=cleaned_symbol, tf=tf)
            overwrite_table(conn, table, df_tf)

    except Exception as e:
        print(f"[ERROR] Aggregation or enrichment failed: {e}")

    conn.close()

# === Entry Point ===
if __name__ == "__main__":
    for sym in SYMBOLS:
        backfill_symbol(sym)
