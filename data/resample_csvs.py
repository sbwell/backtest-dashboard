import os
import pandas as pd
from datetime import datetime

# Folder containing your raw M1 CSVs
input_dir = "/opt/chart_dashboard/data/"
output_dir = "/opt/chart_dashboard/data/"

timeframes = {
    "M5": "5min",
    "M15": "15min",
    "H1": "1h",
    "H4": "4h",
    "D1": "1D"
}

# Only get M1 files and extract base symbol names
m1_files = [f for f in os.listdir(input_dir) if f.endswith("_M1.csv")]
symbols = [f.replace("_M1.csv", "") for f in m1_files]

print(f"Found {len(symbols)} M1 files to process:")
for symbol in symbols:
    print(f"  {symbol}_M1.csv")

for symbol in symbols:
    print(f"\nProcessing: {symbol}")
    filepath = os.path.join(input_dir, f"{symbol}_M1.csv")

    try:
        df = pd.read_csv(
            filepath,
            sep=";",
            header=None,
            usecols=[0,1,2,3,4],  # timestamp, open, high, low, close
            names=["datetime", "open", "high", "low", "close"],
            dtype={"datetime": str, "open": float, "high": float, "low": float, "close": float}
        )

        # Parse datetime string like '20200101 170000'
        df["datetime"] = pd.to_datetime(df["datetime"], format="%Y%m%d %H%M%S")
        df.set_index("datetime", inplace=True)

        for tf_name, tf_rule in timeframes.items():
            df_resampled = df.resample(tf_rule).agg({
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last"
            }).dropna()

            if df_resampled.empty:
                print(f"  Skipping {tf_name}, no valid rows.")
                continue

            # FIXED: Correct output filename format
            output_path = os.path.join(output_dir, f"{symbol}_{tf_name}.csv")
            df_resampled.to_csv(output_path, sep=";", header=False, date_format="%Y%m%d %H%M%S")
            print(f"  Saved: {output_path}")

    except Exception as e:
        print(f"  Error processing {symbol}: {e}")

print("\nResampling complete!")
