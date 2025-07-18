#!/bin/bash
# Fix EURUSD data issues

DATA_FILE="/opt/chart_dashboard/data/EURUSD_M5.csv"
BACKUP_FILE="/opt/chart_dashboard/data/EURUSD_M5_backup_$(date +%Y%m%d_%H%M%S).csv"

echo "=== Fixing EURUSD Data ==="

# Create backup
cp "$DATA_FILE" "$BACKUP_FILE"
echo "✅ Backup created: $BACKUP_FILE"

# Fix the data
awk -F';' '
{
    # Skip empty lines
    if (NF == 0 || $0 == "") next
    
    # If line has 5 fields (missing volume), add volume=0
    if (NF == 5) {
        print $0 ";0"
    }
    # If line has 6 fields, keep as is
    else if (NF == 6) {
        print $0
    }
    # Skip malformed lines
    else {
        print "Skipping malformed line: " $0 > "/dev/stderr"
    }
}' "$DATA_FILE" > "${DATA_FILE}.tmp"

# Remove duplicate timestamps (keep first occurrence)
awk -F';' '!seen[$1]++' "${DATA_FILE}.tmp" > "${DATA_FILE}.fixed"

# Check results
original_lines=$(wc -l < "$DATA_FILE")
fixed_lines=$(wc -l < "${DATA_FILE}.fixed")

echo "📊 Original lines: $original_lines"
echo "📊 Fixed lines: $fixed_lines"
echo "📊 Removed duplicates: $((original_lines - fixed_lines))"

# Replace original with fixed version
mv "${DATA_FILE}.fixed" "$DATA_FILE"
rm "${DATA_FILE}.tmp"

echo "✅ EURUSD data fixed!"
echo "🔍 Last 5 lines of fixed data:"
tail -5 "$DATA_FILE"

echo -e "\n💡 Restart your web application to load the fixed data"
