#!/bin/bash
# Debug EURUSD data to find corruption

echo "=== EURUSD Data Debugging ==="

# Check if files exist
echo "1. Checking file existence:"
ls -la /opt/chart_dashboard/data/EURUSD_M5.csv 2>/dev/null || echo "❌ EURUSD_M5.csv not found"

# Check file size and basic stats
echo -e "\n2. File stats:"
if [ -f "/opt/chart_dashboard/data/EURUSD_M5.csv" ]; then
    wc -l /opt/chart_dashboard/data/EURUSD_M5.csv
    ls -lh /opt/chart_dashboard/data/EURUSD_M5.csv
else
    echo "❌ File not found"
    exit 1
fi

# Check for obvious issues in the data
echo -e "\n3. Data validation:"

# Check for completely empty lines
echo "Empty lines:"
grep -n "^$" /opt/chart_dashboard/data/EURUSD_M5.csv | head -5

# Check for lines with wrong number of fields (should be 6: datetime;open;high;low;close;volume)
echo -e "\nLines with wrong field count:"
awk -F';' 'NF != 6 {print NR ": " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -10

# Check for null/empty values in critical fields
echo -e "\nLines with empty OHLC values:"
awk -F';' '$2=="" || $3=="" || $4=="" || $5=="" {print NR ": " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -10

# Check for invalid price values (non-numeric)
echo -e "\nLines with non-numeric prices:"
awk -F';' '$2 !~ /^[0-9]*\.?[0-9]+$/ || $3 !~ /^[0-9]*\.?[0-9]+$/ || $4 !~ /^[0-9]*\.?[0-9]+$/ || $5 !~ /^[0-9]*\.?[0-9]+$/ {print NR ": " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -10

# Check for malformed timestamps
echo -e "\nLines with invalid timestamps:"
awk -F';' '$1 !~ /^[0-9]{8} [0-9]{6}$/ {print NR ": " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -10

# Check for OHLC logic violations (high < low, etc.)
echo -e "\nLines with OHLC logic errors:"
awk -F';' '$3+0 < $4+0 {print NR " (high<low): " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -5
awk -F';' '$2+0 > $3+0 || $2+0 < $4+0 {print NR " (open outside H/L): " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -5
awk -F';' '$5+0 > $3+0 || $5+0 < $4+0 {print NR " (close outside H/L): " $0}' /opt/chart_dashboard/data/EURUSD_M5.csv | head -5

# Check last few lines for recent corruption
echo -e "\n4. Last 10 lines of data:"
tail -10 /opt/chart_dashboard/data/EURUSD_M5.csv

# Sample some middle data
echo -e "\n5. Sample middle data (lines 1000-1005):"
sed -n '1000,1005p' /opt/chart_dashboard/data/EURUSD_M5.csv 2>/dev/null || echo "File has less than 1000 lines"

echo -e "\n=== Debug complete ==="
