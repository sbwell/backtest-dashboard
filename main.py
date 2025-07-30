print("🚨 main.py has been loaded")

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from typing import Optional
from datetime import datetime
import pandas as pd
import sqlite3
import os

from routers import backtests
from db import init_db, insert_mock_backtest

app = FastAPI()

# Initialize DB & insert mock if needed
init_db()
# insert_mock_backtest()

# Mount backtest routes
app.include_router(backtests.router)

# CORS middleware
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

# === OHLCV Endpoint (histdata-style) ===
DATA_DIR = "/opt/chart_dashboard"

@app.get("/ohlcv")
def get_ohlcv(symbol: str = Query(..., description="Currency pair symbol, e.g., EURUSD")):
    filename = os.path.join(DATA_DIR, f"{symbol.upper()}.csv")

    if not os.path.isfile(filename):
        raise HTTPException(status_code=404, detail=f"No data file found for {symbol}")

    try:
        df = pd.read_csv(filename, sep=";", names=["datetime", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["datetime"], format="%Y%m%d %H%M%S")
        df["timestamp"] = (df["timestamp"].astype("int64") // 10**6)
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

# === Serve Static Files ===
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/data", StaticFiles(directory="/opt/chart_dashboard/data"), name="data")

@app.get("/research")
def research_page():
    return FileResponse("static/research/research.html")

@app.get("/data/{symbol}.csv")
def get_csv(symbol: str):
    file_path = f"data/{symbol.upper()}.csv"
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type='text/csv')
    raise HTTPException(status_code=404, detail="CSV file not found.")

# === Trades Endpoint ===
@app.get("/trades")
def get_trades(backtest_id: int, symbol: str = None):
    print("🔥 Trades endpoint hit!")
    print(f"📥 Params received: backtest_id={backtest_id}, symbol={symbol}")

    conn = sqlite3.connect("backtests.db")
    cursor = conn.cursor()

    if symbol:
        print("✅ Running SQL with symbol filter")
        cursor.execute("SELECT * FROM trades WHERE backtest_id = ? AND symbol = ?", (backtest_id, symbol))
    else:
        print("⚠️ Running SQL without symbol filter")
        cursor.execute("SELECT * FROM trades WHERE backtest_id = ?", (backtest_id,))

    rows = cursor.fetchall()
    print(f"📊 Retrieved {len(rows)} trades from database")

    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in rows]

# === Candles Endpoint with Infinite Scroll Support ===
@app.get("/candles")
def get_candles(symbol: str, timeframe: str = "M1", start: Optional[int] = None, end: Optional[int] = None, before: Optional[int] = None):
    file_path = f"/opt/chart_dashboard/data/{symbol}_{timeframe.upper()}.csv"
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Symbol data not found")

    candles = []
    max_bytes = 200 * 1500

    try:
        if before:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = [line for line in f if line.strip()]
                collected = []

                for line in reversed(lines):
                    parts = line.strip().split(";")
                    if len(parts) < 5:
                        continue
                    timestamp_str, open_, high, low, close = parts[:5]
                    try:
                        dt = datetime.strptime(timestamp_str, "%Y%m%d %H%M%S")

                        # Data is stored in EST (UTC-5)
                        from datetime import timezone, timedelta
                        est_timezone = timezone(timedelta(hours=-5))
                        dt = dt.replace(tzinfo=est_timezone)

                        ts = int(dt.timestamp())
                        if ts >= before:
                            continue
                        collected.append({
                            "time": ts,
                            "open": float(open_),
                            "high": float(high),
                            "low": float(low),
                            "close": float(close),
                        })
                        if len(collected) >= 500:
                            break
                    except:
                        continue
                candles = list(reversed(collected))
        else:
            with open(file_path, "rb") as f:
                try:
                    f.seek(-max_bytes, os.SEEK_END)
                except OSError:
                    f.seek(0)

                tail = f.read().decode(errors="ignore")
                lines = tail.strip().splitlines()
                lines = lines[-1500:]

                for line in lines:
                    parts = line.strip().split(";")
                    if len(parts) < 5:
                        continue
                    timestamp_str, open_, high, low, close = parts[:5]
                    try:
                        dt = datetime.strptime(timestamp_str, "%Y%m%d %H%M%S")
                        ts = int(dt.timestamp())
                        if start and ts < start:
                            continue
                        if end and ts > end:
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

        return JSONResponse(content=candles)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read candles: {str(e)}")

