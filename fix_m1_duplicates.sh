#!/bin/bash
# Fix M1 duplicate timestamps

DATA_DIR="/opt/chart_dashboard/data"
BACKUP_DIR="/opt/chart_dashboard/data/backup_m1_$(date +%Y%m%d_%H%M%S)"

echo "=== Fixing M1 Duplicate Timestamps ==="

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Currency pairs
PAIRS=("AUDCAD" "AUDCHF" "AUDJPY" "AUDNZD" "AUDUSD" "CADCHF" "CADJPY" "CHFJPY" "EURAUD" "EURCAD" "EURCHF" "EURGBP" "EURJPY" "EURNZD" "EURUSD" "GBPAUD" "GBPCAD" "GBPCHF" "GBPJPY" "GBPNZD" "GBPUSD" "NZDCAD" "NZDCHF" "NZDJPY" "NZDUSD" "USDCAD" "USDCHF" "USDJPY")

for pair in "${PAIRS[@]}"; do
    file="$DATA_DIR/${pair}_M1.csv"
    
    if [ -f "$file" ]; then
        echo "🔧 Fixing duplicates in $pair M1..."
        
        # Backup original
        cp "$file" "$BACKUP_DIR/${pair}_M1.csv"
        
        # Count original lines
        original_lines=$(wc -l < "$file")
        
        # Remove duplicates - keep the LAST occurrence (most recent data)
        # Sort by timestamp, then remove duplicates keeping last occurrence
        sort -t';' -k1,1 "$file" | awk -F';' '{a[$1]=$0} END {for (i in a) print a[i]}' | sort -t';' -k1,1 > "${file}.dedup"
        
        # Count cleaned lines
        cleaned_lines=$(wc -l < "${file}.dedup")
        
        echo "   Original: $original_lines lines"
        echo "   Cleaned:  $cleaned_lines lines"
        echo "   Removed:  $((original_lines - cleaned_lines)) duplicates"
        
        # Replace original with cleaned version
        mv "${file}.dedup" "$file"
        
    else
        echo "⚠️ File not found: $file"
    fi
done

echo "✅ All M1 duplicates removed!"
echo "📁 Backups stored in: $BACKUP_DIR"

# Now regenerate higher timeframes from clean M1 data
echo "🔄 Regenerating higher timeframes from clean M1 data..."
cd "$DATA_DIR"
mkdir -p backup_old_timeframes
mv *_M5.csv *_M15.csv *_H1.csv *_H4.csv *_D1.csv backup_old_timeframes/ 2>/dev/null || true

cd /opt/chart_dashboard
python3 incremental_resample.py

echo "✅ Complete fix finished!"
echo "💡 Restart your web application - all charts should now load properly"
