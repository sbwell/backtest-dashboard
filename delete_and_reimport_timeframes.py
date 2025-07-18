#!/usr/bin/env python3
"""
Delete and Re-import Timeframes Script
Deletes incorrectly timestamped data from higher timeframes and re-imports from corrected CSV files
"""

import sqlite3
import subprocess
import sys
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TimeframeReimporter:
    def __init__(self, db_path="/opt/chart_dashboard/ohlcv.db"):
        self.db_path = db_path
        self.conn = None
        self.cursor = None
        
        # July 12, 2025 00:00:00 UTC = when EODHD data started (with wrong timezone)
        # Use UTC to avoid any timezone confusion
        self.delete_from_date = datetime(2025, 7, 12, 0, 0, 0)
        self.delete_from_timestamp = int(self.delete_from_date.timestamp())
        
        logger.info(f"Will delete data from: {self.delete_from_date} (timestamp: {self.delete_from_timestamp})")
        
        # Timeframes to clean (skip M1 since it's the source data)
        self.timeframes_to_clean = ["M5", "M15", "H1", "H4", "D1"]
        
        self.currency_pairs = [
            "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD",
            "CADCHF", "CADJPY", "CHFJPY", "EURAUD", "EURCAD", 
            "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD",
            "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD",
            "NZDCAD", "NZDCHF", "NZDJPY", "NZDUSD",
            "USDCAD", "USDCHF", "USDJPY"
        ]
    
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
    
    def get_delete_info(self, table_name):
        """Get info about what will be deleted"""
        try:
            # Count total records
            self.cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            total_count = self.cursor.fetchone()[0]
            
            # Count records to be deleted
            self.cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE timestamp >= ?", (self.delete_from_timestamp,))
            delete_count = self.cursor.fetchone()[0]
            
            # Get date range of deletion
            if delete_count > 0:
                self.cursor.execute(f"""
                    SELECT 
                        datetime(MIN(timestamp), 'unixepoch') as first_delete,
                        datetime(MAX(timestamp), 'unixepoch') as last_delete
                    FROM {table_name} 
                    WHERE timestamp >= ?
                """, (self.delete_from_timestamp,))
                date_range = self.cursor.fetchone()
            else:
                date_range = (None, None)
            
            return {
                'total_count': total_count,
                'delete_count': delete_count,
                'keep_count': total_count - delete_count,
                'first_delete': date_range[0],
                'last_delete': date_range[1]
            }
            
        except Exception as e:
            logger.error(f"Error getting delete info for {table_name}: {e}")
            return None
    
    def delete_timeframe_data(self, symbol, timeframe, dry_run=False):
        """Delete incorrectly timestamped data from a specific timeframe table"""
        table_name = f"candles_{symbol}_{timeframe}"
        
        # Check if table exists
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
        if not self.cursor.fetchone():
            logger.warning(f"Table {table_name} does not exist, skipping")
            return True
        
        # Get deletion info
        info = self.get_delete_info(table_name)
        if not info:
            return False
        
        if info['delete_count'] == 0:
            logger.info(f"{table_name}: No data to delete")
            return True
        
        logger.info(f"{'[DRY RUN] ' if dry_run else ''}{table_name}:")
        logger.info(f"  Total records: {info['total_count']}")
        logger.info(f"  Will delete: {info['delete_count']} records ({info['first_delete']} to {info['last_delete']})")
        logger.info(f"  Will keep: {info['keep_count']} records")
        
        if not dry_run:
            try:
                # Delete the records
                self.cursor.execute(f"DELETE FROM {table_name} WHERE timestamp >= ?", (self.delete_from_timestamp,))
                deleted_count = self.cursor.rowcount
                
                logger.info(f"✅ Deleted {deleted_count} records from {table_name}")
                return True
                
            except Exception as e:
                logger.error(f"❌ Error deleting from {table_name}: {e}")
                return False
        
        return True
    
    def delete_all_timeframe_data(self, dry_run=False):
        """Delete incorrectly timestamped data from all higher timeframe tables"""
        logger.info(f"{'=== DRY RUN: TIMEFRAME DATA DELETION ===' if dry_run else '=== DELETING TIMEFRAME DATA ==='}")
        logger.info(f"Deleting data from {self.delete_from_date} onward (timestamp >= {self.delete_from_timestamp})")
        logger.info(f"Timeframes to clean: {', '.join(self.timeframes_to_clean)}")
        
        if not self.connect_database():
            return False
        
        results = {}
        total_tables = 0
        successful_tables = 0
        
        for symbol in self.currency_pairs:
            for timeframe in self.timeframes_to_clean:
                total_tables += 1
                success = self.delete_timeframe_data(symbol, timeframe, dry_run)
                results[f"{symbol}_{timeframe}"] = success
                if success:
                    successful_tables += 1
        
        if not dry_run:
            # Commit all deletions
            self.conn.commit()
            logger.info("💾 All deletions committed to database")
        
        self.conn.close()
        
        logger.info(f"\n{'=== DRY RUN SUMMARY ===' if dry_run else '=== DELETION SUMMARY ==='}")
        logger.info(f"Processed: {successful_tables}/{total_tables} tables")
        
        return successful_tables == total_tables
    
    def run_csv_to_db_import(self):
        """Run the CSV to database import for higher timeframes only"""
        try:
            logger.info("🔄 Running CSV to database import...")
            
            result = subprocess.run([
                sys.executable, 
                "/opt/chart_dashboard/csv_to_db_importer.py"
            ], capture_output=True, text=True, cwd="/opt/chart_dashboard")
            
            if result.returncode == 0:
                logger.info("✅ Database import completed successfully")
                return True
            else:
                logger.error(f"❌ Database import failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error running database import: {e}")
            return False
    
    def run_enrichment(self):
        """Run the incremental enrichment"""
        try:
            logger.info("🔄 Running incremental enrichment...")
            
            result = subprocess.run([
                sys.executable, 
                "/opt/chart_dashboard/incremental_enrichment.py"
            ], capture_output=True, text=True, cwd="/opt/chart_dashboard")
            
            if result.returncode == 0:
                logger.info("✅ Enrichment completed successfully")
                return True
            else:
                logger.error(f"❌ Enrichment failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error running enrichment: {e}")
            return False
    
    def run_full_cleanup_and_reimport(self, dry_run=False):
        """Run the complete cleanup and re-import process"""
        logger.info(f"{'=== DRY RUN: FULL CLEANUP & REIMPORT ===' if dry_run else '=== STARTING FULL CLEANUP & REIMPORT ==='}")
        
        try:
            # Step 1: Delete incorrectly timestamped data
            logger.info("🗑️ Step 1: Deleting incorrectly timestamped data...")
            if not self.delete_all_timeframe_data(dry_run):
                logger.error("❌ Data deletion failed")
                return False
            
            if dry_run:
                logger.info("✅ Dry run completed successfully!")
                logger.info("💡 Run without --dry-run to apply changes")
                return True
            
            # Step 2: Re-import from corrected CSV files
            logger.info("📥 Step 2: Re-importing from corrected CSV files...")
            if not self.run_csv_to_db_import():
                logger.error("❌ Database import failed")
                return False
            
            # Step 3: Re-run enrichment
            logger.info("🔢 Step 3: Re-running enrichment...")
            if not self.run_enrichment():
                logger.error("❌ Enrichment failed")
                return False
            
            logger.info("✅ Complete cleanup and re-import finished successfully!")
            logger.info("💡 Your database now has correctly timestamped data across all timeframes")
            return True
            
        except Exception as e:
            logger.error(f"❌ Full cleanup and re-import failed: {e}")
            return False


def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Delete and re-import timeframe data with correct timestamps')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be deleted without making changes')
    parser.add_argument('--delete-only', action='store_true', help='Only delete data, skip re-import and enrichment')
    parser.add_argument('--db-path', default='/opt/chart_dashboard/ohlcv.db', help='Database path')
    
    args = parser.parse_args()
    
    reimporter = TimeframeReimporter(args.db_path)
    
    try:
        if args.delete_only:
            success = reimporter.delete_all_timeframe_data(dry_run=args.dry_run)
        else:
            success = reimporter.run_full_cleanup_and_reimport(dry_run=args.dry_run)
        
        if not success:
            logger.error("Operation failed")
            sys.exit(1)
            
    except KeyboardInterrupt:
        logger.info("Operation interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
