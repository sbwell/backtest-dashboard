#!/usr/bin/env python3
"""
EODHD Daily Data Updater
Automated system to fetch forex data from EODHD and update CSV files, database, and enrichment
"""

import os
import sys
import requests
import logging
from datetime import datetime, timedelta
import time
import subprocess

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/opt/chart_dashboard/logs/eodhd_updater.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class EODHDUpdater:
    def __init__(self, api_key, data_dir="/opt/chart_dashboard/data"):
        self.api_key = api_key
        self.data_dir = data_dir
        self.base_url = "https://eodhd.com/api"
        
        # Your 28 currency pairs
        self.currency_pairs = [
            "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD",
            "CADCHF", "CADJPY", "CHFJPY", "EURAUD", "EURCAD", 
            "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD",
            "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD",
            "NZDCAD", "NZDCHF", "NZDJPY", "NZDUSD",
            "USDCAD", "USDCHF", "USDJPY"
        ]
        
        # Ensure logs directory exists
        os.makedirs("/opt/chart_dashboard/logs", exist_ok=True)
    
    def get_last_timestamp_from_csv(self, symbol):
        """Get the last timestamp from a CSV file"""
        csv_path = os.path.join(self.data_dir, f"{symbol}_M1.csv")
        
        if not os.path.exists(csv_path):
            logger.warning(f"CSV file not found: {csv_path}")
            return None
        
        try:
            with open(csv_path, 'rb') as f:
                # Go to end of file
                f.seek(-2, os.SEEK_END)
                
                # Read backwards until we find a newline
                while f.read(1) != b'\n':
                    f.seek(-2, os.SEEK_CUR)
                
                # Read the last line
                last_line = f.readline().decode().strip()
            
            # Parse the timestamp: 20250711 165800 -> datetime
            timestamp_str = last_line.split(';')[0]
            dt = datetime.strptime(timestamp_str, "%Y%m%d %H%M%S")
            
            logger.info(f"{symbol}: Last CSV timestamp = {dt}")
            return dt
            
        except Exception as e:
            logger.error(f"Error reading last timestamp for {symbol}: {e}")
            return None
    
    def is_trading_time(self, dt_est):
        """Check if datetime is during forex trading hours (EST)"""
        # Forex markets are closed:
        # - Friday 17:00 EST to Sunday 17:00 EST
        # - Some holidays (simplified for now)
        
        weekday = dt_est.weekday()  # 0=Monday, 6=Sunday
        hour = dt_est.hour
        
        if weekday == 4 and hour >= 17:  # Friday 17:00+ EST
            return False
        elif weekday == 5:  # Saturday (all day closed)
            return False
        elif weekday == 6 and hour < 17:  # Sunday before 17:00 EST
            return False
        
        return True
    
    def fetch_eodhd_data(self, symbol, start_date, end_date):
        """Fetch data from EODHD API"""
        logger.info(f"Fetching {symbol} data from {start_date} to {end_date}")
        
        # Convert to Unix timestamps
        start_timestamp = int(start_date.timestamp())
        end_timestamp = int(end_date.timestamp())
        
        url = f"{self.base_url}/intraday/{symbol}.FOREX"
        params = {
            'api_token': self.api_key,
            'interval': '1m',
            'from': start_timestamp,
            'to': end_timestamp,
            'fmt': 'json'
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            
            if response.status_code != 200:
                logger.error(f"API error for {symbol}: {response.status_code} - {response.text}")
                return None
            
            data = response.json()
            
            if not data:
                logger.warning(f"No data returned for {symbol}")
                return []
            
            logger.info(f"Fetched {len(data)} records for {symbol}")
            return data
            
        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {e}")
            return None
    
    def convert_to_csv_format(self, eodhd_data):
        """Convert EODHD data to your CSV format"""
        csv_lines = []
        
        for record in eodhd_data:
            try:
                # Parse EODHD datetime (UTC)
                dt_str = record['datetime']
                dt_utc = datetime.fromisoformat(dt_str)
                
                # Convert to EST (simplified - not handling DST transitions)
                # For production, you might want to use pytz for proper timezone handling
                est_offset = timedelta(hours=-5)
                dt_est = dt_utc + est_offset
                
                # Skip if not trading time
                if not self.is_trading_time(dt_est):
                    continue
                
                # Format like your data: YYYYMMDD HHMMSS
                formatted_dt = dt_est.strftime("%Y%m%d %H%M%S")
                
                # Get OHLC values with 6 decimal precision
                open_price = f"{float(record['open']):.6f}"
                high_price = f"{float(record['high']):.6f}"
                low_price = f"{float(record['low']):.6f}"
                close_price = f"{float(record['close']):.6f}"
                volume = int(record.get('volume', 0))
                
                # Format like your CSV: datetime;open;high;low;close;volume
                line = f"{formatted_dt};{open_price};{high_price};{low_price};{close_price};{volume}"
                csv_lines.append(line)
                
            except Exception as e:
                logger.warning(f"Error converting record: {e}")
                continue
        
        logger.info(f"Converted to {len(csv_lines)} CSV lines after filtering")
        return csv_lines
    
    def append_to_csv(self, symbol, csv_lines):
        """Append new data to CSV file, avoiding duplicates"""
        if not csv_lines:
            logger.info(f"No new data to append for {symbol}")
            return True

        csv_path = os.path.join(self.data_dir, f"{symbol}_M1.csv")
    
        try:
            # Get existing timestamps
            existing_timestamps = set()
            if os.path.exists(csv_path):
                with open(csv_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        if line.strip():
                            timestamp = line.split(';')[0]
                            existing_timestamps.add(timestamp)
        
            # Filter out duplicate timestamps
            unique_lines = []
            for line in csv_lines:
                timestamp = line.split(';')[0]
                if timestamp not in existing_timestamps:
                    unique_lines.append(line)
        
            if not unique_lines:
                logger.info(f"No new unique data to append for {symbol} (all {len(csv_lines)} lines were duplicates)")
                return True
        
            # Append only unique lines
            with open(csv_path, 'a', encoding='utf-8') as f:
                for line in unique_lines:
                    f.write(line + '\n')
        
            logger.info(f"Successfully appended {len(unique_lines)} unique lines to {symbol}_M1.csv (filtered {len(csv_lines) - len(unique_lines)} duplicates)")
            return True
        
        except Exception as e:
            logger.error(f"Error appending to {symbol} CSV: {e}")
            return False
    
    def update_single_pair(self, symbol):
        """Update a single currency pair"""
        logger.info(f"\n=== Updating {symbol} ===")
        
        # Get last timestamp from CSV
        last_csv_time = self.get_last_timestamp_from_csv(symbol)
        if not last_csv_time:
            logger.error(f"Could not determine last timestamp for {symbol}")
            return False
        
        # Calculate date range (from last CSV time to yesterday)
        start_date = last_csv_time + timedelta(minutes=1)  # Start from next minute
        end_date = datetime.now().replace(hour=23, minute=59, second=59) - timedelta(days=1)  # Yesterday
        
        # Check if we need to update
        if start_date >= end_date:
            logger.info(f"{symbol} is already up to date")
            return True
        
        logger.info(f"Need to fetch data from {start_date} to {end_date}")
        
        # Fetch data from EODHD
        eodhd_data = self.fetch_eodhd_data(symbol, start_date, end_date)
        if eodhd_data is None:
            return False
        
        if not eodhd_data:
            logger.info(f"No new data available for {symbol}")
            return True
        
        # Convert to CSV format
        csv_lines = self.convert_to_csv_format(eodhd_data)
        
        # Append to CSV file
        return self.append_to_csv(symbol, csv_lines)
    
    def run_incremental_resampling(self):
    """Run the full resampling script (more reliable for daily updates)"""
    try:
        logger.info("Running full resampling script...")
        
        result = subprocess.run([
            sys.executable, 
            "/opt/chart_dashboard/data/resample_csvs.py"
        ], capture_output=True, text=True, cwd="/opt/chart_dashboard/data")
        
        if result.returncode == 0:
            logger.info("Full resampling completed successfully")
            return True
        else:
            logger.error(f"Full resampling failed: {result.stderr}")
            return False
            
    except Exception as e:
        logger.error(f"Error running full resampling: {e}")
        return False
    
    def run_full_resampling(self):
        """Run the full resampling script (fallback method)"""
        try:
            logger.info("Running full resampling script...")
            
            # The resample script is in the data directory
            resample_script = "/opt/chart_dashboard/data/resample_csvs.py"
            
            result = subprocess.run([
                sys.executable, 
                resample_script
            ], capture_output=True, text=True, cwd="/opt/chart_dashboard/data")
            
            if result.returncode == 0:
                logger.info("Full resampling completed successfully")
                return True
            else:
                logger.error(f"Full resampling failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error running full resampling: {e}")
            return False
    
    def run_csv_to_db_import(self):
        """Run the CSV to database import"""
        try:
            logger.info("Running CSV to database import...")
            
            result = subprocess.run([
                sys.executable, 
                "/opt/chart_dashboard/csv_to_db_importer.py"
            ], capture_output=True, text=True, cwd="/opt/chart_dashboard")
            
            if result.returncode == 0:
                logger.info("Database import completed successfully")
                return True
            else:
                logger.error(f"Database import failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error running database import: {e}")
            return False
    
    def run_enrichment(self):
        """Run the incremental enrichment"""
        try:
            logger.info("Running incremental enrichment...")
            
            result = subprocess.run([
                sys.executable, 
                "/opt/chart_dashboard/incremental_enrichment.py"
            ], capture_output=True, text=True, cwd="/opt/chart_dashboard")
            
            if result.returncode == 0:
                logger.info("Enrichment completed successfully")
                return True
            else:
                logger.error(f"Enrichment failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error running enrichment: {e}")
            return False
    
    def update_all_pairs(self):
        """Update all currency pairs"""
        logger.info("=== Starting EODHD Daily Update ===")
        
        results = {}
        api_calls_made = 0
        
        for symbol in self.currency_pairs:
            try:
                success = self.update_single_pair(symbol)
                results[symbol] = success
                api_calls_made += 1
                
                # Rate limiting: respect 1000 calls/minute limit
                if api_calls_made % 50 == 0:  # Every 50 calls, pause briefly
                    time.sleep(3)
                    
            except Exception as e:
                logger.error(f"Error updating {symbol}: {e}")
                results[symbol] = False
        
        # Summary
        successful = sum(1 for success in results.values() if success)
        total = len(results)
        
        logger.info(f"\n=== UPDATE SUMMARY ===")
        logger.info(f"Successfully updated: {successful}/{total} currency pairs")
        logger.info(f"API calls made: {api_calls_made}")
        
        for symbol, success in results.items():
            status = "✅" if success else "❌"
            logger.info(f"{status} {symbol}")
        
        return successful == total
    
    def run_full_update(self):
        """Run the complete update process"""
        start_time = time.time()
        
        try:
            # Step 1: Update M1 CSV files
            logger.info("🔄 Step 1: Updating M1 CSV files...")
            if not self.update_all_pairs():
                logger.error("❌ CSV update failed")
                return False
            
            # Step 2: Incremental resample to other timeframes
            logger.info("🔄 Step 2: Incremental resampling to other timeframes...")
            if not self.run_incremental_resampling():
                logger.error("❌ Resampling failed")
                return False
            
            # Step 3: Import to database
            logger.info("🔄 Step 3: Importing to database...")
            if not self.run_csv_to_db_import():
                logger.error("❌ Database import failed")
                return False
            
            # Step 4: Run enrichment
            logger.info("🔄 Step 4: Running enrichment...")
            if not self.run_enrichment():
                logger.error("❌ Enrichment failed")
                return False
            
            total_time = time.time() - start_time
            logger.info(f"✅ Complete update finished successfully in {total_time/60:.1f} minutes")
            return True
            
        except Exception as e:
            logger.error(f"❌ Full update failed: {e}")
            return False


def main():
    """Main function for command line usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description='EODHD Daily Data Updater')
    parser.add_argument('--api-key', required=True, help='EODHD API key')
    parser.add_argument('--symbol', help='Update specific symbol only')
    parser.add_argument('--csv-only', action='store_true', help='Only update CSV files, skip database/enrichment')
    parser.add_argument('--data-dir', default='/opt/chart_dashboard/data', help='Data directory')
    
    args = parser.parse_args()
    
    # Create updater
    updater = EODHDUpdater(args.api_key, args.data_dir)
    
    try:
        if args.symbol:
            # Update single symbol
            success = updater.update_single_pair(args.symbol)
            if success:
                logger.info(f"✅ Successfully updated {args.symbol}")
            else:
                logger.error(f"❌ Failed to update {args.symbol}")
                sys.exit(1)
        elif args.csv_only:
            # Update CSV files only
            success = updater.update_all_pairs()
            if success:
                logger.info("✅ Successfully updated all CSV files")
            else:
                logger.error("❌ Failed to update CSV files")
                sys.exit(1)
        else:
            # Full update process
            success = updater.run_full_update()
            if not success:
                sys.exit(1)
                
    except KeyboardInterrupt:
        logger.info("Update interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
