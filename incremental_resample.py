#!/usr/bin/env python3
"""
Incremental Resampling Script - FIXED VERSION
Only resamples new M1 data and appends to existing timeframe files (much faster for daily updates)
"""

import os
import pandas as pd
from datetime import datetime, timedelta
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class IncrementalResampler:
    def __init__(self, data_dir="/opt/chart_dashboard/data"):
        self.data_dir = data_dir
        
        # Timeframe configurations
        self.timeframes = {
            "M5": "5min",
            "M15": "15min", 
            "H1": "1h",
            "H4": "4h",
            "D1": "1D"
        }
        
        # Get currency pairs from existing M1 files
        self.currency_pairs = self.get_currency_pairs()
        logger.info(f"Found {len(self.currency_pairs)} currency pairs")
    
    def get_currency_pairs(self):
        """Get list of currency pairs from existing M1 files"""
        pairs = []
        try:
            m1_files = [f for f in os.listdir(self.data_dir) if f.endswith("_M1.csv")]
            pairs = [f.replace("_M1.csv", "") for f in m1_files]
            pairs.sort()
        except Exception as e:
            logger.error(f"Error getting currency pairs: {e}")
        return pairs
    
    def get_last_timestamp_from_file(self, filepath):
        """Get the last timestamp from a CSV file"""
        if not os.path.exists(filepath):
            return None
        
        try:
            with open(filepath, 'rb') as f:
                f.seek(-2, os.SEEK_END)
                while f.read(1) != b'\n':
                    f.seek(-2, os.SEEK_CUR)
                last_line = f.readline().decode().strip()
            
            timestamp_str = last_line.split(';')[0]
            dt = datetime.strptime(timestamp_str, "%Y%m%d %H%M%S")
            return dt
            
        except Exception as e:
            logger.error(f"Error reading last timestamp from {filepath}: {e}")
            return None
    
    def get_timeframe_boundary_info(self, timeframe, current_time):
        """Get information about timeframe boundaries and completion"""
        if timeframe == "M5":
            period_start = current_time.replace(minute=(current_time.minute // 5) * 5, second=0, microsecond=0)
            period_end = period_start + timedelta(minutes=5)
        elif timeframe == "M15":
            period_start = current_time.replace(minute=(current_time.minute // 15) * 15, second=0, microsecond=0)
            period_end = period_start + timedelta(minutes=15)
        elif timeframe == "H1":
            period_start = current_time.replace(minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(hours=1)
        elif timeframe == "H4":
            hour_boundary = (current_time.hour // 4) * 4
            period_start = current_time.replace(hour=hour_boundary, minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(hours=4)
        elif timeframe == "D1":
            period_start = current_time.replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = period_start + timedelta(days=1)
        else:
            raise ValueError(f"Unknown timeframe: {timeframe}")
        
        is_complete = current_time >= period_end
        
        return {
            'period_start': period_start,
            'period_end': period_end,
            'is_complete': is_complete
        }
    
    def get_last_complete_period_end(self, timeframe, current_time):
        """Get the end time of the last complete period for this timeframe"""
        boundary_info = self.get_timeframe_boundary_info(timeframe, current_time)
        
        if boundary_info['is_complete']:
            return boundary_info['period_end']
        else:
            return boundary_info['period_start']
    
    def should_update_timeframe(self, symbol, timeframe, last_tf_timestamp, latest_m1_timestamp):
        """Determine if we should update this timeframe and how"""
        last_complete_period_end = self.get_last_complete_period_end(timeframe, latest_m1_timestamp)
        
        if last_tf_timestamp >= last_complete_period_end:
            logger.info(f"{symbol}_{timeframe}: No new complete periods")
            return "skip", None, None
        
        from_time = last_tf_timestamp
        to_time = last_complete_period_end
        
        logger.info(f"{symbol}_{timeframe}: Will process complete periods from {from_time} to {to_time}")
        return "append", from_time, to_time
    
    def load_m1_data_for_timeframe_update(self, symbol, from_timestamp, to_timestamp):
        """Load M1 data for a specific time range to update timeframes"""
        m1_file = os.path.join(self.data_dir, f"{symbol}_M1.csv")
        
        if not os.path.exists(m1_file):
            logger.error(f"M1 file not found: {m1_file}")
            return None
        
        try:
            df = pd.read_csv(
                m1_file,
                sep=";",
                header=None,
                names=["datetime", "open", "high", "low", "close", "volume"],
                dtype={"datetime": str, "open": float, "high": float, "low": float, "close": float, "volume": int}
            )
            
            df["datetime"] = pd.to_datetime(df["datetime"], format="%Y%m%d %H%M%S")
            df = df[(df["datetime"] > from_timestamp) & (df["datetime"] <= to_timestamp)]
            
            if df.empty:
                return None
            
            df.set_index("datetime", inplace=True)
            logger.info(f"{symbol}: Loaded {len(df)} M1 records for timeframe update")
            return df
            
        except Exception as e:
            logger.error(f"Error loading M1 data for {symbol}: {e}")
            return None
    
    def resample_to_timeframe(self, m1_data, timeframe_rule):
        """Resample M1 data to a specific timeframe"""
        try:
            df_resampled = m1_data.resample(timeframe_rule).agg({
                "open": "first",
                "high": "max", 
                "low": "min",
                "close": "last",
                "volume": "sum"
            }).dropna()
            
            return df_resampled
            
        except Exception as e:
            logger.error(f"Error resampling to {timeframe_rule}: {e}")
            return None
    
    def append_to_timeframe_file(self, symbol, timeframe, resampled_data):
        """Append resampled data to existing timeframe file"""
        if resampled_data is None or resampled_data.empty:
            return True
        
        timeframe_file = os.path.join(self.data_dir, f"{symbol}_{timeframe}.csv")
        
        try:
            csv_lines = []
            for timestamp, row in resampled_data.iterrows():
                formatted_dt = timestamp.strftime("%Y%m%d %H%M%S")
                line = f"{formatted_dt};{row['open']:.6f};{row['high']:.6f};{row['low']:.6f};{row['close']:.6f};{int(row['volume'])}"
                csv_lines.append(line)
            
            with open(timeframe_file, 'a', encoding='utf-8') as f:
                for line in csv_lines:
                    f.write(line + '\n')
            
            logger.info(f"{symbol}_{timeframe}: Appended {len(csv_lines)} records")
            return True
            
        except Exception as e:
            logger.error(f"Error appending to {timeframe_file}: {e}")
            return False
    
    def process_symbol_timeframe(self, symbol, timeframe, timeframe_rule):
        """Process a single symbol-timeframe combination with proper boundary handling"""
        timeframe_file = os.path.join(self.data_dir, f"{symbol}_{timeframe}.csv")
        m1_file = os.path.join(self.data_dir, f"{symbol}_M1.csv")
        
        last_tf_timestamp = self.get_last_timestamp_from_file(timeframe_file)
        if last_tf_timestamp is None:
            logger.warning(f"{symbol}_{timeframe}: File missing or empty, skipping")
            return False
        
        latest_m1_timestamp = self.get_last_timestamp_from_file(m1_file)
        if latest_m1_timestamp is None:
            logger.error(f"{symbol}: M1 file missing or empty")
            return False
        
        action, from_time, to_time = self.should_update_timeframe(symbol, timeframe, last_tf_timestamp, latest_m1_timestamp)
        
        if action == "skip":
            return True
        elif action == "append":
            m1_data = self.load_m1_data_for_timeframe_update(symbol, from_time, to_time)
            
            if m1_data is None or m1_data.empty:
                return True
            
            resampled_data = self.resample_to_timeframe(m1_data, timeframe_rule)
            
            if resampled_data is None or resampled_data.empty:
                return True
            
            # Filter to only complete periods
            complete_periods = []
            for timestamp, row in resampled_data.iterrows():
                boundary_info = self.get_timeframe_boundary_info(timeframe, timestamp + timedelta(minutes=1))
                if timestamp < boundary_info['period_start']:
                    complete_periods.append((timestamp, row))
            
            if not complete_periods:
                logger.info(f"{symbol}_{timeframe}: No complete periods to append")
                return True
            
            complete_df = pd.DataFrame([row for _, row in complete_periods], 
                                     index=[ts for ts, _ in complete_periods])
            
            return self.append_to_timeframe_file(symbol, timeframe, complete_df)
        
        return False
    
    def process_symbol(self, symbol):
        """Process all timeframes for a single symbol"""
        logger.info(f"\n=== Processing {symbol} ===")
        
        results = {}
        
        for timeframe, timeframe_rule in self.timeframes.items():
            try:
                success = self.process_symbol_timeframe(symbol, timeframe, timeframe_rule)
                results[timeframe] = success
                
                if not success:
                    logger.warning(f"{symbol}_{timeframe}: Failed to process")
                    
            except Exception as e:
                logger.error(f"Error processing {symbol}_{timeframe}: {e}")
                results[timeframe] = False
        
        successful = sum(1 for success in results.values() if success)
        total = len(results)
        
        if successful == total:
            logger.info(f"✅ {symbol}: All {total} timeframes updated")
        else:
            logger.warning(f"⚠️ {symbol}: {successful}/{total} timeframes updated")
        
        return successful == total
    
    def run_incremental_resample(self, symbols=None):
        """Run incremental resampling for specified symbols or all symbols"""
        if symbols is None:
            symbols = self.currency_pairs
        elif isinstance(symbols, str):
            symbols = [symbols]
        
        logger.info("=== Starting Incremental Resampling ===")
        logger.info(f"Processing {len(symbols)} symbols: {', '.join(symbols)}")
        logger.info(f"Timeframes: {', '.join(self.timeframes.keys())}")
        
        results = {}
        
        for symbol in symbols:
            if symbol not in self.currency_pairs:
                logger.warning(f"Symbol {symbol} not found in available pairs")
                continue
                
            try:
                success = self.process_symbol(symbol)
                results[symbol] = success
                
            except Exception as e:
                logger.error(f"Error processing symbol {symbol}: {e}")
                results[symbol] = False
        
        successful_symbols = sum(1 for success in results.values() if success)
        total_symbols = len(results)
        
        logger.info(f"\n=== INCREMENTAL RESAMPLING SUMMARY ===")
        logger.info(f"Successfully processed: {successful_symbols}/{total_symbols} symbols")
        
        for symbol, success in results.items():
            status = "✅" if success else "❌"
            logger.info(f"{status} {symbol}")
        
        if successful_symbols == total_symbols:
            logger.info("✅ Incremental resampling completed successfully!")
        else:
            logger.warning(f"⚠️ Some symbols failed to process completely")
        
        return successful_symbols == total_symbols
    
    def get_resampling_stats(self):
        """Get statistics about what would be resampled"""
        logger.info("=== Resampling Statistics ===")
        
        for symbol in self.currency_pairs[:3]:
            logger.info(f"\n{symbol}:")
            
            m1_file = os.path.join(self.data_dir, f"{symbol}_M1.csv")
            m1_last = self.get_last_timestamp_from_file(m1_file)
            
            if not m1_last:
                logger.info(f"  M1 file missing or empty")
                continue
            
            for timeframe in self.timeframes.keys():
                tf_file = os.path.join(self.data_dir, f"{symbol}_{timeframe}.csv")
                tf_last = self.get_last_timestamp_from_file(tf_file)
                
                if tf_last:
                    last_complete_period_end = self.get_last_complete_period_end(timeframe, m1_last)
                    
                    if tf_last >= last_complete_period_end:
                        logger.info(f"  {timeframe}: Up to date (no complete periods)")
                    else:
                        time_diff = last_complete_period_end - tf_last
                        if timeframe == "M5":
                            periods = int(time_diff.total_seconds() / 300)
                        elif timeframe == "M15":
                            periods = int(time_diff.total_seconds() / 900)
                        elif timeframe == "H1":
                            periods = int(time_diff.total_seconds() / 3600)
                        elif timeframe == "H4":
                            periods = int(time_diff.total_seconds() / 14400)
                        elif timeframe == "D1":
                            periods = int(time_diff.total_seconds() / 86400)
                        
                        logger.info(f"  {timeframe}: Would add ~{periods} complete periods")
                else:
                    logger.info(f"  {timeframe}: File missing")


def main():
    """Main function for command line usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Incremental resampling of forex data')
    parser.add_argument('--symbol', help='Process specific symbol only')
    parser.add_argument('--stats', action='store_true', help='Show resampling statistics without processing')
    parser.add_argument('--data-dir', default='/opt/chart_dashboard/data', help='Data directory')
    
    args = parser.parse_args()
    
    try:
        resampler = IncrementalResampler(args.data_dir)
        
        if args.stats:
            resampler.get_resampling_stats()
        elif args.symbol:
            success = resampler.run_incremental_resample([args.symbol])
            if not success:
                exit(1)
        else:
            success = resampler.run_incremental_resample()
            if not success:
                exit(1)
                
    except KeyboardInterrupt:
        logger.info("Resampling interrupted by user")
        exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        exit(1)


if __name__ == "__main__":
    main()
