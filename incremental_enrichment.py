#!/usr/bin/env python3
"""
Incremental Enrichment Script
Only processes rows that haven't been enriched yet, much more efficient than full reprocessing
"""

import sqlite3
import pandas as pd
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class IncrementalEnricher:
    def __init__(self, db_path="/opt/chart_dashboard/ohlcv.db"):
        self.db_path = db_path
        self.conn = None
        self.cursor = None
        
        # Configuration
        self.movement_periods = {"1h": 60, "2h": 120, "1d": 1440}
        self.range_periods = {"15m": 15, "60m": 60, "2h": 120, "1d": 1440}
        self.timeframe_minutes = {"M1": 1, "M5": 5, "M15": 15, "H1": 60, "H4": 240, "D1": 1440}
        
    def connect_database(self):
        """Connect to SQLite database"""
        try:
            self.conn = sqlite3.connect(self.db_path)
            self.cursor = self.conn.cursor()
            logger.info(f"Connected to database: {self.db_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            return False
    
    def get_tf_minutes(self, table_name):
        """Extract timeframe and minutes from table name"""
        for tf, mins in self.timeframe_minutes.items():
            if table_name.endswith(tf):
                return tf, mins
        return None, None
    
    def ensure_enrichment_columns(self, table_name):
        """Ensure appropriate enrichment columns exist in the table based on timeframe"""
        try:
            # Get current columns
            self.cursor.execute(f"PRAGMA table_info({table_name})")
            existing_columns = [row[1] for row in self.cursor.fetchall()]
            
            # Determine what columns this table should have based on timeframe
            tf_suffix, tf_mins = self.get_tf_minutes(table_name)
            
            if tf_suffix == "D1":
                # D1 tables only get base metrics
                required_columns = ["atr_20d", "avg_volume_20d", "rvol"]
            else:
                # Intraday tables get base metrics + movement/range metrics
                required_columns = ["atr_20d", "avg_volume_20d", "rvol"]
                
                # Add movement columns for intraday
                for period in self.movement_periods:
                    required_columns.extend([f"move_{period}", f"move_{period}_atr"])
                
                # Add range columns for intraday
                for period in self.range_periods:
                    required_columns.extend([f"range_{period}", f"range_{period}_atr"])
            
            # Add missing columns (but don't remove existing ones)
            for col in required_columns:
                if col not in existing_columns:
                    self.cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {col} REAL")
                    logger.info(f"Added column {col} to {table_name}")
            
            self.conn.commit()
            return True
            
        except Exception as e:
            logger.error(f"Error ensuring columns for {table_name}: {e}")
            return False
    
    def get_enrichment_boundaries(self, table_name):
        """Find where enrichment starts and ends, intelligently detecting gaps"""
        try:
            # First, find the last enriched timestamp (if any)
            self.cursor.execute(f"""
                SELECT MAX(timestamp) 
                FROM {table_name} 
                WHERE atr_20d IS NOT NULL
            """)
            last_enriched = self.cursor.fetchone()[0]
            
            if last_enriched is None:
                # No enriched data at all - find first timestamp that could be enriched
                # (skip first ~30 rows that need buffer for 20-day calculations)
                self.cursor.execute(f"""
                    SELECT timestamp FROM {table_name} 
                    ORDER BY timestamp 
                    LIMIT 1 OFFSET 30
                """)
                first_enrichable = self.cursor.fetchone()
                
                if first_enrichable is None:
                    logger.info(f"{table_name}: Not enough data for enrichment")
                    return None, None
                
                # Find last timestamp
                self.cursor.execute(f"""
                    SELECT MAX(timestamp) FROM {table_name}
                """)
                last_timestamp = self.cursor.fetchone()[0]
                
                # Start from beginning with buffer
                self.cursor.execute(f"""
                    SELECT MIN(timestamp) FROM {table_name}
                """)
                start_timestamp = self.cursor.fetchone()[0]
                
                logger.info(f"{table_name}: No existing enrichment - will enrich from {self.format_timestamp(first_enrichable[0])} to {self.format_timestamp(last_timestamp)}")
                logger.info(f"{table_name}: Will load data from {self.format_timestamp(start_timestamp)} (with buffer)")
                
                return start_timestamp, last_timestamp
            
            # Find the first unenriched timestamp AFTER the last enriched one
            self.cursor.execute(f"""
                SELECT MIN(timestamp) 
                FROM {table_name} 
                WHERE atr_20d IS NULL 
                AND timestamp > ?
            """, (last_enriched,))
            first_unenriched = self.cursor.fetchone()[0]
            
            if first_unenriched is None:
                logger.info(f"{table_name}: All data after last enrichment is already enriched")
                return None, None
            
            # Find the last unenriched timestamp
            self.cursor.execute(f"""
                SELECT MAX(timestamp) 
                FROM {table_name} 
                WHERE atr_20d IS NULL 
                AND timestamp > ?
            """, (last_enriched,))
            last_unenriched = self.cursor.fetchone()[0]
            
            # Create buffer by going back from last_enriched to get rolling window context
            # For D1 data, we need ~30 days buffer, for intraday proportionally more
            tf_suffix, tf_mins = self.get_tf_minutes(table_name)
            if tf_suffix == "D1":
                buffer_days = 30
                buffer_minutes = buffer_days * 24 * 60
            else:
                # For intraday, we need enough data for the longest calculation (1 day = 1440 minutes)
                buffer_minutes = max(1440, tf_mins * 100)  # At least 100 bars or 1 day worth
            
            buffer_seconds = buffer_minutes * 60
            start_timestamp = max(last_enriched - buffer_seconds, 
                                self.get_table_min_timestamp(table_name))
            
            logger.info(f"{table_name}: Last enriched at {self.format_timestamp(last_enriched)}")
            logger.info(f"{table_name}: Need to enrich from {self.format_timestamp(first_unenriched)} to {self.format_timestamp(last_unenriched)}")
            logger.info(f"{table_name}: Will load data from {self.format_timestamp(start_timestamp)} (with buffer)")
            
            return start_timestamp, last_unenriched
            
        except Exception as e:
            logger.error(f"Error finding enrichment boundaries for {table_name}: {e}")
            return None, None
    
    def get_table_min_timestamp(self, table_name):
        """Get the minimum timestamp from a table"""
        try:
            self.cursor.execute(f"SELECT MIN(timestamp) FROM {table_name}")
            return self.cursor.fetchone()[0]
        except:
            return 0
    
    def format_timestamp(self, timestamp):
        """Format timestamp for display"""
        if timestamp is None:
            return "None"
        return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
    
    def enrich_d1_table(self, table_name):
        """Enrich a D1 table with base metrics"""
        logger.info(f"\n=== Enriching D1 table: {table_name} ===")
        
        # Ensure columns exist
        if not self.ensure_enrichment_columns(table_name):
            return False
        
        # Find what needs to be enriched
        start_ts, end_ts = self.get_enrichment_boundaries(table_name)
        if start_ts is None:
            return True  # Already enriched
        
        # Load data for processing
        try:
            df = pd.read_sql(f"""
                SELECT * FROM {table_name} 
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp
            """, self.conn, params=(start_ts, end_ts))
            
            if df.empty:
                logger.warning(f"No data found for {table_name}")
                return True
            
            logger.info(f"Processing {len(df)} rows for {table_name}")
            
            # Convert timestamp to datetime for easier processing
            df['dt'] = pd.to_datetime(df['timestamp'], unit='s')
            df['date'] = df['dt'].dt.date
            
            # Calculate True Range (TR) and ATR
            df['prev_close'] = df['close'].shift(1)
            df['tr'] = df[['high', 'prev_close']].max(axis=1) - df[['low', 'prev_close']].min(axis=1)
            df['atr_20d'] = df['tr'].rolling(window=20, min_periods=1).mean()
            
            # Calculate volume metrics
            df['avg_volume_20d'] = df['volume'].rolling(window=20, min_periods=1).mean()
            df['rvol'] = df['volume'] / df['avg_volume_20d']
            
            # Update only the rows that were previously NULL
            update_mask = df['timestamp'] >= pd.Timestamp(start_ts, unit='s').timestamp()
            
            for _, row in df[update_mask].iterrows():
                self.cursor.execute(f"""
                    UPDATE {table_name} 
                    SET atr_20d = ?, avg_volume_20d = ?, rvol = ? 
                    WHERE timestamp = ?
                """, (
                    float(row['atr_20d']) if pd.notnull(row['atr_20d']) else None,
                    float(row['avg_volume_20d']) if pd.notnull(row['avg_volume_20d']) else None,
                    float(row['rvol']) if pd.notnull(row['rvol']) else None,
                    int(row['timestamp'])
                ))
            
            self.conn.commit()
            logger.info(f"✅ Successfully enriched {table_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error enriching D1 table {table_name}: {e}")
            return False
    
    def enrich_intraday_table(self, table_name):
        """Enrich an intraday table with movement and range metrics"""
        logger.info(f"\n=== Enriching intraday table: {table_name} ===")
        
        tf_suffix, tf_mins = self.get_tf_minutes(table_name)
        if not tf_suffix or tf_suffix == "D1":
            logger.info(f"Skipping {table_name} - not an intraday table")
            return True
        
        # Ensure columns exist
        if not self.ensure_enrichment_columns(table_name):
            return False
        
        # Find what needs to be enriched
        start_ts, end_ts = self.get_enrichment_boundaries(table_name)
        if start_ts is None:
            return True  # Already enriched
        
        try:
            # Load data for processing
            df = pd.read_sql(f"""
                SELECT * FROM {table_name} 
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp
            """, self.conn, params=(start_ts, end_ts))
            
            if df.empty:
                logger.warning(f"No data found for {table_name}")
                return True
            
            logger.info(f"Processing {len(df)} rows for {table_name}")
            
            # Convert timestamp to datetime
            df['dt'] = pd.to_datetime(df['timestamp'], unit='s')
            df['date'] = df['dt'].dt.date
            
            # Try to get D1 metrics for ATR normalization
            d1_table = table_name.replace(f"_{tf_suffix}", "_D1")
            try:
                d1_df = pd.read_sql(f"""
                    SELECT timestamp, atr_20d, avg_volume_20d, rvol 
                    FROM {d1_table} 
                    WHERE atr_20d IS NOT NULL
                """, self.conn)
                
                if not d1_df.empty:
                    d1_df['dt'] = pd.to_datetime(d1_df['timestamp'], unit='s')
                    d1_df['date'] = d1_df['dt'].dt.date
                    
                    # Merge D1 metrics by date
                    df = df.merge(d1_df[['date', 'atr_20d', 'avg_volume_20d', 'rvol']], 
                                 on='date', how='left', suffixes=('', '_d1'))
                    
                    # Use D1 metrics for normalization
                    df['atr_20d'] = df['atr_20d_d1']
                    df['avg_volume_20d'] = df['avg_volume_20d_d1']
                    df['rvol'] = df['rvol_d1']
                    
                    logger.info(f"Merged D1 metrics for {table_name}")
                else:
                    logger.warning(f"No D1 data available for {table_name}")
                    
            except Exception as e:
                logger.warning(f"Could not load D1 data for {table_name}: {e}")
            
            # Calculate movement metrics
            for label, mins in self.movement_periods.items():
                shift = int(mins / tf_mins)
                df[f'move_{label}'] = df['close'] - df['close'].shift(shift)
                
                # ATR-normalized movement (if ATR is available)
                if 'atr_20d' in df.columns:
                    df[f'move_{label}_atr'] = df[f'move_{label}'] / df['atr_20d']
            
            # Calculate range metrics
            for label, mins in self.range_periods.items():
                window = int(mins / tf_mins)
                df[f'range_{label}'] = df['high'].rolling(window).max() - df['low'].rolling(window).min()
                
                # ATR-normalized range (if ATR is available)
                if 'atr_20d' in df.columns:
                    df[f'range_{label}_atr'] = df[f'range_{label}'] / df['atr_20d']
            
            # Prepare columns for update
            update_cols = []
            for p in self.movement_periods:
                update_cols.extend([f'move_{p}', f'move_{p}_atr'])
            for p in self.range_periods:
                update_cols.extend([f'range_{p}', f'range_{p}_atr'])
            update_cols.extend(['atr_20d', 'avg_volume_20d', 'rvol'])
            
            # Only update columns that exist in the dataframe
            valid_update_cols = [col for col in update_cols if col in df.columns]
            
            # Update only the rows that were previously NULL
            update_mask = df['timestamp'] >= pd.Timestamp(start_ts, unit='s').timestamp()
            
            for _, row in df[update_mask].iterrows():
                values = [row[c] if pd.notnull(row[c]) else None for c in valid_update_cols]
                values.append(int(row['timestamp']))
                
                sql = f"""
                    UPDATE {table_name} 
                    SET {', '.join([f'{c} = ?' for c in valid_update_cols])} 
                    WHERE timestamp = ?
                """
                self.cursor.execute(sql, values)
            
            self.conn.commit()
            logger.info(f"✅ Successfully enriched {table_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error enriching intraday table {table_name}: {e}")
            return False
    
    def run_incremental_enrichment(self, dry_run=False):
        """Run incremental enrichment on all tables"""
        if not self.connect_database():
            return False
        
        logger.info("=== Starting Incremental Enrichment ===")
        
        if dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        
        # Get all tables
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'candles_%'")
        tables = [row[0] for row in self.cursor.fetchall()]
        
        if not tables:
            logger.error("No candles tables found")
            return False
        
        logger.info(f"Found {len(tables)} tables to process")
        
        # Separate D1 and intraday tables
        d1_tables = [t for t in tables if t.endswith('_D1')]
        intraday_tables = [t for t in tables if not t.endswith('_D1')]
        
        results = {}
        
        # Process D1 tables first (they provide base metrics)
        logger.info(f"\n=== Processing {len(d1_tables)} D1 tables ===")
        for table in sorted(d1_tables):
            if dry_run:
                start_ts, end_ts = self.get_enrichment_boundaries(table)
                if start_ts:
                    logger.info(f"{table}: Would enrich from {self.format_timestamp(start_ts)} to {self.format_timestamp(end_ts)}")
                else:
                    logger.info(f"{table}: Already enriched")
                results[table] = True
            else:
                try:
                    success = self.enrich_d1_table(table)
                    results[table] = success
                except Exception as e:
                    logger.error(f"Error processing {table}: {e}")
                    results[table] = False
        
        # Process intraday tables
        logger.info(f"\n=== Processing {len(intraday_tables)} intraday tables ===")
        for table in sorted(intraday_tables):
            if dry_run:
                start_ts, end_ts = self.get_enrichment_boundaries(table)
                if start_ts:
                    logger.info(f"{table}: Would enrich from {self.format_timestamp(start_ts)} to {self.format_timestamp(end_ts)}")
                else:
                    logger.info(f"{table}: Already enriched")
                results[table] = True
            else:
                try:
                    success = self.enrich_intraday_table(table)
                    results[table] = success
                except Exception as e:
                    logger.error(f"Error processing {table}: {e}")
                    results[table] = False
        
        # Summary
        if not dry_run:
            successful = sum(1 for success in results.values() if success)
            total = len(results)
            
            logger.info(f"\n=== ENRICHMENT SUMMARY ===")
            logger.info(f"Successfully processed: {successful}/{total} tables")
            
            for table, success in results.items():
                status = "✅" if success else "❌"
                logger.info(f"{status} {table}")
        
        return True
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed")


def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Incremental enrichment of price data')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be enriched without making changes')
    parser.add_argument('--db-path', default='/opt/chart_dashboard/ohlcv.db', help='Database path')
    
    args = parser.parse_args()
    
    # Create enricher
    enricher = IncrementalEnricher(args.db_path)
    
    try:
        # Run enrichment
        success = enricher.run_incremental_enrichment(dry_run=args.dry_run)
        
        if success:
            if args.dry_run:
                logger.info("✅ Dry run completed successfully!")
            else:
                logger.info("✅ Incremental enrichment completed successfully!")
                logger.info("💡 Your database now has all the enriched metrics for backtesting!")
        else:
            logger.error("❌ Enrichment failed")
            exit(1)
            
    except KeyboardInterrupt:
        logger.info("Enrichment interrupted by user")
        exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        exit(1)
    finally:
        enricher.close()


if __name__ == "__main__":
    main()
