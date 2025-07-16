// navigationManager.js - Handles keyboard navigation and chart movement

class NavigationManager {
    constructor(chartManager, dataManager) {
        this.chartManager = chartManager;
        this.dataManager = dataManager;
    }

    initialize() {
        document.addEventListener("keydown", this.handleKeyboardNavigation.bind(this));
        window.addEventListener("resize", this.debounce(this.handleWindowResize.bind(this), 250));
        console.log("⌨️ Navigation manager initialized");
    }

    handleKeyboardNavigation(e) {
        if (!this.chartManager.chart || !this.chartManager.chartData.length) return;
        
        const range = this.chartManager.getVisibleRange();
        if (!range) return;

        const timePerBar = this.chartManager.getTimePerBar();
        const step = timePerBar * 5; // scroll 5 bars worth of time
        
        // Get the absolute boundaries of our data
        const firstTime = this.chartManager.getFirstTime();
        const lastTime = this.chartManager.getLastTime();
        
        // Add a small tolerance for floating point comparison
        const TOLERANCE = timePerBar * 0.1;

        if (e.key === "ArrowLeft") {
            e.preventDefault(); // Always prevent default to stop TradingView zoom
            
            // Check if we're very close to the left edge (within tolerance)
            if (range.from <= firstTime + TOLERANCE) {
                console.log("📍 Reached left edge of data - use 'Load Earlier Data' button to load more");
                return; // STOP HERE - don't scroll or zoom
            }
            
            // Calculate new range, but don't go past the left edge
            const newFrom = Math.max(range.from - step, firstTime);
            const newTo = newFrom + (range.to - range.from); // Maintain same visible width
            
            // Double-check we're not going past the edge
            if (newFrom <= firstTime + TOLERANCE) {
                // Snap exactly to the edge
                this.chartManager.setVisibleRange(firstTime, firstTime + (range.to - range.from));
                console.log("📍 Snapped to left edge of data");
            } else {
                this.chartManager.setVisibleRange(newFrom, newTo);
            }
        }

        if (e.key === "ArrowRight") {
            e.preventDefault(); // Always prevent default to stop TradingView zoom
            
            // Check if we're very close to the right edge (within tolerance)
            if (range.to >= lastTime - TOLERANCE) {
                console.log("📍 Reached right edge of data - use 'Load More Recent Data' button to load more");
                return; // STOP HERE - don't scroll or zoom
            }
            
            // Calculate new range, but don't go past the right edge
            const newTo = Math.min(range.to + step, lastTime);
            const newFrom = newTo - (range.to - range.from); // Maintain same visible width
            
            // Double-check we're not going past the edge
            if (newTo >= lastTime - TOLERANCE) {
                // Snap exactly to the edge
                this.chartManager.setVisibleRange(lastTime - (range.to - range.from), lastTime);
                console.log("📍 Snapped to right edge of data");
            } else {
                this.chartManager.setVisibleRange(newFrom, newTo);
            }
        }

        if (e.key === "Home") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        
            if (firstTime) {
                // SIMPLE: Always show exactly 100 bars from the start
                const show100Bars = timePerBar * 100;
            
                this.chartManager.setVisibleRange(firstTime, firstTime + show100Bars);
            
                console.log("🏠 Home: Showing first 100 bars");
            }
        }

        if (e.key === "End") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        
            if (lastTime) {
                // SIMPLE: Always show exactly 100 bars from the end
                const show100Bars = timePerBar * 100;
            
                this.chartManager.setVisibleRange(lastTime - show100Bars, lastTime);
            
                console.log("🔚 End: Showing last 100 bars");
            }
        }

        // Optional: Also make R key do the same thing for consistency
        if (e.key === "r" || e.key === "R") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        
            const show100Bars = timePerBar * 100;

            this.chartManager.setVisibleRange(lastTime - show100Bars, lastTime);

            // Auto-scale price
            this.chartManager.autoScale();
        
            console.log("🔄 Reset: Showing last 100 bars with auto-scale");
        }
    }

    handleWindowResize() {
        if (!this.chartManager.chart) return;
        const chartContainer = document.getElementById("chart");
        if (chartContainer) {
            this.chartManager.resize(chartContainer.clientWidth, 500);
        }
    }

    // Manual data loading methods
    async loadEarlierData() {
        if (!this.chartManager.chartData.length) {
            console.log('No chart data loaded');
            return;
        }

        const earliestTime = this.chartManager.getFirstTime();
        const symbol = this.chartManager.currentSymbol;
        const timeframe = this.chartManager.currentTimeframe;

        const newData = await this.dataManager.loadEarlierData(symbol, timeframe, earliestTime);
        
        if (newData && newData.length > 0) {
            this.chartManager.prependData(newData);
            
            // Reapply markers if they exist
            if (this.chartManager.markers && this.chartManager.markers.length > 0) {
                this.chartManager.setMarkers(this.chartManager.markers);
            }
        }
    }

    async loadMoreRecentData() {
        if (!this.chartManager.chartData.length) {
            console.log('No chart data loaded');
            return;
        }

        const latestTime = this.chartManager.getLastTime();
        const symbol = this.chartManager.currentSymbol;
        const timeframe = this.chartManager.currentTimeframe;

        const newData = await this.dataManager.loadMoreRecentData(symbol, timeframe, latestTime);
        
        if (newData && newData.length > 0) {
            this.chartManager.appendData(newData);
            
            // Reapply markers if they exist
            if (this.chartManager.markers && this.chartManager.markers.length > 0) {
                this.chartManager.setMarkers(this.chartManager.markers);
            }
        }
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// Export for use in other modules
window.NavigationManager = NavigationManager;
