// main.js - Main application orchestrator

class TradingChartApp {
    constructor() {
        this.chartManager = new ChartManager();
        this.dataManager = new DataManager();
        this.tradeManager = new TradeManager(this.chartManager);
        this.uiManager = new UIManager();
        this.navigationManager = new NavigationManager(this.chartManager, this.dataManager);
        
        this.selectedBacktestId = null;
        this.currentSymbol = '';
        this.currentTimeframe = '';
    }

    async initialize() {
        try {
            console.log("🚀 Initializing Trading Chart Application");
            
            // Initialize chart
            const symbol = document.getElementById("symbol").value;
            const timeframe = document.getElementById("timeframe").value;
            const isJPY = symbol.endsWith("JPY");
            
            this.chartManager.initialize("chart", {
                localization: {
                    priceFormatter: price => Number(price).toFixed(isJPY ? 2 : 4)
                }
            });

            // Store current symbol/timeframe
            this.currentSymbol = symbol;
            this.currentTimeframe = timeframe;
            this.chartManager.currentSymbol = symbol;
            this.chartManager.currentTimeframe = timeframe;

            // Initialize navigation
            this.navigationManager.initialize();

            // Setup event listeners
            this.setupEventListeners();

            // Load initial data
            await this.loadInitialData();

            console.log("✅ Application initialized successfully");
        } catch (error) {
            console.error("❌ Failed to initialize application:", error);
            this.uiManager.updateElementText("loadingIndicator", "Failed to initialize");
        }
    }

    setupEventListeners() {
        // Backtest controls
        document.getElementById("loadBacktestBtn").addEventListener("click", () => {
            this.loadSelectedBacktest();
        });

        document.getElementById("clearTradesBtn").addEventListener("click", () => {
            this.tradeManager.clearAllTrades();
        });

        document.getElementById("showAllTradesBtn").addEventListener("click", () => {
            this.tradeManager.showAllTrades();
        });

        // Symbol and timeframe changes
        document.getElementById("symbol").addEventListener("change", () => {
            this.handleSymbolChange();
        });

        document.getElementById("timeframe").addEventListener("change", () => {
            this.handleTimeframeChange();
        });

        // Data loading buttons
        const loadEarlierBtn = document.getElementById('loadEarlierBtn');
        const loadMoreRecentBtn = document.getElementById('loadMoreRecentBtn');
        
        if (loadEarlierBtn) {
            loadEarlierBtn.addEventListener('click', () => {
                this.navigationManager.loadEarlierData();
            });
        }
        
        if (loadMoreRecentBtn) {
            loadMoreRecentBtn.addEventListener('click', () => {
                this.navigationManager.loadMoreRecentData();
            });
        }

        // Filter reset button (if exists)
        const resetFiltersBtn = document.getElementById('resetFiltersBtn');
        if (resetFiltersBtn) {
            resetFiltersBtn.addEventListener('click', () => {
                this.resetAllFilters();
            });
        }

        // Export button (if exists)
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.tradeManager.exportTradesToCSV();
            });
        }

        console.log("🔗 Event listeners setup complete");
    }

    async loadInitialData() {
        try {
            // Load backtests first
            await this.fetchAndPopulateBacktests();
            
            // Load chart data
            await this.loadChartData();
            
            // Load trade data if backtest is selected
            if (this.selectedBacktestId) {
                await this.loadTradeData();
            }
        } catch (error) {
            console.error("Failed to load initial data:", error);
        }
    }

    async fetchAndPopulateBacktests() {
        try {
            const backtests = await this.dataManager.fetchBacktests();
            this.selectedBacktestId = this.uiManager.populateBacktestDropdown(backtests, this.currentSymbol);
            console.log(`📋 Selected backtest: ${this.selectedBacktestId}`);
        } catch (error) {
            console.error("Failed to fetch backtests:", error);
        }
    }

    async loadChartData() {
        try {
            this.dataManager.resetLoadingStates();
            
            const candleData = await this.dataManager.fetchCandleData(
                this.currentSymbol, 
                this.currentTimeframe
            );
            
            if (candleData && candleData.length > 0) {
                this.chartManager.setData(candleData);
                console.log(`📊 Loaded chart data for ${this.currentSymbol} ${this.currentTimeframe}`);
            }
        } catch (error) {
            console.error("Failed to load chart data:", error);
        }
    }

    async loadTradeData() {
        if (!this.selectedBacktestId) return;

        try {
            const trades = await this.dataManager.fetchTradeData(
                this.selectedBacktestId, 
                this.currentSymbol
            );
            
            this.tradeManager.setTrades(trades);
            this.updateAnalysisUI(trades);
            
            console.log(`💼 Loaded ${trades.length} trades for backtest ${this.selectedBacktestId}`);
        } catch (error) {
            console.error("Failed to load trade data:", error);
        }
    }

    updateAnalysisUI(trades) {
        // Update summary
        this.uiManager.renderSummary(
            this.tradeManager.filteredTrades, 
            this.tradeManager.originalTrades, 
            this.tradeManager
        );

        // Render filters
        this.uiManager.renderFilters(
            trades, 
            this.tradeManager, 
            (activeFilters) => this.handleFilterUpdate(activeFilters)
        );

        // Render buckets
        this.uiManager.renderAllBuckets(trades, this.tradeManager);

        // Render trade table
        this.uiManager.renderTradeTable(this.tradeManager.filteredTrades, this.tradeManager);
    }

    handleFilterUpdate(activeFilters) {
        // Apply filters to trades
        const filteredTrades = this.tradeManager.filterTrades(activeFilters);
        
        // Update UI with filtered results
        this.uiManager.renderSummary(
            filteredTrades, 
            this.tradeManager.originalTrades, 
            this.tradeManager
        );
        
        this.uiManager.renderAllBuckets(filteredTrades, this.tradeManager);
        this.uiManager.renderTradeTable(filteredTrades, this.tradeManager);
    }

    async handleSymbolChange() {
        const newSymbol = document.getElementById("symbol").value;
        if (newSymbol === this.currentSymbol) return;

        console.log(`🔄 Symbol changed from ${this.currentSymbol} to ${newSymbol}`);
        
        this.currentSymbol = newSymbol;
        this.chartManager.currentSymbol = newSymbol;
        
        // Clear chart
        this.chartManager.clearAllTrades();
        
        // Update chart price formatter for JPY pairs
        const isJPY = newSymbol.endsWith("JPY");
        this.chartManager.chart.applyOptions({
            localization: {
                priceFormatter: price => Number(price).toFixed(isJPY ? 2 : 4)
            }
        });

        // Reload everything
        await this.fetchAndPopulateBacktests();
        await this.loadChartData();
        
        if (this.selectedBacktestId) {
            await this.loadTradeData();
        }
    }

    async handleTimeframeChange() {
        const newTimeframe = document.getElementById("timeframe").value;
        if (newTimeframe === this.currentTimeframe) return;

        console.log(`🔄 Timeframe changed from ${this.currentTimeframe} to ${newTimeframe}`);
        
        this.currentTimeframe = newTimeframe;
        this.chartManager.currentTimeframe = newTimeframe;
        
        // Clear chart
        this.chartManager.clearAllTrades();
        
        // Clear relevant cache
        this.dataManager.clearCache(`candles_${this.currentSymbol}`);

        // Reload chart and trades
        await this.loadChartData();
        
        if (this.selectedBacktestId) {
            await this.loadTradeData();
        }
    }

    async loadSelectedBacktest() {
        const select = document.getElementById("backtest-select");
        if (!select || !select.value) return;

        this.selectedBacktestId = select.value;
        console.log(`📋 Loading backtest: ${this.selectedBacktestId}`);
        
        await this.loadTradeData();
    }

    resetAllFilters() {
        this.uiManager.resetAllFilters();
        
        // Reset filtered trades to original
        this.tradeManager.filteredTrades = [...this.tradeManager.originalTrades];
        
        // Update UI
        this.updateAnalysisUI(this.tradeManager.originalTrades);
    }

    // Public API methods for external access
    exportFilteredTrades() {
        this.tradeManager.exportTradesToCSV();
    }

    clearAllTrades() {
        this.tradeManager.clearAllTrades();
    }

    showAllTrades() {
        this.tradeManager.showAllTrades();
    }

    async loadEarlierData() {
        await this.navigationManager.loadEarlierData();
    }

    async loadMoreRecentData() {
        await this.navigationManager.loadMoreRecentData();
    }

    // Utility methods
    getCurrentSymbol() {
        return this.currentSymbol;
    }

    getCurrentTimeframe() {
        return this.currentTimeframe;
    }

    getSelectedBacktestId() {
        return this.selectedBacktestId;
    }

    // Debug methods
    getCacheInfo() {
        return this.dataManager.getCacheInfo();
    }

    getChartData() {
        return this.chartManager.chartData;
    }

    getTrades() {
        return {
            original: this.tradeManager.originalTrades,
            filtered: this.tradeManager.filteredTrades,
            all: this.tradeManager.trades
        };
    }
}

// Initialize app when page loads
let tradingApp;

window.addEventListener('DOMContentLoaded', function() {
    // Wait for all modules to load
    setTimeout(async function() {
        try {
            if (typeof ChartManager === 'undefined' || 
                typeof DataManager === 'undefined' || 
                typeof TradeManager === 'undefined' || 
                typeof UIManager === 'undefined' || 
                typeof NavigationManager === 'undefined') {
                throw new Error('Required modules not loaded');
            }

            tradingApp = new TradingChartApp();
            await tradingApp.initialize();

            // Expose app to window for debugging
            window.tradingApp = tradingApp;
            
            // Maintain backward compatibility
            window.tradingChart = {
                exportFilteredTrades: () => tradingApp.exportFilteredTrades(),
                resetAllFilters: () => tradingApp.resetAllFilters(),
                clearAllTrades: () => tradingApp.clearAllTrades(),
                showAllTrades: () => tradingApp.showAllTrades(),
                loadEarlierData: () => tradingApp.loadEarlierData(),
                loadMoreRecentData: () => tradingApp.loadMoreRecentData()
            };

            console.log("🎉 Trading Chart Application ready!");
        } catch (error) {
            console.error("❌ Failed to initialize Trading Chart Application:", error);
            document.getElementById('loadingIndicator').textContent = 'Failed to initialize application';
        }
    }, 500);
});

// Export for use in other modules
window.TradingChartApp = TradingChartApp;
