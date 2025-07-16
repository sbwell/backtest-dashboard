// dataManager.js - Handles all data fetching and caching

class DataManager {
    constructor() {
        this.loadingStates = {
            chart: false,
            trades: false,
            backtests: false
        };
        this.isLoadingMoreData = false;
        this.hasMoreDataLeft = true;
        this.hasMoreDataRight = true;
        this.cache = new Map();
    }

    setLoadingState(component, isLoading) {
        this.loadingStates[component] = isLoading;
        this.updateLoadingUI();
    }

    updateLoadingUI() {
        const isAnyLoading = Object.values(this.loadingStates).some(state => state);
        document.body.style.cursor = isAnyLoading ? 'wait' : 'default';
        
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = isAnyLoading ? 'block' : 'none';
        }
    }

    showErrorMessage(message) {
        console.error(message);
        // You can enhance this to show a proper UI notification
        alert(message);
    }

    async fetchBacktests() {
        this.setLoadingState('backtests', true);
        
        try {
            const cacheKey = 'backtests';
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                console.log('📦 Using cached backtests');
                return this.cache.get(cacheKey);
            }

            const response = await fetch("/backtests");
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Cache the result
            this.cache.set(cacheKey, data);
            
            console.log(`✅ Fetched ${data.length} backtests`);
            return data;
        } catch (error) {
            console.error("Failed to fetch backtests:", error);
            this.showErrorMessage("Failed to load backtests. Please try again.");
            throw error;
        } finally {
            this.setLoadingState('backtests', false);
        }
    }

    async fetchCandleData(symbol, timeframe, options = {}) {
        this.setLoadingState('chart', true);
        
        try {
            const { start, end, before, after, limit } = options;
            const params = new URLSearchParams({
                symbol,
                timeframe
            });

            if (start) params.append('start', start);
            if (end) params.append('end', end);
            if (before) params.append('before', before);
            if (after) params.append('after', after);
            if (limit) params.append('limit', limit);

            const cacheKey = `candles_${symbol}_${timeframe}_${params.toString()}`;
            
            // Check cache for non-realtime data
            if (!before && !after && this.cache.has(cacheKey)) {
                console.log('📦 Using cached candle data');
                return this.cache.get(cacheKey);
            }

            console.log(`🔄 Fetching candle data for ${symbol} ${timeframe}`);
            
            const response = await fetch(`/candles?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data || data.length === 0) {
                console.warn("Empty candle data returned");
                return [];
            }

            // Cache initial loads only (not incremental loads)
            if (!before && !after) {
                this.cache.set(cacheKey, data);
            }
            
            console.log(`✅ Fetched ${data.length} candles`);
            return data;
        } catch (error) {
            console.error("Failed to fetch candle data:", error);
            this.showErrorMessage("Failed to load price data.");
            throw error;
        } finally {
            this.setLoadingState('chart', false);
        }
    }

    async fetchTradeData(backtestId, symbol = null) {
        this.setLoadingState('trades', true);
        
        try {
            const params = new URLSearchParams({
                backtest_id: backtestId
            });

            if (symbol) {
                params.append('symbol', symbol);
            }

            const cacheKey = `trades_${backtestId}_${symbol || 'all'}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                console.log('📦 Using cached trade data');
                return this.cache.get(cacheKey);
            }

            console.log(`🔄 Fetching trades for backtest ${backtestId}`);
            
            const response = await fetch(`/trades?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Cache the result
            this.cache.set(cacheKey, data);
            
            console.log(`✅ Fetched ${data.length} trades`);
            return data;
        } catch (error) {
            console.error("Failed to fetch trade data:", error);
            this.showErrorMessage("Failed to load trade data.");
            throw error;
        } finally {
            this.setLoadingState('trades', false);
        }
    }

    async loadEarlierData(symbol, timeframe, earliestTime) {
        if (this.isLoadingMoreData || !this.hasMoreDataLeft) {
            console.log('Cannot load earlier data - already loading or no more data available');
            return null;
        }
        
        this.isLoadingMoreData = true;
        const loadEarlierBtn = document.getElementById('loadEarlierBtn');
        if (loadEarlierBtn) {
            loadEarlierBtn.disabled = true;
            loadEarlierBtn.textContent = 'Loading...';
        }
        
        try {
            console.log('🔄 Loading earlier data before:', new Date(earliestTime * 1000).toISOString());
            
            const data = await this.fetchCandleData(symbol, timeframe, {
                before: earliestTime,
                limit: 3000
            });
            
            if (data && data.length > 0) {
                console.log(`✅ Loaded ${data.length} earlier candles`);
                return data;
            } else {
                this.hasMoreDataLeft = false;
                console.log('No more earlier data available');
                return null;
            }
        } catch (error) {
            console.error("Error loading earlier data:", error);
            this.hasMoreDataLeft = false;
            return null;
        } finally {
            this.isLoadingMoreData = false;
            if (loadEarlierBtn) {
                loadEarlierBtn.disabled = false;
                loadEarlierBtn.textContent = '← Load Earlier Data';
            }
        }
    }

    async loadMoreRecentData(symbol, timeframe, latestTime) {
        if (this.isLoadingMoreData || !this.hasMoreDataRight) {
            console.log('Cannot load more recent data - already loading or no more data available');
            return null;
        }
        
        this.isLoadingMoreData = true;
        const loadMoreRecentBtn = document.getElementById('loadMoreRecentBtn');
        if (loadMoreRecentBtn) {
            loadMoreRecentBtn.disabled = true;
            loadMoreRecentBtn.textContent = 'Loading...';
        }
        
        try {
            console.log('🔄 Loading more recent data after:', new Date(latestTime * 1000).toISOString());
            
            const data = await this.fetchCandleData(symbol, timeframe, {
                after: latestTime,
                limit: 3000
            });
            
            if (data && data.length > 0) {
                console.log(`✅ Loaded ${data.length} more recent candles`);
                return data;
            } else {
                this.hasMoreDataRight = false;
                console.log('No more recent data available');
                return null;
            }
        } catch (error) {
            console.error("Error loading more recent data:", error);
            this.hasMoreDataRight = false;
            return null;
        } finally {
            this.isLoadingMoreData = false;
            if (loadMoreRecentBtn) {
                loadMoreRecentBtn.disabled = false;
                loadMoreRecentBtn.textContent = 'Load More Recent Data →';
            }
        }
    }

    // Reset loading states for new symbol/timeframe
    resetLoadingStates() {
        this.hasMoreDataLeft = true;
        this.hasMoreDataRight = true;
        this.isLoadingMoreData = false;
    }

    // Clear cache for specific keys or all
    clearCache(pattern = null) {
        if (pattern) {
            for (const [key] of this.cache) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
        console.log('🗑️ Cache cleared');
    }

    // Get cache size for debugging
    getCacheInfo() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

// Export for use in other modules
window.DataManager = DataManager;
