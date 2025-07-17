#!/usr/bin/env python3
"""
Update Price Data Script
Processes new HistData files and appends clean data to existing M1 CSV files
"""

import os
import glob
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class PriceDataUpdater:
    def __init__(self, data_dir="/opt/chart_dashboard/data", new_files_dir="/opt/chart_dashboard/data/new_files"):
        self.data_dir = data_dir
        self.new_files_dir = new_files_dir
        self.cutoff_datetime = "20250516 165800"  # Last timestamp in existing data
        
    def extract_symbol_from_filename(self, filename):
        """Extract symbol from new file naming pattern"""
        # From: May_2025_to_June_2025_EURUSD.csv
        # To: EURUSD
        basename = os.path.basename(filename)
        parts = basename.split('_')
        if len(parts) >= 6:
            symbol = parts[5].replace('.csv', '')
            return symbol
        return None
    
    def get_existing_file_path(self, symbol):
        """Get path to existing M1 CSV file"""
        return os.path.join(self.data_dir, f"{symbol}_M1.csv")
    
    def get_last_timestamp_from_existing(self, symbol):
        """Get the last timestamp from existing CSV file"""
        existing_file = self.get_existing_file_path(symbol)
        
        if not os.path.exists(existing_file):
            logger.warning(f"Existing file not found: {existing_file}")
            return None
        
        try:
            with open(existing_file, 'rb') as f:
                # Go to end of file
                f.seek(-2, os.SEEK_END)
                
                # Read backwards until we find a newline
                while f.read(1) != b'\n':
                    f.seek(-2, os.SEEK_CUR)
                
                # Read the last line
                last_line = f.readline().decode().strip()
            
            # Extract timestamp
            timestamp_str = last_line.split(';')[0]
            logger.info(f"{symbol}: Last existing timestamp = {timestamp_str}")
            return timestamp_str
            
        except Exception as e:
            logger.error(f"Error reading last timestamp for {symbol}: {e}")
            return None
    
    def filter_new_data(self, new_file_path, cutoff_timestamp):
        """Read new file and return only data after cutoff timestamp"""
        new_lines = []
        total_lines = 0
        filtered_lines = 0
        
        try:
            with open(new_file_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    
                    total_lines += 1
                    
                    # Extract timestamp from line
                    timestamp_str = line.split(';')[0]
                    
                    # Only keep data after cutoff
                    if timestamp_str > cutoff_timestamp:
                        new_lines.append(line)
                        filtered_lines += 1
            
            logger.info(f"Filtered {filtered_lines} new lines from {total_lines} total lines")
            return new_lines
            
        except Exception as e:
            logger.error(f"Error reading new file {new_file_path}: {e}")
            return []
    
    def append_data_to_existing(self, symbol, new_lines):
        """Append new data lines to existing CSV file"""
        if not new_lines:
            logger.warning(f"{symbol}: No new data to append")
            return False
        
        existing_file = self.get_existing_file_path(symbol)
        
        try:
            with open(existing_file, 'a', encoding='utf-8') as f:
                for line in new_lines:
                    f.write(line + '\n')
            
            logger.info(f"{symbol}: Successfully appended {len(new_lines)} lines")
            return True
            
        except Exception as e:
            logger.error(f"Error appending to {symbol}: {e}")
            return False
    
    def validate_data_continuity(self, symbol, new_lines):
        """Validate that new data connects properly with existing data"""
        if not new_lines:
            return True
        
        # Get last timestamp from existing file
        last_existing = self.get_last_timestamp_from_existing(symbol)
        if not last_existing:
            return False
        
        # Get first timestamp from new data
        first_new = new_lines[0].split(';')[0]
        
        # Parse timestamps
        last_dt = datetime.strptime(last_existing, "%Y%m%d %H%M%S")
        first_dt = datetime.strptime(first_new, "%Y%m%d %H%M%S")
        
        # Check if there's a reasonable gap (should be 1 minute for M1 data)
        gap_minutes = (first_dt - last_dt).total_seconds() / 60
        
        if gap_minutes < 0:
            logger.error(f"{symbol}: New data timestamp {first_new} is before last existing {last_existing}")
            return False
        elif gap_minutes > 60:  # More than 1 hour gap
            logger.warning(f"{symbol}: Large gap of {gap_minutes} minutes between existing and new data")
        else:
            logger.info(f"{symbol}: Good continuity - {gap_minutes} minute gap")
        
        return True
    
    def process_symbol(self, new_file_path):
        """Process a single symbol's new data file"""
        symbol = self.extract_symbol_from_filename(new_file_path)
        if not symbol:
            logger.error(f"Could not extract symbol from {new_file_path}")
            return False
        
        logger.info(f"\n=== Processing {symbol} ===")
        
        # Check if existing file exists
        existing_file = self.get_existing_file_path(symbol)
        if not os.path.exists(existing_file):
            logger.error(f"Existing file not found: {existing_file}")
            return False
        
        # Get cutoff timestamp from existing file
        last_timestamp = self.get_last_timestamp_from_existing(symbol)
        if not last_timestamp:
            logger.error(f"Could not determine last timestamp for {symbol}")
            return False
        
        # Filter new data (only keep data after last existing timestamp)
        new_lines = self.filter_new_data(new_file_path, last_timestamp)
        
        if not new_lines:
            logger.info(f"{symbol}: No new data to add (file may only contain historical data)")
            return True
        
        # Validate data continuity
        if not self.validate_data_continuity(symbol, new_lines):
            logger.error(f"{symbol}: Data continuity validation failed")
            return False
        
        # Show preview of what will be added
        logger.info(f"{symbol}: Will add {len(new_lines)} lines")
        logger.info(f"{symbol}: First new line: {new_lines[0]}")
        logger.info(f"{symbol}: Last new line: {new_lines[-1]}")
        
        # Append to existing file
        return self.append_data_to_existing(symbol, new_lines)
    
    def run_dry_run(self):
        """Run in dry-run mode to show what would be processed"""
        logger.info("=== DRY RUN MODE ===")
        
        # Find all new files
        pattern = os.path.join(self.new_files_dir, "May_2025_to_June_2025_*.csv")
        new_files = glob.glob(pattern)
        
        if not new_files:
            logger.error(f"No new files found in {self.new_files_dir}")
            return False
        
        logger.info(f"Found {len(new_files)} new files to process")
        
        for new_file in sorted(new_files):
            symbol = self.extract_symbol_from_filename(new_file)
            if not symbol:
                logger.warning(f"Could not extract symbol from {new_file}")
                continue
            
            existing_file = self.get_existing_file_path(symbol)
            exists = os.path.exists(existing_file)
            
            logger.info(f"{symbol}: {new_file} -> {existing_file} (exists: {exists})")
        
        return True
    
    def process_all_files(self, dry_run=False):
        """Process all new files"""
        if dry_run:
            return self.run_dry_run()
        
        logger.info("=== PROCESSING ALL FILES ===")
        
        # Find all new files
        pattern = os.path.join(self.new_files_dir, "May_2025_to_June_2025_*.csv")
        new_files = glob.glob(pattern)
        
        if not new_files:
            logger.error(f"No new files found in {self.new_files_dir}")
            return False
        
        logger.info(f"Found {len(new_files)} new files to process")
        
        results = {}
        
        for new_file in sorted(new_files):
            try:
                success = self.process_symbol(new_file)
                symbol = self.extract_symbol_from_filename(new_file)
                results[symbol] = success
            except Exception as e:
                symbol = self.extract_symbol_from_filename(new_file) or "UNKNOWN"
                logger.error(f"Error processing {new_file}: {e}")
                results[symbol] = False
        
        # Summary
        successful = sum(1 for success in results.values() if success)
        total = len(results)
        
        logger.info(f"\n=== SUMMARY ===")
        logger.info(f"Successfully processed: {successful}/{total} symbols")
        
        # Show results
        for symbol, success in results.items():
            status = "✅" if success else "❌"
            logger.info(f"{status} {symbol}")
        
        return successful == total


def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Update price data from HistData files')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be processed without making changes')
    parser.add_argument('--data-dir', default='/opt/chart_dashboard/data', help='Data directory')
    parser.add_argument('--new-files-dir', default='/opt/chart_dashboard/data/new_files', help='New files directory')
    
    args = parser.parse_args()
    
    # Create updater
    updater = PriceDataUpdater(args.data_dir, args.new_files_dir)
    
    # Process files
    success = updater.process_all_files(dry_run=args.dry_run)
    
    if success:
        logger.info("✅ All files processed successfully!")
        if not args.dry_run:
            logger.info("💡 Next step: Run resample_csvs.py to update all timeframes")
    else:
        logger.error("❌ Some files failed to process")
        exit(1)


if __name__ == "__main__":
    main()
