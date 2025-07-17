#!/usr/bin/env python3
"""
CSV to Database Importer
Automatically imports missing price data from CSV files to SQLite database
"""

import os
import sqlite3
import glob
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CSVToDatabaseImporter:
    def __init__(self, data_dir="/opt/chart_dashboard/data", db_path="/opt/chart_dashboard/ohlcv.db"):
        self.data_dir = data_dir
        self.db_path = db_path
        self.conn = None
        self.cursor = None
        
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
    
    def get_database_tables(self):
        """Get all candles tables from database"""
        try:
            self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'candles_%'")
            tables = [row[0] for row in self.cursor.fetchall()]
            logger.info(f"Found {len(tables)} candles tables in database")
            return tables
        except Exception as e:
            logger.error(f"Error getting database tables: {e}")
            return []
    
    def extract_symbol_and_timeframe(self, table_name):
        """Extract symbol and timeframe from table name: candles_EURUSD_M1 -> (EURUSD, M1)"""
        parts = table_name.replace('candles_', '').rsplit('_', 1)
        if len(parts) == 2:
            return parts[0], parts[1]
        return None, None
    
    def get_last_timestamp(self, table_name):
        """Get last timestamp from database table"""
        try:
            self.cursor.execute(f"SELECT timestamp FROM {table_name} ORDER BY timestamp DESC LIMIT 1")
            result = self.cursor.fetchone()
            if result:
                return result[0]
            else:
                logger.warning(f"Table {table_name} is empty")
                return None
        except Exception as e:
            logger.error(f"Error getting last timestamp from {table_name}: {e}")
            return None
    
    def ensure_table_structure(self, table_name):
        """Ensure table has the correct structure"""
        try:
            # Get current columns
            self.cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [row[1] for row in self.cursor.fetchall()]
            
            # Required columns for basic OHLCV data
            required_columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
            
            # Check if all required columns exist
            missing_columns = [col for col in required_columns if col not in columns]
            
            if missing_columns:
                logger.warning(f"Table {table_name} missing columns: {missing_columns}")
                # You might want to create the table or add columns here
                return False
            
            return True
        except Exception as e:
            logger.error(f"Error checking table structure for {table_name}: {e}")
            return False
    
    def read_csv_from_timestamp(self, csv_path, after_timestamp):
        """Read CSV file from a specific timestamp forward"""
        new_records = []
        
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    
                    try:
                        # Parse line: 20250516 165800;1.115360;1.115420;1.115260;1.115320;0
                        parts = line.split(';')
                        if len(parts) < 5:
                            logger.warning(f"Invalid line format in {csv_path}:{line_num}: {line}")
                            continue
                        
                        datetime_str = parts[0]
                        open_price = float(parts[1])
                        high_price = float(parts[2])
                        low_price = float(parts[3])
                        close_price = float(parts[4])
                        volume = int(parts[5]) if len(parts) > 5 else 0  # Default to 0 if no volume
                        
                        # Convert datetime to timestamp
                        dt = datetime.strptime(datetime_str, "%Y%m%d %H%M%S")
                        timestamp = int(dt.timestamp())
                        
                        # Only include records after the cutoff timestamp
                        if after_timestamp is None or timestamp > after_timestamp:
                            new_records.append((
                                timestamp,
                                open_price,
                                high_price,
                                low_price,
                                close_price,
                                volume
                            ))
                    
                    except (ValueError, IndexError) as e:
                        logger.warning(f"Error parsing line {line_num} in {csv_path}: {e}")
                        continue
            
            logger.info(f"Found {len(new_records)} new records in {csv_path}")
            return new_records
        
        except Exception as e:
            logger.error(f"Error reading CSV file {csv_path}: {e}")
            return []
    
    def insert_records(self, table_name, records):
        """Insert records into database table"""
        if not records:
            return True
        
        try:
            insert_sql = f"""
                INSERT OR REPLACE INTO {table_name} 
                (timestamp, open, high, low, close, volume) 
                VALUES (?, ?, ?, ?, ?, ?)
            """
            
            self.cursor.executemany(insert_sql, records)
            self.conn.commit()
            
            logger.info(f"Inserted {len(records)} records into {table_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error inserting records into {table_name}: {e}")
            return False
    
    def format_timestamp(self, timestamp):
        """Format timestamp for display"""
        if timestamp is None:
            return "No data"
        return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
    
    def process_symbol(self, table_name):
        """Process a single symbol (table)"""
        symbol, timeframe = self.extract_symbol_and_timeframe(table_name)
        if not symbol or not timeframe:
            logger.error(f"Could not extract symbol/timeframe from {table_name}")
            return False
            
        csv_path = os.path.join(self.data_dir, f"{symbol}_{timeframe}.csv")
        
        logger.info(f"\n=== Processing {symbol} {timeframe} ===")
        
        # Check if CSV file exists
        if not os.path.exists(csv_path):
            logger.error(f"CSV file not found: {csv_path}")
            return False
        
        # Ensure table structure is correct
        if not self.ensure_table_structure(table_name):
            logger.error(f"Table structure check failed for {table_name}")
            return False
        
        # Get last timestamp from database
        last_timestamp = self.get_last_timestamp(table_name)
        logger.info(f"Last DB timestamp: {self.format_timestamp(last_timestamp)}")
        
        # Read new records from CSV
        new_records = self.read_csv_from_timestamp(csv_path, last_timestamp)
        
        if not new_records:
            logger.info(f"No new data to import for {symbol} {timeframe}")
            return True
        
        # Show what will be imported
        first_new_ts = new_records[0][0]
        last_new_ts = new_records[-1][0]
        
        logger.info(f"Will import {len(new_records)} records")
        logger.info(f"From: {self.format_timestamp(first_new_ts)}")
        logger.info(f"To:   {self.format_timestamp(last_new_ts)}")
        
        # Insert records
        success = self.insert_records(table_name, new_records)
        
        if success:
            logger.info(f"✅ Successfully updated {symbol} {timeframe}")
        else:
            logger.error(f"❌ Failed to update {symbol} {timeframe}")
        
        return success
    
    def run_import(self, dry_run=False):
        """Run the import process for all symbols"""
        if not self.connect_database():
            return False
        
        logger.info("=== Starting CSV to Database Import ===")
        
        if dry_run:
            logger.info("DRY RUN MODE - No changes will be made")
        
        # Get all database tables
        tables = self.get_database_tables()
        if not tables:
            logger.error("No candles tables found in database")
            return False
        
        results = {}
        
        for table_name in sorted(tables):
            if dry_run:
                symbol, timeframe = self.extract_symbol_and_timeframe(table_name)
                if not symbol or not timeframe:
                    continue
                    
                csv_path = os.path.join(self.data_dir, f"{symbol}_{timeframe}.csv")
                last_timestamp = self.get_last_timestamp(table_name)
                
                logger.info(f"{symbol} {timeframe}: DB={self.format_timestamp(last_timestamp)}, CSV exists={os.path.exists(csv_path)}")
                results[f"{symbol}_{timeframe}"] = True
            else:
                try:
                    success = self.process_symbol(table_name)
                    symbol, timeframe = self.extract_symbol_and_timeframe(table_name)
                    if symbol and timeframe:
                        results[f"{symbol}_{timeframe}"] = success
                except Exception as e:
                    symbol, timeframe = self.extract_symbol_and_timeframe(table_name)
                    symbol_tf = f"{symbol}_{timeframe}" if symbol and timeframe else table_name
                    logger.error(f"Error processing {symbol_tf}: {e}")
                    results[symbol_tf] = False
        
        # Summary
        if not dry_run:
            successful = sum(1 for success in results.values() if success)
            total = len(results)
            
            logger.info(f"\n=== IMPORT SUMMARY ===")
            logger.info(f"Successfully processed: {successful}/{total} symbol-timeframe combinations")
            
            for symbol_tf, success in results.items():
                status = "✅" if success else "❌"
                logger.info(f"{status} {symbol_tf}")
        
        return True
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed")

def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Import CSV data to SQLite database')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be imported without making changes')
    parser.add_argument('--data-dir', default='/opt/chart_dashboard/data', help='Data directory')
    parser.add_argument('--db-path', default='/opt/chart_dashboard/ohlcv.db', help='Database path')
    
    args = parser.parse_args()
    
    # Create importer
    importer = CSVToDatabaseImporter(args.data_dir, args.db_path)
    
    try:
        # Run import
        success = importer.run_import(dry_run=args.dry_run)
        
        if success:
            if args.dry_run:
                logger.info("✅ Dry run completed successfully!")
            else:
                logger.info("✅ Import completed successfully!")
                logger.info("💡 Next step: Run enrichment scripts to add calculated metrics")
        else:
            logger.error("❌ Import failed")
            exit(1)
            
    except KeyboardInterrupt:
        logger.info("Import interrupted by user")
        exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        exit(1)
    finally:
        importer.close()

if __name__ == "__main__":
    main()
