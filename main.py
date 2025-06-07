print("🚨 main.py has been loaded")

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
import pandas as pd
import os
from typing import Optional
from routers import backtests
from db import init_db, insert_mock_backtest
import sqlite3

app = FastAPI()

# Initialize DB & insert mock if needed
init_db()
insert_mock_backtest()

# Mount backtest routes
app.include_router(backtests.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Splash Page ===
@app.get("/", response_class=HTMLResponse)
async def splash():
    return """
    <html>
        <head><title>QuantApp</title></head>
        <body style="font-family: sans-serif; text-align: center; margin-top: 100px;">
            <h1>QuantApp Coming Soon</h1>
            <p>Check back for real-time backtesting tools.</p>
        </body>
    </html>
    """

# === Dynamic OHLCV Endpoint ===
DATA_DIR = "/opt/chart_dashboard"

@app.get("/ohlcv")
def get_ohlcv(symbol: str = Query(..., description="Currency pair symbol, e.g., EURUSD")):
    filename = os.path.join(DATA_DIR, f"{symbol.upper()}.csv")

    if not os.path.isfile(filename):
        raise HTTPException(status_code=404, detail=f"No data file found for {symbol}")

    try:
        df = pd.read_csv(filename, sep=";", names=["datetime", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["datetime"], format="%Y%m%d %H%M%S")
        df["timestamp"] = (df["timestamp"].astype("int64") // 10**6)  # Convert to ms
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading file: {str(e)}")

    return JSONResponse({
        "t": df["timestamp"].tolist(),
        "o": df["open"].tolist(),
        "h": df["high"].tolist(),
        "l": df["low"].tolist(),
        "c": df["close"].tolist(),
        "v": df["volume"].tolist(),
    })

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Mount the static folder (for JS/CSS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Research page route
@app.get("/research")
def research_page():
    return FileResponse("static/research/research.html")

# Serve mock trade data
@app.get("/trades")
def get_trades(backtest_id: int, symbol: str = None):
    print("🔥 Trades endpoint hit!")  # NEW LINE
    print(f"📥 Params received: backtest_id={backtest_id}, symbol={symbol}")

    conn = sqlite3.connect("backtests.db")
    cursor = conn.cursor()

    if symbol:
        print(f"✅ Running SQL with symbol filter")
        cursor.execute("SELECT * FROM trades WHERE backtest_id = ? AND symbol = ?", (backtest_id, symbol))
    else:
        print(f"⚠️ Running SQL without symbol filter")
        cursor.execute("SELECT * FROM trades WHERE backtest_id = ?", (backtest_id,))

    rows = cursor.fetchall()
    print(f"📊 Retrieved {len(rows)} trades from database")

    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in rows]

from fastapi.responses import FileResponse

@app.get("/data/{symbol}.csv")
def get_csv(symbol: str):
    file_path = f"data/{symbol.upper()}.csv"
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type='text/csv')
    raise HTTPException(status_code=404, detail="CSV file not found.")

    # Read only the last 1000 lines efficiently
    with open(filepath, "rb") as f:
        try:
            f.seek(-2000000, 2)  # seek near end (2MB = approx. 1000 candles)
        except OSError:
            f.seek(0)
        tail = f.read().decode(errors="ignore")

    lines = tail.strip().splitlines()
    if len(lines) > 1000:
        lines = lines[-1000:]
    return Response("\n".join([lines[0]] + lines[-999:]), media_type="text/csv")

from fastapi.staticfiles import StaticFiles

app.mount("/data", StaticFiles(directory="/opt/chart_dashboard/data"), name="data")

from typing import Optional
from fastapi.responses import JSONResponse
from datetime import datetime
import os

@app.get("/candles")
def get_candles(symbol: str, timeframe: str = "M1", start: Optional[int] = None, end: Optional[int] = None):
    file_path = f"/opt/chart_dashboard/data/{symbol}_{timeframe.upper()}.csv"
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Symbol data not found")

    # Estimate how far from the end to seek (around 200 bytes per line max)
    max_bytes = 200 * 1500  # ~1000-1500 lines
    candles = []

    try:
        with open(file_path, "rb") as f:
            try:
                f.seek(-max_bytes, os.SEEK_END)
            except OSError:
                f.seek(0)  # For small files

            tail = f.read().decode(errors="ignore")
            lines = tail.strip().splitlines()
            lines = lines[-1500:]  # in case we get more than needed

            for line in lines:
                parts = line.strip().split(";")
                if len(parts) < 5:
                    continue
                timestamp_str, open_, high, low, close = parts[:5]
                try:
                    dt = datetime.strptime(timestamp_str, "%Y%m%d %H%M%S")
                    ts = int(dt.timestamp())
                    if (start and ts < start) or (end and ts > end):
                        continue
                    candles.append({
                        "time": ts,
                        "open": float(open_),
                        "high": float(high),
                        "low": float(low),
                        "close": float(close),
                    })
                except:
                    continue
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read candles: {str(e)}")

    # Limit to last 1000 valid candles
    candles = candles[-1000:]

    return JSONResponse(content=candles)

