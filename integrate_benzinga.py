#!/usr/bin/env python3
"""
Benzinga to Research Dashboard Integration Script
Transforms 71k benzinga guidance records into your existing research dashboard format
"""

import sqlite3
import json
from datetime import datetime, timedelta
import sys
import os

def connect_databases():
    """Connect to both benzinga and main backtests databases"""
    try:
        # Connect to benzinga database (correct path)
        benzinga_conn = sqlite3.connect("/opt/benzinga_tracker/instance/benzinga.db")
        
        # Connect to main backtests database  
        backtests_conn = sqlite3.connect("/opt/chart_dashboard/backtests.db")
        
        return benzinga_conn, backtests_conn
    except Exception as e:
        print(f"❌ Database connection error: {e}")
        sys.exit(1)

def inspect_benzinga_database():
    """Inspect benzinga database structure to find the correct table"""
    try:
        benzinga_conn = sqlite3.connect("/opt/benzinga_tracker/instance/benzinga.db")
        cursor = benzinga_conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print("📋 Available tables in benzinga database:")
        for table in tables:
            print(f"   - {table[0]}")
            
        # Check each table structure
        for table in tables:
            table_name = table[0]
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            
            print(f"\n📊 Table '{table_name}' structure:")
            for col in columns:
                print(f"   - {col[1]} ({col[2]})")
            
            # Show sample data
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            print(f"   📈 {count} records")
            
            if count > 0:
                cursor.execute(f"SELECT * FROM {table_name} LIMIT 3")
                sample_rows = cursor.fetchall()
                print(f"   📝 Sample data:")
                for i, row in enumerate(sample_rows[:1]):  # Just show first row
                    print(f"      Row {i+1}: {row[:5]}...")  # Show first 5 columns
        
        benzinga_conn.close()
        return tables
        
    except Exception as e:
        print(f"❌ Error inspecting database: {e}")
        return []

def create_benzinga_backtest_entry(backtests_conn):
    """Create a backtest entry for benzinga guidance strategy"""
    cursor = backtests_conn.cursor()
    
    # Check if benzinga backtest already exists
    cursor.execute("SELECT id FROM backtests WHERE strategy = 'Benzinga Guidance'")
    existing = cursor.fetchone()
    
    if existing:
        print(f"✅ Benzinga backtest already exists with ID: {existing[0]}")
        return existing[0]
    
    # First, inspect the database to find the correct table
    print("🔍 Inspecting benzinga database...")
    tables = inspect_benzinga_database()
    
    if not tables:
        print("❌ No tables found in benzinga database!")
        return None
    
    # Try to find the correct table name (it might be named differently)
    table_candidates = [t[0] for t in tables if 'guidance' in t[0].lower() or 'benzinga' in t[0].lower() or len(tables) == 1]
    
    if not table_candidates:
        print("❌ Could not identify the correct table. Available tables:")
        for table in tables:
            print(f"   - {table[0]}")
        print("Please check the table name and update the script.")
        return None
    
    # Use the first candidate table
    table_name = table_candidates[0]
    print(f"📊 Using table: {table_name}")
    
    # Get stats from benzinga data
    benzinga_conn = sqlite3.connect("/opt/benzinga_tracker/instance/benzinga.db")
    bz_cursor = benzinga_conn.cursor()
    
    # Get data range and count - try different column names
    try:
        bz_cursor.execute(f"""
            SELECT 
                COUNT(*) as total_records,
                MIN(trade_date) as earliest_date,
                MAX(trade_date) as latest_date,
                AVG(long_profit) as avg_long_profit,
                AVG(short_profit) as avg_short_profit,
                COUNT(CASE WHEN long_profit > 0 THEN 1 END) as long_wins,
                COUNT(CASE WHEN short_profit > 0 THEN 1 END) as short_wins
            FROM {table_name}
        """)
    except sqlite3.OperationalError as e:
        print(f"❌ Error querying {table_name}: {e}")
        print("Please check the column names in your benzinga table.")
        benzinga_conn.close()
        return None
    
    stats = bz_cursor.fetchone()
    if not stats or not stats[0]:
        print("❌ No benzinga data found!")
        return None
        
    total_records, earliest_date, latest_date, avg_long_profit, avg_short_profit, long_wins, short_wins = stats
    
    # Calculate win rates
    long_win_rate = (long_wins / total_records) * 100 if total_records > 0 else 0
    short_win_rate = (short_wins / total_records) * 100 if total_records > 0 else 0
    
    # Use better performing strategy for summary stats
    if avg_long_profit > avg_short_profit:
        win_rate = long_win_rate
        profit = avg_long_profit
        strategy_bias = "long"
    else:
        win_rate = short_win_rate  
        profit = avg_short_profit
        strategy_bias = "short"
    
    settings = {
        "source": "benzinga",
        "type": "guidance",
        "strategy_bias": strategy_bias,
        "long_win_rate": long_win_rate,
        "short_win_rate": short_win_rate,
        "avg_long_profit": avg_long_profit,
        "avg_short_profit": avg_short_profit,
        "description": "Earnings guidance announcements with OHLCV trading data"
    }
    
    # Insert benzinga backtest entry
    cursor.execute("""
        INSERT INTO backtests (
            symbol, strategy, run_name, start_date, end_date, 
            timestamp, win_rate, profit, trade_count, settings_json, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        'MULTI',  # Multiple symbols
        'Benzinga Guidance',
        'Earnings Guidance Analysis',
        earliest_date,
        latest_date,
        datetime.now().isoformat(),
        round(win_rate, 2),
        round(profit, 4),
        total_records,
        json.dumps(settings),
        'system'
    ))
    
    backtest_id = cursor.lastrowid
    backtests_conn.commit()
    
    print(f"✅ Created benzinga backtest entry with ID: {backtest_id}")
    print(f"📊 Stats: {total_records} records, {win_rate:.1f}% win rate, {profit:.2f}% avg profit")
    
    benzinga_conn.close()
    return backtest_id

def transform_benzinga_to_trades(benzinga_conn, backtests_conn, backtest_id, strategy='auto'):
    """Transform benzinga guidance data to trades format"""
    
    # Clear existing benzinga trades
    cursor = backtests_conn.cursor()
    cursor.execute("DELETE FROM trades WHERE backtest_id = ?", (backtest_id,))
    
    # Get benzinga data - using 'ticker' instead of 'symbol' based on schema
    bz_cursor = benzinga_conn.cursor()
    bz_cursor.execute("""
        SELECT 
            ticker as symbol, trade_date, open_price, close_price, 
            long_profit, short_profit, gap_amount, gap_percent,
            eps_guidance_est, revenue_guidance_est,
            previous_close, volume, atr, high_price, low_price
        FROM guidance 
        WHERE trade_date IS NOT NULL 
            AND open_price IS NOT NULL 
            AND close_price IS NOT NULL
        ORDER BY trade_date DESC
    """)
    
    trades_data = []
    processed_count = 0
    
    for row in bz_cursor.fetchall():
        (symbol, trade_date, open_price, close_price, 
         long_profit, short_profit, gap_amount, gap_percent,
         eps_guidance, revenue_guidance, previous_close, volume, atr, high_price, low_price) = row
        
        # Determine strategy to use
        if strategy == 'auto':
            # Use the better performing strategy for this trade
            if long_profit is not None and short_profit is not None:
                if abs(long_profit) > abs(short_profit):
                    use_long = long_profit > 0
                else:
                    use_long = short_profit < 0  # If short profit is negative, use long
            else:
                use_long = True  # Default to long
        elif strategy == 'long':
            use_long = True
        else:
            use_long = False
        
        # Set trade parameters based on strategy
        if use_long:
            entry_price = open_price
            exit_price = close_price
            pnl = long_profit
            side = 'long'
        else:
            entry_price = open_price  
            exit_price = close_price
            pnl = short_profit
            side = 'short'
        
        # Calculate exit time (next trading day)
        try:
            entry_dt = datetime.strptime(trade_date, '%Y-%m-%d')
            # Add 1 day for exit (could be enhanced to skip weekends)
            exit_dt = entry_dt + timedelta(days=1)
            exit_time = exit_dt.strftime('%Y-%m-%d')
        except:
            exit_time = trade_date
        
        # Create additional trade metadata
        tags = []
        if gap_percent and abs(gap_percent) > 2:
            tags.append(f"gap_{gap_percent:.1f}%")
        if eps_guidance:
            tags.append(f"eps_guidance")
        if revenue_guidance:
            tags.append(f"revenue_guidance")
        
        notes = {
            "gap_amount": gap_amount,
            "gap_percent": gap_percent,
            "eps_guidance": eps_guidance,
            "revenue_guidance": revenue_guidance,
            "volume": volume,
            "atr": atr,
            "previous_close": previous_close,
            "high_price": high_price,
            "low_price": low_price
        }
        
        trade_data = (
            backtest_id,
            symbol,
            trade_date,      # entry_time
            exit_time,       # exit_time  
            entry_price,
            exit_price,
            pnl,
            1,               # duration_bars (1 day)
            side,
            ','.join(tags) if tags else None,
            json.dumps(notes)
        )
        
        trades_data.append(trade_data)
        processed_count += 1
        
        # Batch insert every 1000 records
        if len(trades_data) >= 1000:
            cursor.executemany("""
                INSERT INTO trades (
                    backtest_id, symbol, entry_time, exit_time, 
                    entry_price, exit_price, pnl, duration_bars, 
                    side, tags, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, trades_data)
            backtests_conn.commit()
            print(f"📦 Inserted {processed_count} trades...")
            trades_data = []
    
    # Insert remaining trades
    if trades_data:
        cursor.executemany("""
            INSERT INTO trades (
                backtest_id, symbol, entry_time, exit_time, 
                entry_price, exit_price, pnl, duration_bars, 
                side, tags, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, trades_data)
        backtests_conn.commit()
    
    print(f"✅ Successfully transformed {processed_count} benzinga records to trades format")
    return processed_count

def update_backtest_stats(backtests_conn, backtest_id):
    """Update backtest statistics based on inserted trades"""
    cursor = backtests_conn.cursor()
    
    # Calculate updated stats
    cursor.execute("""
        SELECT 
            COUNT(*) as total_trades,
            COUNT(CASE WHEN pnl > 0 THEN 1 END) as winning_trades,
            AVG(pnl) as avg_pnl,
            SUM(pnl) as total_pnl
        FROM trades 
        WHERE backtest_id = ?
    """, (backtest_id,))
    
    stats = cursor.fetchone()
    if stats and stats[0] > 0:
        total_trades, winning_trades, avg_pnl, total_pnl = stats
        win_rate = (winning_trades / total_trades) * 100
        
        # Update backtest entry
        cursor.execute("""
            UPDATE backtests 
            SET win_rate = ?, profit = ?, trade_count = ?
            WHERE id = ?
        """, (round(win_rate, 2), round(avg_pnl, 4), total_trades, backtest_id))
        
        backtests_conn.commit()
        print(f"📊 Updated backtest stats: {win_rate:.1f}% win rate, {avg_pnl:.2f}% avg profit")

def main():
    """Main integration function"""
    print("🚀 Starting Benzinga → Research Dashboard Integration")
    print("=" * 60)
    
    # Connect to databases
    benzinga_conn, backtests_conn = connect_databases()
    
    try:
        # Step 1: Create benzinga backtest entry
        print("\n1️⃣ Creating Benzinga backtest entry...")
        backtest_id = create_benzinga_backtest_entry(backtests_conn)
        
        if not backtest_id:
            print("❌ Failed to create backtest entry")
            return
        
        # Step 2: Transform benzinga data to trades
        print(f"\n2️⃣ Transforming benzinga data to trades format...")
        trades_count = transform_benzinga_to_trades(
            benzinga_conn, backtests_conn, backtest_id, strategy='auto'
        )
        
        # Step 3: Update backtest statistics
        print(f"\n3️⃣ Updating backtest statistics...")
        update_backtest_stats(backtests_conn, backtest_id)
        
        print("\n" + "=" * 60)
        print("✅ INTEGRATION COMPLETE!")
        print(f"📦 Backtest ID: {backtest_id}")
        print(f"📊 Trades Created: {trades_count}")
        print(f"🎯 Strategy: Benzinga Guidance")
        print("\n🎉 Your benzinga data is now available in your research dashboard!")
        print("   Go to quantapp.xyz/research and select 'Benzinga Guidance' from the dropdown")
        
    except Exception as e:
        print(f"❌ Integration failed: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        benzinga_conn.close()
        backtests_conn.close()

if __name__ == "__main__":
    main()
