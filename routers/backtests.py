from fastapi import APIRouter, Query, HTTPException
from db import get_db
import json

router = APIRouter()

@router.get("/backtests")
def list_backtests(symbol: str = Query(None)):
    conn = get_db()
    cursor = conn.cursor()
    
    if symbol:
        query = "SELECT * FROM backtests WHERE symbol = ? OR symbol = 'multi' ORDER BY timestamp DESC"
        cursor.execute(query, (symbol.upper(),))
    else:
        query = "SELECT * FROM backtests ORDER BY timestamp DESC"
        cursor.execute(query)

    columns = [col[0] for col in cursor.description]
    results = [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    for r in results:
        r["settings"] = json.loads(r["settings_json"]) if r["settings_json"] else None

    return results

@router.get("/backtests/{backtest_id}")
def get_backtest(backtest_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM backtests WHERE id = ?", (backtest_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Backtest not found")

    columns = [col[0] for col in cursor.description]
    result = dict(zip(columns, row))
    result["settings"] = json.loads(result["settings_json"]) if result["settings_json"] else None
    return result

#@router.get("/trades")
#def get_trades(backtest_id: int = Query(...)):
#    conn = get_db()
#    cursor = conn.cursor()
#    cursor.execute("SELECT * FROM trades WHERE backtest_id = ? ORDER BY entry_time", (backtest_id,))
#    columns = [col[0] for col in cursor.description]
#    trades = []

#    for row in cursor.fetchall():
#        trade = dict(zip(columns, row))
#        try:
#            trade["details"] = json.loads(trade.get("details_json", "{}")) if trade.get("details_json") else {}
#        except json.JSONDecodeError:
#            trade["details"] = {}
#        trades.append(trade)
#
#    return trades
