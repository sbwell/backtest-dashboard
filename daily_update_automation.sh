#!/bin/bash

# EODHD Daily Update Automation Script
# Runs daily at 4 AM EST to update forex data

# Configuration
SCRIPT_DIR="/opt/chart_dashboard"
LOG_DIR="/opt/chart_dashboard/logs"
PYTHON_ENV="/usr/bin/python3"
EODHD_API_KEY="68402b9a1aa451.77165073"

# Discord webhook URL (replace with your webhook URL)
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/1395608600361308322/Vxv0j5WVbAzcUigfSyNLgoq5hi7-UaDHZM8yMvZIWZ4NC0u4KzAy36av1oT8VkFP9SD3"  # Set your Discord webhook URL here

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Log file with timestamp
LOG_FILE="$LOG_DIR/daily_eodhd_update_$(date +%Y%m%d).log"

# Function to log with timestamp
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Function to send Discord notification
send_discord_notification() {
    local success="$1"
    local message="$2"
    local duration="$3"
    
    if [ -z "$DISCORD_WEBHOOK_URL" ]; then
        log "Discord webhook not configured, skipping notification"
        return
    fi
    
    if [ "$success" = "true" ]; then
        # Success message (green theme)
        local discord_message="✅ **FOREX DATA UPDATE SUCCESS** ✅
        
📊 Daily forex update completed successfully
⏱️ Duration: ${duration} minutes
🕐 Time: $(date '+%Y-%m-%d %H:%M:%S EST')
🖥️ Server: $(hostname)

All 28 currency pairs updated with latest EODHD data through $(date -d 'yesterday' '+%Y-%m-%d')"
        
    else
        # Failure message (red theme with bold dots)
        local discord_message="🔴 **FOREX DATA UPDATE FAILED** 🔴

❌ Daily forex update encountered errors
⏱️ Duration: ${duration} minutes  
🕐 Time: $(date '+%Y-%m-%d %H:%M:%S EST')
🖥️ Server: $(hostname)
📋 Error: $message

🔍 Check logs: \`$LOG_FILE\`
⚠️ Trading data may be stale - manual intervention required!"
    fi
    
    # Send to Discord
    curl -H "Content-Type: application/json" \
         -d "{\"content\":\"$discord_message\"}" \
         "$DISCORD_WEBHOOK_URL" \
         --silent --show-error 2>&1 | tee -a "$LOG_FILE"
}

log "=== Starting EODHD Daily Update at 4 AM EST ==="

# Check if it's a weekday (Monday-Friday)
WEEKDAY=$(date +%u)  # 1=Monday, 7=Sunday
if [ "$WEEKDAY" -gt 5 ]; then
    log "Skipping update - Weekend (day $WEEKDAY)"
    exit 0
fi

# Check if data directory exists
if [ ! -d "$SCRIPT_DIR/data" ]; then
    log "ERROR: Data directory does not exist: $SCRIPT_DIR/data"
    send_discord_notification "false" "Data directory missing" "0"
    exit 1
fi

# Check if Python script exists
if [ ! -f "$SCRIPT_DIR/eodhd_daily_updater.py" ]; then
    log "ERROR: Update script not found: $SCRIPT_DIR/eodhd_daily_updater.py"
    send_discord_notification "false" "Update script missing" "0"
    exit 1
fi

# Change to script directory
cd "$SCRIPT_DIR" || exit 1

# Run the Python update script
log "Starting EODHD data update..."

START_TIME=$(date +%s)

$PYTHON_ENV eodhd_daily_updater.py --api-key "$EODHD_API_KEY" 2>&1 | tee -a "$LOG_FILE"
UPDATE_EXIT_CODE=${PIPESTATUS[0]}

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_MIN=$((DURATION / 60))

if [ $UPDATE_EXIT_CODE -eq 0 ]; then
    log "✅ EODHD update completed successfully in ${DURATION_MIN} minutes"
    
    # Send success notification to Discord
    send_discord_notification "true" "Update completed successfully" "$DURATION_MIN"
else
    log "❌ EODHD update failed with exit code $UPDATE_EXIT_CODE after ${DURATION_MIN} minutes"
    
    # Send failure notification to Discord
    send_discord_notification "false" "Exit code $UPDATE_EXIT_CODE" "$DURATION_MIN"
    
    exit 1
fi

# Clean up old log files (keep only last 30 days)
find "$LOG_DIR" -name "daily_eodhd_update_*.log" -mtime +30 -delete

# Check disk space
DISK_USAGE=$(df "$SCRIPT_DIR" | awk 'NR==2{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    log "WARNING: Disk space is at ${DISK_USAGE}% - consider cleaning up old data"
    
    # Send disk space warning to Discord
    if [ -n "$DISCORD_WEBHOOK_URL" ]; then
        curl -H "Content-Type: application/json" \
             -d "{\"content\":\"⚠️ **DISK SPACE WARNING** ⚠️\n\nDisk usage at ${DISK_USAGE}% on $(hostname)\nConsider cleaning up old data\"}" \
             "$DISCORD_WEBHOOK_URL" --silent
    fi
fi

# Log some statistics
CSV_COUNT=$(ls -1 "$SCRIPT_DIR/data/"*_M1.csv 2>/dev/null | wc -l)
DB_SIZE=$(du -h "$SCRIPT_DIR/ohlcv.db" 2>/dev/null | cut -f1)

log "📊 Post-update statistics:"
log "   CSV files: $CSV_COUNT"
log "   Database size: $DB_SIZE"
log "   Disk usage: ${DISK_USAGE}%"

log "=== Daily EODHD update completed ==="

exit 0
