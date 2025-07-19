#!/bin/bash
# Update database and enrich data in one script

echo "=== Database Update and Enrichment ==="
echo "🕐 Started at: $(date)"

# Step 1: Update database from CSV files
echo "🔄 Step 1: Importing CSV data to database..."
python3 csv_to_db_importer.py

if [ $? -eq 0 ]; then
    echo "✅ Database import completed successfully"
else
    echo "❌ Database import failed"
    exit 1
fi

# Step 2: Run enrichment
echo "🔄 Step 2: Running enrichment..."
python3 incremental_enrichment.py

if [ $? -eq 0 ]; then
    echo "✅ Enrichment completed successfully"
else
    echo "❌ Enrichment failed"
    exit 1
fi

echo "✅ Database update and enrichment complete!"
echo "🕐 Finished at: $(date)"
