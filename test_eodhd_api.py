#!/usr/bin/env python3
"""
EODHD API Test Script
Tests the EODHD forex API to understand their data format
"""

import requests
import json
from datetime import datetime, timedelta
import pandas as pd

class EODHDTester:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://eodhd.com/api"
    
    def test_forex_intraday(self, symbol="EURUSD", period="1m", days_back=1):
        """Test intraday forex data"""
        print(f"🔍 Testing EODHD API for {symbol} {period} data...")
        
        # Calculate date range (test last few days)
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        
        # Convert to Unix timestamps (EODHD expects numbers)
        start_timestamp = int(datetime.combine(start_date, datetime.min.time()).timestamp())
        end_timestamp = int(datetime.combine(end_date, datetime.min.time()).timestamp())
        
        # EODHD intraday endpoint
        url = f"{self.base_url}/intraday/{symbol}.FOREX"
        
        params = {
            'api_token': self.api_key,
            'interval': period,
            'from': start_timestamp,
            'to': end_timestamp,
            'fmt': 'json'
        }
        
        print(f"📡 Fetching data from {start_date} to {end_date}")
        print(f"📊 Timestamps: {start_timestamp} to {end_timestamp}")
        print(f"🔗 URL: {url}")
        print(f"📋 Params: {params}")
        
        try:
            response = requests.get(url, params=params)
            
            print(f"\n📊 Response Status: {response.status_code}")
            print(f"📏 Response Length: {len(response.text)} characters")
            
            if response.status_code != 200:
                print(f"❌ Error: {response.status_code}")
                print(f"Response: {response.text}")
                return None
            
            data = response.json()
            
            if not data:
                print("⚠️ No data returned")
                return None
            
            print(f"✅ Received {len(data)} data points")
            
            # Show sample data structure
            print(f"\n📋 Sample Data Structure:")
            for i, record in enumerate(data[:3]):  # Show first 3 records
                print(f"Record {i+1}: {json.dumps(record, indent=2)}")
            
            # Analyze the data
            self.analyze_data_format(data, symbol)
            
            return data
            
        except Exception as e:
            print(f"❌ Error fetching data: {e}")
            return None
    
    def analyze_data_format(self, data, symbol):
        """Analyze the format of returned data"""
        print(f"\n🔬 Data Format Analysis for {symbol}:")
        
        if not data:
            print("No data to analyze")
            return
        
        # Check available fields
        sample_record = data[0]
        print(f"📝 Available fields: {list(sample_record.keys())}")
        
        # Check datetime format
        if 'datetime' in sample_record:
            sample_dt = sample_record['datetime']
            print(f"🕒 Sample datetime: {sample_dt}")
            
            # Try to parse datetime
            try:
                parsed_dt = datetime.fromisoformat(sample_dt.replace('Z', '+00:00'))
                print(f"📅 Parsed datetime (UTC): {parsed_dt}")
                
                # Convert to EST
                est_offset = timedelta(hours=-5)  # EST is UTC-5 (ignoring DST for now)
                est_dt = parsed_dt + est_offset
                print(f"📅 Converted to EST: {est_dt}")
                
                # Your format
                your_format = est_dt.strftime("%Y%m%d %H%M%S")
                print(f"📅 Your format: {your_format}")
                
            except Exception as e:
                print(f"❌ Error parsing datetime: {e}")
        
        # Check numeric fields
        numeric_fields = ['open', 'high', 'low', 'close', 'volume']
        for field in numeric_fields:
            if field in sample_record:
                value = sample_record[field]
                print(f"💰 {field}: {value} (type: {type(value)})")
            else:
                print(f"❌ Missing field: {field}")
        
        # Show last few records to see date range
        print(f"\n📈 Date Range:")
        print(f"First record: {data[0].get('datetime', 'N/A')}")
        print(f"Last record: {data[-1].get('datetime', 'N/A')}")
        print(f"Total records: {len(data)}")
        
        # Convert to your format and show sample
        print(f"\n🔄 Sample Conversion to Your Format:")
        sample_converted = self.convert_to_your_format(data[:3])
        for line in sample_converted:
            print(f"Your format: {line}")
    
    def convert_to_your_format(self, data):
        """Convert EODHD format to your CSV format"""
        converted_lines = []
        
        for record in data:
            try:
                # Parse EODHD datetime (UTC)
                dt_str = record['datetime']
                dt_utc = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
                
                # Convert to EST (simplified - not handling DST)
                est_offset = timedelta(hours=-5)
                dt_est = dt_utc + est_offset
                
                # Format like your data: YYYYMMDD HHMMSS
                formatted_dt = dt_est.strftime("%Y%m%d %H%M%S")
                
                # Get OHLC values
                open_price = record.get('open', 0)
                high_price = record.get('high', 0)
                low_price = record.get('low', 0)
                close_price = record.get('close', 0)
                volume = record.get('volume', 0)  # Default to 0 if not provided
                
                # Format like your CSV: datetime;open;high;low;close;volume
                line = f"{formatted_dt};{open_price:.6f};{high_price:.6f};{low_price:.6f};{close_price:.6f};{volume}"
                converted_lines.append(line)
                
            except Exception as e:
                print(f"❌ Error converting record: {e}")
                continue
        
        return converted_lines
    
    def test_multiple_pairs(self, symbols=["EURUSD", "GBPUSD", "USDJPY"]):
        """Test multiple currency pairs"""
        print(f"\n🌍 Testing Multiple Currency Pairs:")
        
        results = {}
        for symbol in symbols:
            print(f"\n--- Testing {symbol} ---")
            data = self.test_forex_intraday(symbol, days_back=1)
            results[symbol] = len(data) if data else 0
            
        print(f"\n📊 Summary:")
        for symbol, count in results.items():
            status = "✅" if count > 0 else "❌"
            print(f"{status} {symbol}: {count} records")
        
        return results
    
    def test_weekend_data(self, symbol="EURUSD"):
        """Test weekend data handling"""
        print(f"\n📅 Testing Weekend Data for {symbol}:")
        
        # Test data around a weekend
        friday = datetime(2025, 7, 11)  # July 11, 2025 was a Friday
        monday = friday + timedelta(days=3)  # Monday
        
        # Convert to timestamps
        start_ts = int(friday.timestamp())
        end_ts = int(monday.timestamp())
        
        url = f"{self.base_url}/intraday/{symbol}.FOREX"
        params = {
            'api_token': self.api_key,
            'interval': '1m',
            'from': start_ts,
            'to': end_ts,
            'fmt': 'json'
        }
        
        try:
            response = requests.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                
                print(f"📈 Weekend test data: {len(data)} records")
                
                if data:
                    # Analyze by day
                    daily_counts = {}
                    for record in data:
                        dt_str = record['datetime']
                        dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
                        day_name = dt.strftime('%A')
                        daily_counts[day_name] = daily_counts.get(day_name, 0) + 1
                    
                    print("📊 Data by day:")
                    for day, count in daily_counts.items():
                        print(f"  {day}: {count} records")
                
        except Exception as e:
            print(f"❌ Error testing weekend data: {e}")


def main():
    """Main test function"""
    api_key = "68402b9a1aa451.77165073"
    
    print("🚀 EODHD API Testing Started")
    print("=" * 50)
    
    tester = EODHDTester(api_key)
    
    # Test 1: Basic API test with EURUSD
    print("\n🧪 TEST 1: Basic EURUSD Data")
    data = tester.test_forex_intraday("EURUSD", days_back=2)
    
    # Test 2: Multiple currency pairs
    print("\n🧪 TEST 2: Multiple Currency Pairs")
    test_symbols = ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD"]
    tester.test_multiple_pairs(test_symbols)
    
    # Test 3: Weekend data
    print("\n🧪 TEST 3: Weekend Data Handling")
    tester.test_weekend_data("EURUSD")
    
    print("\n" + "=" * 50)
    print("🏁 Testing Complete!")


if __name__ == "__main__":
    main()
