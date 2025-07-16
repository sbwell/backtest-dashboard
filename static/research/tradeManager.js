// tradeManager.js - Handles trade visualization and analysis

class TradeManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.trades = [];
        this.originalTrades = [];
        this.filteredTrades = [];
        this.selectedBacktestId = null;
    }

    setTrades(trades) {
        this.trades = trades;
        this.originalTrades = [...trades];
        this.filteredTrades = [...trades];
        console.log(`📊 Set ${trades.length} trades`);
    }

    showAllTrades() {
        if (!this.chartManager.candlestickSeries || !this.trades.length) return;
        
        this.chartManager.clearAllTrades();
        
        // Batch process markers for better performance
        const newMarkers = [];
        const newLines = [];
        
        this.trades.forEach(trade => {
            const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
            const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
            const isBuy = trade.side === "buy";

            if (!this.chartManager.timestampExists(entryTime) || !this.chartManager.timestampExists(exitTime)) return;

            const snappedEntryTime = this.chartManager.getNearestTime(entryTime);
            const snappedExitTime = this.chartManager.getNearestTime(exitTime);

            // Add entry marker
            newMarkers.push({
                time: snappedEntryTime,
                position: isBuy ? "belowBar" : "aboveBar",
                color: isBuy ? "green" : "red",
                shape: isBuy ? "arrowUp" : "arrowDown",
                text: "Entry"
            });

            // Add exit marker
            newMarkers.push({
                time: snappedExitTime,
                position: isBuy ? "aboveBar" : "belowBar",
                color: isBuy ? "red" : "green",
                shape: isBuy ? "arrowDown" : "arrowUp",
                text: "Exit"
            });

            // Create trade line
            const profitColor = trade.pnl > 0 ? "green" : "red";
            const lineStyle = trade.pnl > 0 ? 0 : 1; // solid for profit, dashed for loss
            
            this.chartManager.addTradeLine([
                { time: snappedEntryTime, value: trade.entry_price },
                { time: snappedExitTime, value: trade.exit_price }
            ], {
                color: profitColor,
                lineWidth: 1,
                lineStyle: lineStyle
            });
        });

        // Apply all markers at once
        this.chartManager.setMarkers(newMarkers);
        
        // Clear selection styling
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
        
        console.log(`✅ Displayed ${this.trades.length} trades on chart`);
    }

    scrollToTrade(trade) {
        if (!this.chartManager.chart || !this.chartManager.chartData.length) return;
        
        const entryTs = Math.floor(new Date(trade.entry_time).getTime() / 1000);
        const exitTs = Math.floor(new Date(trade.exit_time).getTime() / 1000);
        
        if (!this.chartManager.timestampExists(entryTs) || !this.chartManager.timestampExists(exitTs)) {
            console.warn("Trade timestamps not found in chart data");
            return;
        }

        const snappedEntry = this.chartManager.getNearestTime(entryTs);
        const snappedExit = this.chartManager.getNearestTime(exitTs);

        // Clear existing markers and lines
        this.chartManager.clearAllTrades();

        // Calculate view range
        const mid = Math.floor((snappedEntry + snappedExit) / 2);
        const timePerBar = this.chartManager.getTimePerBar();
        const buffer = timePerBar * 50;

        // Set visible range
        this.chartManager.setVisibleRange(
            Math.max(mid - buffer, this.chartManager.getFirstTime()),
            Math.min(mid + buffer, this.chartManager.getLastTime())
        );

        // Create markers
        const isBuy = trade.side === "buy";
        const profitColor = trade.pnl > 0 ? "#4caf50" : "#f44336";
        
        const markers = [
            {
                time: snappedEntry,
                position: isBuy ? "belowBar" : "aboveBar",
                color: isBuy ? "#2e7d32" : "#d32f2f",
                shape: isBuy ? "arrowUp" : "arrowDown",
                text: `Entry: ${trade.entry_price?.toFixed(4)}`
            },
            {
                time: snappedExit,
                position: isBuy ? "aboveBar" : "belowBar",
                color: profitColor,
                shape: isBuy ? "arrowDown" : "arrowUp",
                text: `Exit: ${trade.exit_price?.toFixed(4)} (${trade.pnl?.toFixed(2)})`
            }
        ];

        // Create trade line
        this.chartManager.addTradeLine([
            { time: snappedEntry, value: trade.entry_price },
            { time: snappedExit, value: trade.exit_price }
        ], {
            color: profitColor,
            lineWidth: 2,
            lineStyle: trade.pnl > 0 ? 0 : 1 // solid for profit, dashed for loss
        });
        
        this.chartManager.setMarkers(markers);
        
        // Auto-scale price to show the trade clearly
        this.chartManager.autoScale();
        
        console.log(`📍 Scrolled to trade: ${trade.entry_time} to ${trade.exit_time}`);
    }

    clearAllTrades() {
        this.chartManager.clearAllTrades();
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
        console.log("🧹 Cleared all trades from chart");
    }

    filterTrades(activeFilters) {
        this.filteredTrades = this.originalTrades.filter(trade => {
            for (const [key, [min, max]] of Object.entries(activeFilters)) {
                const value = trade[key];
                if (value == null) return false;
                const EPSILON = 0.00009;
                if (value < min - EPSILON || value > max + EPSILON) return false;
            }
            return true;
        });
        
        console.log(`🔍 Filtered to ${this.filteredTrades.length} trades from ${this.originalTrades.length}`);
        return this.filteredTrades;
    }

    getTradeStats(trades) {
        if (!trades || trades.length === 0) {
            return { 
                profit: 0, 
                efficiency: 0, 
                total: 0, 
                winRate: 0, 
                wins: 0,
                losses: 0,
                start: "—", 
                end: "—" 
            };
        }
        
        const total = trades.length;
        const profit = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
        const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
        const losses = total - wins;
        const efficiency = profit / total;
        const winRate = (wins / total) * 100;
        
        // Sort trades by entry time to get start/end
        const sortedTrades = [...trades].sort((a, b) => new Date(a.entry_time) - new Date(b.entry_time));
        const start = sortedTrades.length > 0 ? new Date(sortedTrades[0].entry_time).toLocaleString() : "—";
        const end = sortedTrades.length > 0 ? new Date(sortedTrades[sortedTrades.length - 1].exit_time).toLocaleString() : "—";
        
        return { 
            profit, 
            efficiency, 
            total, 
            winRate, 
            wins, 
            losses, 
            start, 
            end 
        };
    }

    exportTradesToCSV(trades = null) {
        const tradesToExport = trades || this.filteredTrades;
        
        if (!tradesToExport.length) {
            alert("No trades to export");
            return;
        }
        
        const csv = this.convertTradesToCSV(tradesToExport);
        this.downloadCSV(csv, `trades_export_${new Date().toISOString().split('T')[0]}.csv`);
        
        console.log(`📄 Exported ${tradesToExport.length} trades to CSV`);
    }

    convertTradesToCSV(trades) {
        if (!trades.length) return "";
        
        const headers = Object.keys(trades[0]).join(',');
        const rows = trades.map(trade => 
            Object.values(trade).map(value => 
                typeof value === 'string' && value.includes(',') ? `"${value}"` : value
            ).join(',')
        );
        
        return [headers, ...rows].join('\n');
    }

    downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    // Get all available metrics for filtering
    getAvailableMetrics() {
        if (!this.originalTrades.length) return [];
        
        const firstTrade = this.originalTrades[0];
        return Object.keys(firstTrade).filter(key => 
            typeof firstTrade[key] === 'number' && 
            !['id', 'backtest_id'].includes(key)
        );
    }

    // Get metric values for analysis
    getMetricValues(metric) {
        return this.originalTrades
            .map(t => t[metric])
            .filter(v => typeof v === "number");
    }
}

// Export for use in other modules
window.TradeManager = TradeManager;
