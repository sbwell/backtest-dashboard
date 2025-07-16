// chart.js - Complete fixed version

let candlestickSeries;
let trades = [];
let chart;
let markers = [];
let tradeLines = [];
let selectedBacktestId = null;
let chartData = [];
let originalTrades = [];
let filteredTrades = [];

// Performance optimization: debounce filter updates
let filterUpdateTimeout = null;

// Manual loading approach (no automatic infinite scroll)
let isLoadingMoreData = false;
let hasMoreDataLeft = true;
let hasMoreDataRight = true;
let currentSymbol = '';
let currentTimeframe = '';

const metricsToFilter = [
    "atr_20d", "avg_volume_20d", "rvol",
    "move_1h", "move_1h_atr", "move_2h", "move_2h_atr", "move_1d", "move_1d_atr",
    "range_15m", "range_15m_atr", "range_60m", "range_60m_atr",
    "range_2h", "range_2h_atr", "range_1d", "range_1d_atr"
];

const metricsToBucket = [...metricsToFilter];
const activeFilters = {};

// Add loading state management
const loadingStates = {
    chart: false,
    trades: false,
    backtests: false
};

function setLoadingState(component, isLoading) {
    loadingStates[component] = isLoading;
    updateLoadingUI();
}

function updateLoadingUI() {
    const isAnyLoading = Object.values(loadingStates).some(state => state);
    document.body.style.cursor = isAnyLoading ? 'wait' : 'default';
    
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.style.display = isAnyLoading ? 'block' : 'none';
    }
}

// Utility functions
function debounce(func, wait) {
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

function showErrorMessage(message) {
    console.error(message);
}

function timestampExists(ts) {
    return chartData.some(c => Math.abs(c.time - ts) <= 60 * 15);
}

function getNearestTime(ts) {
    if (!chartData || chartData.length === 0) return ts;

    let closestIndex = 0;
    let minDiff = Math.abs(chartData[0].time - ts);

    for (let i = 1; i < chartData.length; i++) {
        const diff = Math.abs(chartData[i].time - ts);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }

    return chartData[closestIndex].time;
}

function formatDateTime(isoString) {
    if (!isoString) return "—";
    try {
        const date = new Date(isoString);
        return date.toLocaleString([], {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch (error) {
        return isoString.replace("T", " ").replace("Z", "");
    }
}

function updateElementText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

// Main functions
function clearAllTrades() {
    if (!candlestickSeries) return;
    
    candlestickSeries.setMarkers([]);
    markers = [];
    
    tradeLines.forEach(line => {
        try {
            chart.removeSeries(line);
        } catch (err) {
            console.warn("Error removing trade line:", err);
        }
    });
    tradeLines = [];
    
    document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
}

function showAllTrades() {
    if (!candlestickSeries || !trades.length) return;
    
    clearAllTrades();
    
    // Batch process markers for better performance
    const newMarkers = [];
    const newLines = [];
    
    trades.forEach(trade => {
        const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
        const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
        const isBuy = trade.side === "buy";

        if (!timestampExists(entryTime) || !timestampExists(exitTime)) return;

        const snappedEntryTime = getNearestTime(entryTime);
        const snappedExitTime = getNearestTime(exitTime);

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
        const lineSeries = chart.addLineSeries({ 
            color: trade.pnl > 0 ? "green" : "red", 
            lineWidth: 1,
            lineStyle: trade.pnl > 0 ? 0 : 1 // solid for profit, dashed for loss
        });
        lineSeries.setData([
            { time: snappedEntryTime, value: trade.entry_price },
            { time: snappedExitTime, value: trade.exit_price }
        ]);
        newLines.push(lineSeries);
    });

    // Apply all markers at once
    markers = newMarkers;
    tradeLines = newLines;
    candlestickSeries.setMarkers(markers);
    
    document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
}

function scrollToTrade(trade) {
    if (!chart || !chartData.length) return;
    
    const entryTs = Math.floor(new Date(trade.entry_time).getTime() / 1000);
    const exitTs = Math.floor(new Date(trade.exit_time).getTime() / 1000);
    
    if (!timestampExists(entryTs) || !timestampExists(exitTs)) {
        console.warn("Trade timestamps not found in chart data");
        return;
    }

    const snappedEntry = getNearestTime(entryTs);
    const snappedExit = getNearestTime(exitTs);

    // Clear existing markers and lines
    clearAllTrades();

    // Calculate view range
    const mid = Math.floor((snappedEntry + snappedExit) / 2);
    const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
    const buffer = timePerBar * 50;

    // Set visible range
    chart.timeScale().setVisibleRange({
        from: Math.max(mid - buffer, chartData[0].time),
        to: Math.min(mid + buffer, chartData.at(-1).time)
    });

    // Create markers
    const isBuy = trade.side === "buy";
    const profitColor = trade.pnl > 0 ? "#4caf50" : "#f44336";
    
    markers = [
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
    const line = chart.addLineSeries({ 
        color: profitColor, 
        lineWidth: 2,
        lineStyle: trade.pnl > 0 ? 0 : 1 // solid for profit, dashed for loss
    });
    
    line.setData([
        { time: snappedEntry, value: trade.entry_price },
        { time: snappedExit, value: trade.exit_price }
    ]);
    
    tradeLines = [line];
    candlestickSeries.setMarkers(markers);
    
    // Auto-scale price to show the trade clearly
    setTimeout(() => {
        candlestickSeries.priceScale().applyOptions({ autoScale: true });
    }, 100);
}

// Keyboard navigation with edge stopping

// Replace your ENTIRE handleKeyboardNavigation function with this complete version:

function handleKeyboardNavigation(e) {
    if (!chart || !chartData.length) return;
    
    const range = chart.timeScale().getVisibleRange();
    if (!range) return;

    const timePerBar = (chartData.at(-1)?.time - chartData[0]?.time) / chartData.length;
    const step = timePerBar * 5; // scroll 5 bars worth of time
    
    // Get the absolute boundaries of our data
    const firstTime = chartData[0]?.time;
    const lastTime = chartData.at(-1)?.time;
    
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
            chart.timeScale().setVisibleRange({
                from: firstTime,
                to: firstTime + (range.to - range.from)
            });
            console.log("📍 Snapped to left edge of data");
        } else {
            chart.timeScale().setVisibleRange({
                from: newFrom,
                to: newTo
            });
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
            chart.timeScale().setVisibleRange({
                from: lastTime - (range.to - range.from),
                to: lastTime
            });
            console.log("📍 Snapped to right edge of data");
        } else {
            chart.timeScale().setVisibleRange({
                from: newFrom,
                to: newTo
            });
        }
    }

// Replace your Home and End key handling with this:

// Replace your Home and End key handling with this simple approach:

    if (e.key === "Home") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    
        const firstTime = chartData[0]?.time;
        if (firstTime) {
            // SIMPLE: Always show exactly 100 bars from the start
            const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
            const show100Bars = timePerBar * 100;
        
            chart.timeScale().setVisibleRange({
                from: firstTime,
                to: firstTime + show100Bars
            });
        
            console.log("🏠 Home: Showing first 100 bars");
        }
    }

    if (e.key === "End") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    
        const lastTime = chartData[chartData.length - 1]?.time;
        if (lastTime) {
            // SIMPLE: Always show exactly 100 bars from the end
            const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
            const show100Bars = timePerBar * 100;
        
            chart.timeScale().setVisibleRange({
                from: lastTime - show100Bars,
                to: lastTime
            });
        
            console.log("🔚 End: Showing last 100 bars");
        }
    }

    // Optional: Also make R key do the same thing for consistency
    if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    
        const lastTime = chartData.at(-1)?.time;
        const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
        const show100Bars = timePerBar * 100;

        chart.timeScale().setVisibleRange({
            from: lastTime - show100Bars,
            to: lastTime
        });

        // Auto-scale price
        setTimeout(() => {
            candlestickSeries.priceScale().applyOptions({ autoScale: true });
        }, 50);
    
        console.log("🔄 Reset: Showing last 100 bars with auto-scale");
    }
}

function handleWindowResize() {
    if (!chart) return;
    const chartContainer = document.getElementById("chart");
    chart.resize(chartContainer.clientWidth, 500);
}

function initializeEventListeners() {
    document.getElementById("loadBacktestBtn").addEventListener("click", async () => {
        await fetchBacktests();
    });

    document.getElementById("clearTradesBtn").addEventListener("click", clearAllTrades);
    document.getElementById("showAllTradesBtn").addEventListener("click", showAllTrades);
    document.getElementById("symbol").addEventListener("change", fetchBacktests);
    document.getElementById("timeframe").addEventListener("change", async () => {
        await fetchBacktests();
    });

    // Keyboard navigation
    document.addEventListener("keydown", handleKeyboardNavigation);
    
    // Window resize handler
    window.addEventListener("resize", debounce(handleWindowResize, 250));
}

window.onload = () => {
    initializeEventListeners();
    fetchBacktests();
};

async function fetchBacktests() {
    setLoadingState('backtests', true);
    
    try {
        const symbol = document.getElementById("symbol").value;
        const res = await fetch("/backtests");
        const data = await res.json();
        const select = document.getElementById("backtest-select");

        const previousValue = select.value;
        select.innerHTML = "";

        const filtered = data.filter(bt => bt.symbol === symbol || bt.symbol === "multi");

        filtered.forEach(bt => {
            const option = document.createElement("option");
            option.value = bt.id;
            option.textContent = bt.name || bt.run_name || `Backtest ${bt.id}`;
            select.appendChild(option);
        });

        if (filtered.some(bt => bt.id == previousValue)) {
            select.value = previousValue;
            selectedBacktestId = previousValue;
        } else if (filtered.length > 0) {
            select.value = filtered[0].id;
            selectedBacktestId = filtered[0].id;
        } else {
            selectedBacktestId = null;
        }

        await renderChart();
    } catch (error) {
        console.error("Failed to fetch backtests:", error);
        showErrorMessage("Failed to load backtests. Please try again.");
    } finally {
        setLoadingState('backtests', false);
    }
}

async function renderChart() {
    setLoadingState('chart', true);
    
    try {
        const chartContainer = document.getElementById("chart");
        chartContainer.innerHTML = "";
        chartContainer.style.position = "relative";

        // Create hover box
        const hover = createHoverBox();
        chartContainer.appendChild(hover);

        const symbol = document.getElementById("symbol").value;
        const timeframe = document.getElementById("timeframe").value;
        const isJPY = symbol.endsWith("JPY");

        // Clear trade table
        const tableBody = document.querySelector("#trades tbody");
        if (tableBody) tableBody.innerHTML = "";

        // Remove existing chart
        if (chart) {
            chart.remove();
            chart = null;
        }

        // Create chart with simple configuration
        chart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: 500,
            layout: {
                background: { color: "#ffffff" },
                textColor: "#000000"
            },
            grid: {
                vertLines: { color: "#e1e1e1" },
                horzLines: { color: "#e1e1e1" }
            },
            timeScale: {
                borderVisible: true,
                timeVisible: true,
                borderColor: "#D1D4DC",
                timeFormatter: time => {
                    const d = new Date(time * 1000);
                    return d.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        hour12: false 
                    });
                }
            },
            localization: {
                priceFormatter: price => Number(price).toFixed(isJPY ? 2 : 4)
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal
            }
        });

        console.log("📊 Chart created with simple configuration");

        candlestickSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        });

        // Enhanced crosshair subscription
        chart.subscribeCrosshairMove(createCrosshairHandler());

        // NO AUTOMATIC INFINITE SCROLL - only manual loading

        // Load candle data
        await loadCandleData(symbol, timeframe);
        
        // Load trade data if backtest is selected
        if (selectedBacktestId) {
            await loadTradeData(symbol);
        }
    } catch (error) {
        console.error("Failed to render chart:", error);
        showErrorMessage("Failed to render chart. Please try again.");
    } finally {
        setLoadingState('chart', false);
    }
}

function createHoverBox() {
    const hover = document.createElement("div");
    hover.id = "hoverBox";
    hover.style.position = "absolute";
    hover.style.top = "10px";
    hover.style.left = "10px";
    hover.style.backgroundColor = "rgba(255,255,255,0.95)";
    hover.style.border = "1px solid #ccc";
    hover.style.borderRadius = "4px";
    hover.style.padding = "8px";
    hover.style.fontSize = "13px";
    hover.style.fontFamily = "monospace";
    hover.style.zIndex = "10";
    hover.style.pointerEvents = "none";
    hover.style.whiteSpace = "pre-line";
    hover.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
    return hover;
}

function createCrosshairHandler() {
    return (param) => {
        const hoverBox = document.getElementById("hoverBox");
        if (!hoverBox) return;

        if (!param.point || !param.time || !param.seriesData.has(candlestickSeries)) {
            hoverBox.textContent = "";
            return;
        }

        const d = param.seriesData.get(candlestickSeries);
        const date = new Date(param.time * 1000).toLocaleString();
        
        // Enhanced hover display
        hoverBox.innerText = `Time:   ${date}
Open:   ${d.open}
High:   ${d.high}
Low:    ${d.low}
Close:  ${d.close}
Volume: ${d.volume ? Number(d.volume).toLocaleString() : "—"}`;
    };
}

async function loadCandleData(symbol, timeframe) {
    try {
        // Store current symbol and timeframe
        currentSymbol = symbol;
        currentTimeframe = timeframe;
        
        // Reset loading states
        hasMoreDataLeft = true;
        hasMoreDataRight = true;
        isLoadingMoreData = false;
        
        console.log(`🔧 Loading initial data for ${symbol} ${timeframe}`);
        
        const candleRes = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}`);
        if (!candleRes.ok) throw new Error(`HTTP ${candleRes.status}`);
        
        chartData = await candleRes.json();
        
        if (!chartData || chartData.length === 0) {
            console.warn("Empty chart data returned for:", symbol);
            return;
        }
        
        candlestickSeries.setData(chartData);
        
        console.log(`✅ Loaded ${chartData.length} initial candles for ${symbol} ${timeframe}`);
    } catch (err) {
        console.error("Failed to load candles:", err);
        showErrorMessage("Failed to load price data.");
        throw err;
    }
}

async function loadTradeData(symbol) {
    setLoadingState('trades', true);
    
    try {
        const tradeRes = await fetch(`/trades?backtest_id=${selectedBacktestId}&symbol=${symbol}`);
        if (!tradeRes.ok) throw new Error(`HTTP ${tradeRes.status}`);
        
        trades = await tradeRes.json();
        originalTrades = [...trades];
        filteredTrades = [...originalTrades];

        renderSummary(filteredTrades, originalTrades);
        renderFilters(originalTrades);
        renderAllBuckets(originalTrades);
        renderTradeTable(filteredTrades);
    } catch (error) {
        console.error("Failed to load trades:", error);
        showErrorMessage("Failed to load trade data.");
    } finally {
        setLoadingState('trades', false);
    }
}

// Manual data loading functions
async function loadEarlierData() {
    if (!chartData.length || isLoadingMoreData || !hasMoreDataLeft) {
        console.log('Cannot load earlier data - no data, already loading, or no more data available');
        return;
    }
    
    isLoadingMoreData = true;
    const loadEarlierBtn = document.getElementById('loadEarlierBtn');
    if (loadEarlierBtn) {
        loadEarlierBtn.disabled = true;
        loadEarlierBtn.textContent = 'Loading...';
    }
    
    try {
        const earliestTime = chartData[0]?.time;
        console.log('🔄 Loading earlier data before:', new Date(earliestTime * 1000).toISOString());
        
        const res = await fetch(`/candles?symbol=${currentSymbol}&timeframe=${currentTimeframe}&before=${earliestTime}&limit=3000`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const moreData = await res.json();
        
        if (moreData && moreData.length > 0) {
            console.log(`✅ Loaded ${moreData.length} earlier candles`);
            chartData = [...moreData, ...chartData];
            candlestickSeries.setData(chartData);
            
            // Reapply markers if they exist
            if (markers && markers.length > 0) {
                candlestickSeries.setMarkers(markers);
            }
        } else {
            hasMoreDataLeft = false;
            console.log('No more earlier data available');
        }
    } catch (err) {
        console.error("Error loading earlier data:", err);
        hasMoreDataLeft = false;
    } finally {
        isLoadingMoreData = false;
        if (loadEarlierBtn) {
            loadEarlierBtn.disabled = false;
            loadEarlierBtn.textContent = '← Load Earlier Data';
        }
    }
}

async function loadMoreRecentData() {
    if (!chartData.length || isLoadingMoreData || !hasMoreDataRight) {
        console.log('Cannot load more recent data - no data, already loading, or no more data available');
        return;
    }
    
    isLoadingMoreData = true;
    const loadMoreRecentBtn = document.getElementById('loadMoreRecentBtn');
    if (loadMoreRecentBtn) {
        loadMoreRecentBtn.disabled = true;
        loadMoreRecentBtn.textContent = 'Loading...';
    }
    
    try {
        const latestTime = chartData[chartData.length - 1]?.time;
        console.log('🔄 Loading more recent data after:', new Date(latestTime * 1000).toISOString());
        
        const res = await fetch(`/candles?symbol=${currentSymbol}&timeframe=${currentTimeframe}&after=${latestTime}&limit=3000`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const moreData = await res.json();
        
        if (moreData && moreData.length > 0) {
            console.log(`✅ Loaded ${moreData.length} more recent candles`);
            chartData = [...chartData, ...moreData];
            candlestickSeries.setData(chartData);
            
            // Reapply markers if they exist
            if (markers && markers.length > 0) {
                candlestickSeries.setMarkers(markers);
            }
        } else {
            hasMoreDataRight = false;
            console.log('No more recent data available');
        }
    } catch (err) {
        console.error("Error loading more recent data:", err);
        hasMoreDataRight = false;
    } finally {
        isLoadingMoreData = false;
        if (loadMoreRecentBtn) {
            loadMoreRecentBtn.disabled = false;
            loadMoreRecentBtn.textContent = 'Load More Recent Data →';
        }
    }
}

// Filter and analysis functions
function updateFilteredTrades() {
    if (filterUpdateTimeout) {
        clearTimeout(filterUpdateTimeout);
    }
    
    filterUpdateTimeout = setTimeout(() => {
        filteredTrades = originalTrades.filter(t => {
            for (const [key, [min, max]] of Object.entries(activeFilters)) {
                const value = t[key];
                if (value == null) return false;
                const EPSILON = 0.00009;
                if (value < min - EPSILON || value > max + EPSILON) return false;
            }
            return true;
        });
        
        renderSummary(filteredTrades, originalTrades);
        renderAllBuckets(filteredTrades);
        renderTradeTable(filteredTrades);
    }, 100);
}

function renderSummary(filtered, original) {
    function summarize(trades) {
        if (!trades.length) {
            return { profit: 0, efficiency: 0, total: 0, winRate: 0, start: "—", end: "—" };
        }
        
        const total = trades.length;
        const profit = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
        const wins = trades.filter(t => t.pnl > 0).length;
        const efficiency = profit / total;
        const winRate = (wins / total) * 100;
        const start = new Date(trades[0].entry_time).toLocaleString();
        const end = new Date(trades.at(-1).exit_time).toLocaleString();
        return { profit, efficiency, total, winRate, start, end };
    }

    const f = summarize(filtered);
    const o = summarize(original);

    // Update filtered stats
    updateElementText("sumProfitFiltered", f.profit.toFixed(2));
    updateElementText("sumEfficiencyFiltered", f.efficiency.toFixed(4));
    updateElementText("sumTradesFiltered", f.total);
    updateElementText("sumWinRateFiltered", f.winRate.toFixed(1) + "%");
    updateElementText("sumStartFiltered", f.start);
    updateElementText("sumEndFiltered", f.end);

    // Update original stats
    updateElementText("sumProfitOriginal", o.profit.toFixed(2));
    updateElementText("sumEfficiencyOriginal", o.efficiency.toFixed(4));
    updateElementText("sumTradesOriginal", o.total);
    updateElementText("sumWinRateOriginal", o.winRate.toFixed(1) + "%");
    updateElementText("sumStartOriginal", o.start);
    updateElementText("sumEndOriginal", o.end);
}

function renderFilters(trades) {
    const container = document.getElementById("filtersContainer");
    if (!container) return;
    
    container.innerHTML = "";

    metricsToFilter.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        const min = Math.min(...values);
        const max = Math.max(...values);
        if (min === max) return; // Skip if no range

        const wrapper = createFilterWrapper(metric, min, max);
        container.appendChild(wrapper);
    });
}

function createFilterWrapper(metric, min, max) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "20px";

    const label = document.createElement("label");
    label.innerHTML = `<strong>${metric}</strong>`;
    wrapper.appendChild(label);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "12px";
    row.style.marginTop = "5px";

    const minInput = createNumericInput(`${metric}-min`, min);
    const maxInput = createNumericInput(`${metric}-max`, max);

    const sliderDiv = document.createElement("div");
    sliderDiv.id = `${metric}-slider`;
    sliderDiv.style.flex = "1";
    sliderDiv.style.maxWidth = "300px";

    row.appendChild(minInput);
    row.appendChild(document.createTextNode("to"));
    row.appendChild(maxInput);
    row.appendChild(sliderDiv);
    wrapper.appendChild(row);

    // Create slider
    const slider = noUiSlider.create(sliderDiv, {
        start: [min, max],
        connect: true,
        step: Math.max(0.0001, (max - min) / 1000),
        range: { min, max },
        format: {
            to: v => parseFloat(v).toFixed(4),
            from: v => parseFloat(v)
        }
    });

    // Handle slider updates
    slider.on("update", values => {
        const [vMin, vMax] = values.map(parseFloat);
        minInput.value = vMin.toFixed(4);
        maxInput.value = vMax.toFixed(4);
        activeFilters[metric] = [vMin, vMax];
        updateFilteredTrades();
    });

    // Sync inputs to slider
    const syncInputsToSlider = () => {
        const valMin = parseFloat(minInput.value);
        const valMax = parseFloat(maxInput.value);
        if (!isNaN(valMin) && !isNaN(valMax) && valMin <= valMax) {
            slider.set([valMin, valMax]);
        }
    };

    minInput.addEventListener("change", syncInputsToSlider);
    maxInput.addEventListener("change", syncInputsToSlider);

    return wrapper;
}

function createNumericInput(id, value) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.0001";
    input.style.width = "80px";
    input.id = id;
    input.value = value.toFixed(4);
    input.style.textAlign = "right";
    return input;
}

function renderAllBuckets(trades) {
    const bucketContainer = document.getElementById("tab-buckets");
    if (!bucketContainer) return;
    
    bucketContainer.innerHTML = "";

    metricsToBucket.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        const section = createBucketSection(metric, trades, values);
        bucketContainer.appendChild(section);
    });
}

function createBucketSection(metric, trades, values) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    const range = max - min;
    
    if (range === 0) return document.createElement("div"); // Skip if no range

    const step = getNiceStep(range);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;

    const defaultBoundaries = [];
    for (let i = 0; i <= 6; i++) {
        let boundary = +(min + i * step).toFixed(4);
        if (i === 0) boundary = -999999;
        if (i === 6) boundary = 999999;
        defaultBoundaries.push(boundary);
    }

    const section = document.createElement("div");
    section.innerHTML = `<h4>${metric}</h4>`;
    section.style.marginBottom = "20px";

    const table = createBucketTable();
    const tbody = table.querySelector("tbody");
    const rows = [];

    // Create bucket rows
    for (let i = 0; i < 6; i++) {
        const rowData = createBucketRow(defaultBoundaries[i], defaultBoundaries[i + 1], metric, trades);
        tbody.appendChild(rowData.element);
        rows.push(rowData);
    }

    // Setup cross-updating logic
    setupBucketRowUpdates(rows);

    section.appendChild(table);
    return section;
}

function getNiceStep(range) {
    const pow = Math.pow(10, Math.floor(Math.log10(range / 6)));
    const candidates = [1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001];
    for (const c of candidates) {
        const step = c * pow;
        if (range / step <= 10) return step;
    }
    return pow;
}

function createBucketTable() {
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.fontSize = "12px";
    table.innerHTML = `
        <thead>
            <tr>
                <th>Min</th>
                <th>Max</th>
                <th>Profit</th>
                <th>Trades</th>
                <th>Win %</th>
                <th>Efficiency</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    return table;
}

function createBucketRow(bMin, bMax, metric, trades) {
    const row = document.createElement("tr");

    const inputMin = createNumericInput(`${metric}-bucket-min`, bMin);
    const inputMax = createNumericInput(`${metric}-bucket-max`, bMax);

    const cells = [];
    for (let j = 0; j < 6; j++) {
        const td = document.createElement("td");
        if (j === 0) td.appendChild(inputMin);
        else if (j === 1) td.appendChild(inputMax);
        cells.push(td);
        row.appendChild(td);
    }

    const updateStats = () => {
        const minVal = parseFloat(inputMin.value);
        const maxVal = parseFloat(inputMax.value);
        const group = trades.filter(t => t[metric] >= minVal && t[metric] < maxVal);
        const profit = group.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
        const count = group.length;
        const wins = group.filter(t => t.pnl > 0).length;
        const winRate = count > 0 ? (wins / count) * 100 : 0;
        const efficiency = count > 0 ? profit / count : 0;

        cells[2].textContent = profit.toFixed(2);
        cells[3].textContent = count;
        cells[4].textContent = winRate.toFixed(1) + "%";
        cells[5].textContent = efficiency.toFixed(4);
        
        // Color code the row based on efficiency
        const color = efficiency > 0 ? '#e8f5e8' : efficiency < 0 ? '#ffe8e8' : '';
        row.style.backgroundColor = color;
    };

    return {
        element: row,
        inputMin,
        inputMax,
        cells,
        updateStats
    };
}

function setupBucketRowUpdates(rows) {
    rows.forEach((rowObj, i) => {
        const { inputMin, inputMax, updateStats } = rowObj;

        inputMin.addEventListener("change", () => {
            let minVal = parseFloat(inputMin.value);
            let maxVal = parseFloat(inputMax.value);

            if (minVal > maxVal) {
                minVal = maxVal;
                inputMin.value = minVal.toFixed(4);
            }

            if (i > 0) {
                rows[i - 1].inputMax.value = inputMin.value;
                rows[i - 1].updateStats();
            }

            updateStats();
        });

        inputMax.addEventListener("change", () => {
            let minVal = parseFloat(inputMin.value);
            let maxVal = parseFloat(inputMax.value);

            if (maxVal < minVal) {
                maxVal = minVal;
                inputMax.value = maxVal.toFixed(4);
            }

            if (i < rows.length - 1) {
                rows[i + 1].inputMin.value = inputMax.value;
                rows[i + 1].updateStats();
            }

            updateStats();
        });

        updateStats();
    });
}

function renderTradeTable(trades) {
    const tableBody = document.querySelector("#trades tbody");
    if (!tableBody) return;
    
    tableBody.innerHTML = "";

    trades.forEach((trade, i) => {
        const row = createTradeRow(trade);
        tableBody.appendChild(row);
    });
}

function createTradeRow(trade) {
    const row = document.createElement("tr");
    const symbol = document.getElementById("symbol")?.value || trade.symbol || "";
    
    // Color code based on PnL
    const pnl = trade.pnl ?? 0;
    if (pnl > 0) {
        row.style.backgroundColor = '#e8f5e8';
    } else if (pnl < 0) {
        row.style.backgroundColor = '#ffe8e8';
    }
    
    row.innerHTML = `
        <td>${trade.symbol ?? symbol}</td>
        <td>${formatDateTime(trade.entry_time)}</td>
        <td>${formatDateTime(trade.exit_time)}</td>
        <td style="color: ${trade.side === 'buy' ? '#2e7d32' : '#d32f2f'}">${trade.side}</td>
        <td>${trade.entry_price?.toFixed(4) ?? "—"}</td>
        <td>${trade.exit_price?.toFixed(4) ?? "—"}</td>
        <td style="color: ${pnl > 0 ? '#2e7d32' : pnl < 0 ? '#d32f2f' : '#666'}">${trade.pnl?.toFixed(2) ?? "—"}</td>
    `;

    row.addEventListener("click", () => {
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
        row.classList.add("selected-row");
        scrollToTrade(trade);
    });
    
    return row;
}

// Export and utility functions
function exportFilteredTrades() {
    if (!filteredTrades.length) {
        alert("No trades to export");
        return;
    }
    
    const csv = convertTradesToCSV(filteredTrades);
    downloadCSV(csv, `filtered_trades_${new Date().toISOString().split('T')[0]}.csv`);
}

function convertTradesToCSV(trades) {
    if (!trades.length) return "";
    
    const headers = Object.keys(trades[0]).join(',');
    const rows = trades.map(trade => 
        Object.values(trade).map(value => 
            typeof value === 'string' && value.includes(',') ? `"${value}"` : value
        ).join(',')
    );
    
    return [headers, ...rows].join('\n');
}

function downloadCSV(csv, filename) {
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

function resetAllFilters() {
    // Clear active filters
    Object.keys(activeFilters).forEach(key => delete activeFilters[key]);
    
    // Reset all sliders and inputs
    document.querySelectorAll('[id$="-slider"]').forEach(sliderDiv => {
        if (sliderDiv.noUiSlider) {
            const range = sliderDiv.noUiSlider.options.range;
            sliderDiv.noUiSlider.set([range.min, range.max]);
        }
    });
    
    // Update filtered trades
    filteredTrades = [...originalTrades];
    renderSummary(filteredTrades, originalTrades);
    renderAllBuckets(filteredTrades);
    renderTradeTable(filteredTrades);
}

// Enhanced error handling
function handleError(error, context = "") {
    console.error(`Error in ${context}:`, error);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        showErrorMessage("Network error. Please check your connection and try again.");
    } else if (error.name === 'SyntaxError') {
        showErrorMessage("Data format error. Please contact support.");
    } else {
        showErrorMessage(`An error occurred${context ? ` in ${context}` : ''}. Please try again.`);
    }
}

// Export functions to window for external access
window.tradingChart = {
    exportFilteredTrades,
    resetAllFilters,
    clearAllTrades,
    showAllTrades,
    scrollToTrade,
    loadEarlierData,
    loadMoreRecentData
};

console.log("📊 Chart with manual load buttons ready!");
