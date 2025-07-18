#!/usr/bin/env python3
"""
Fix Timezone Data Script
Corrects timezone issue in recently imported data by shifting timestamps +1 hour
"""

import os
import shutil
from datetime import datetime, timedelta
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TimezoneDataFixer:
    def __init__(self, data_dir="/opt/chart_dashboard/data"):
        self.data_dir = data_dir
        self.timeframes = ["M1", "M5", "M15", "H1", "H4", "D1"]
        self.currency_pairs = [
            "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD",
            "CADCHF", "CADJPY", "CHFJPY", "EURAUD", "EURCAD", 
            "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD",
            "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD",
            "NZDCAD", "NZDCHF", "NZDJPY", "NZDUSD",
            "USDCAD", "USDCHF", "USDJPY"
        ]
        # Only fix data from July 12 onward (when we started importing EODHD data)
        self.fix_start_date = datetime(2025, 7, 12)
    
    def needs_timezone_fix(self, dt):
        """Check if this timestamp needs the timezone fix (+1 hour)"""
        return dt >= self.fix_start_date
    
    def fix_csv_file(self, symbol, timeframe, dry_run=False):
        """Fix timezone in a single CSV file"""
        csv_path = os.path.join(self.data_dir, f"{symbol}_{timeframe}.csv")
        
        if not os.path.exists(csv_path):
            logger.warning(f"File not found: {csv_path}")
            return False
        
        logger.info(f"{'[DRY RUN] ' if dry_run else ''}Processing {symbol}_{timeframe}.csv")
        
        try:
            # Read all lines
            with open(csv_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            fixed_lines = []
            fixes_made = 0
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                parts = line.split(';')
                if len(parts) < 5:
                    fixed_lines.append(line)
                    continue
                
                try:
                    # Parse timestamp
                    timestamp_str = parts[0]
                    dt = datetime.strptime(timestamp_str, "%Y%m%d %H%M%S")
                    
                    # Check if this timestamp needs fixing
                    if self.needs_timezone_fix(dt):
                        # Add 1 hour (shift EST to EDT)
                        dt_fixed = dt + timedelta(hours=1)
                        fixed_timestamp = dt_fixed.strftime("%Y%m%d %H%M%S")
                        
                        # Replace timestamp in line
                        parts[0] = fixed_timestamp
                        fixed_line = ';'.join(parts)
                        fixed_lines.append(fixed_line)
                        fixes_made += 1
                    else:
                        # Keep original line
                        fixed_lines.append(line)
                        
                except Exception as e:
                    logger.warning(f"Error processing line: {line[:50]}... - {e}")
                    fixed_lines.append(line)
                    continue
            
            if fixes_made > 0:
                logger.info(f"{'[DRY RUN] ' if dry_run else ''}Fixed {fixes_made} timestamps in {symbol}_{timeframe}")
                
                if not dry_run:
                    # Backup original file
                    backup_path = f"{csv_path}.backup_before_timezone_fix"
                    shutil.copy2(csv_path, backup_path)
                    logger.info(f"Backed up original to {backup_path}")
                    
                    # Write fixed file
                    with open(csv_path, 'w', encoding='utf-8') as f:
                        for line in fixed_lines:
                            f.write(line + '\n')
                    
                    logger.info(f"Updated {csv_path}")
            else:
                logger.info(f"No fixes needed for {symbol}_{timeframe}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error fixing {csv_path}: {e}")
            return False
    
    def fix_all_files(self, dry_run=False):
        """Fix timezone in all CSV files"""
        logger.info(f"{'=== DRY RUN MODE ===' if dry_run else '=== FIXING TIMEZONE DATA ==='}")
        logger.info(f"Will fix timestamps from {self.fix_start_date} onward (+1 hour)")
        
        results = {}
        total_files = 0
        successful_files = 0
        
        for symbol in self.currency_pairs:
            for timeframe in self.timeframes:
                total_files += 1
                success = self.fix_csv_file(symbol, timeframe, dry_run)
                results[f"{symbol}_{timeframe}"] = success
                if success:
                    successful_files += 1
        
        logger.info(f"\n{'=== DRY RUN SUMMARY ===' if dry_run else '=== FIX SUMMARY ==='}")
        logger.info(f"Processed: {successful_files}/{total_files} files")
        
        if not dry_run:
            logger.info("✅ Timezone fix completed!")
            logger.info("💡 Next steps:")
            logger.info("   1. Test your trading app to verify timestamps")
            logger.info("   2. Run database import to update SQLite with corrected data")
            logger.info("   3. Run enrichment to update calculated metrics")
        
        return successful_files == total_files


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Fix timezone data (+1 hour for July 12+ data)')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be fixed without making changes')
    parser.add_argument('--data-dir', default='/opt/chart_dashboard/data', help='Data directory')
    
    args = parser.parse_args()
    
    fixer = TimezoneDataFixer(args.data_dir)
    
    try:
        success = fixer.fix_all_files(dry_run=args.dry_run)
        
        if not success:
            logger.error("Some files failed to process")
            exit(1)
            
    except KeyboardInterrupt:
        logger.info("Fix interrupted by user")
        exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        exit(1)


if __name__ == "__main__":
    main()
