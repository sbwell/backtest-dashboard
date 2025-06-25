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

// Infinite scroll state
let isLoadingMoreData = false;
let hasMoreDataLeft = true;
let hasMoreDataRight = true;
let currentSymbol = '';
let currentTimeframe = '';
let keyRepeatTimeout = null;

// Track phantom data state to avoid constant recreation
let phantomDataActive = false;
let phantomDataExtension = 0;

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
    
    // You could add a loading spinner here
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.style.display = isAnyLoading ? 'block' : 'none';
    }
}

window.onload = () => {
    initializeEventListeners();
    fetchBacktests();
};

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

    // NUCLEAR OPTION: Override ALL keyboard events globally
    const handleKeyboardOverride = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            console.log(`🚨 NUCLEAR OVERRIDE: ${e.key} - Forcing our handler`);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Call our handler directly
            handleKeyboardNavigation(e);
            return false;
        }
    };
    
    // Add multiple layers of event interception
    document.addEventListener("keydown", handleKeyboardOverride, true); // Capture phase
    document.addEventListener("keydown", handleKeyboardNavigation, true);
    window.addEventListener("keydown", handleKeyboardOverride, true);
    window.addEventListener("keydown", handleKeyboardNavigation, true);
    document.body.addEventListener("keydown", handleKeyboardOverride, true);
    document.body.addEventListener("keydown", handleKeyboardNavigation, true);
    
    // Add to window load to catch any late-binding handlers
    window.addEventListener('load', () => {
        setTimeout(() => {
            document.addEventListener("keydown", handleKeyboardOverride, true);
            window.addEventListener("keydown", handleKeyboardOverride, true);
            console.log("🔒 Late-stage keyboard override installed");
        }, 1000);
    });
    
    // Add focus to ensure keyboard events work
    document.addEventListener("click", () => {
        document.body.focus();
    });
    
    // Make sure body can receive focus
    document.body.setAttribute("tabindex", "0");
    document.body.focus();
    
    console.log("🎹 NUCLEAR keyboard event override system initialized");
    
    // Window resize handler
    window.addEventListener("resize", debounce(handleWindowResize, 250));
}

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

function handleKeyboardNavigation(e) {
    if (!chart || !chartData.length) return;
    
    // ALWAYS prevent default for arrow keys - this is critical
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        console.log(`🎹 Key pressed: ${e.key} - Default prevented`);
    }
    
    const range = chart.timeScale().getVisibleRange();
    if (!range) return;

    const timePerBar = (chartData.at(-1)?.time - chartData[0]?.time) / chartData.length;
    const step = timePerBar * 5;

    switch(e.key) {
        case "ArrowLeft":
            console.log(`🎹 Handling ArrowLeft - hasMoreDataLeft: ${hasMoreDataLeft}, isLoadingMoreData: ${isLoadingMoreData}`);
            handleLeftArrowNavigation(step, range, timePerBar);
            break;
        case "ArrowRight":
            console.log(`🎹 Handling ArrowRight - hasMoreDataRight: ${hasMoreDataRight}, isLoadingMoreData: ${isLoadingMoreData}`);
            handleRightArrowNavigation(step, range, timePerBar);
            break;
        case "Home":
            navigateToStart(range, timePerBar);
            break;
        case "End":
            navigateToEnd(range, timePerBar);
            break;
        case "r":
        case "R":
            resetChartView(timePerBar);
            break;
        case "Escape":
            clearAllTrades();
            break;
    }
}

async function handleLeftArrowNavigation(step, range, timePerBar) {
    const firstTime = chartData[0]?.time;
    const lastTime = chartData[chartData.length - 1]?.time;
    const newFrom = range.from - step;
    const newTo = range.to - step;
    
    console.log(`🔍 Left navigation: firstTime=${new Date(firstTime * 1000)}, newFrom=${new Date(newFrom * 1000)}, hasMoreDataLeft=${hasMoreDataLeft}`);
    console.log(`🔍 Current range: ${new Date(range.from * 1000)} to ${new Date(range.to * 1000)}`);
    
    // Check if we need more data - EXTREMELY aggressive buffer for seamless UX
    const bufferTime = timePerBar * 1000; // 1000 bars = ~83 hours of M5 data
    const needsMoreData = (newFrom - firstTime) <= bufferTime;
    
    console.log(`🔍 Buffer check: newFrom-firstTime = ${newFrom - firstTime}, bufferTime = ${bufferTime}, needsMoreData = ${needsMoreData}`);
    console.log(`🔍 Distance in bars: ${(newFrom - firstTime) / timePerBar} bars (buffer: 1000 bars)`);
    console.log(`🔍 isLoadingMoreData = ${isLoadingMoreData}, hasMoreDataLeft = ${hasMoreDataLeft}`);
    
    if (needsMoreData && hasMoreDataLeft && !isLoadingMoreData) {
        console.log('🔄 Loading more historical data...');
        await loadMoreHistoricalDataSync(newFrom, newTo);
        return;
    }
    
    // Calculate how far left we want to scroll beyond current data
    const distanceBeyondData = Math.max(0, firstTime - newFrom);
    
    if (distanceBeyondData <= 0 && !phantomDataActive) {
        // We're not trying to scroll beyond the data and no phantom data is active
        console.log(`📍 Not scrolling beyond data, using normal setVisibleRange`);
        chart.timeScale().setVisibleRange({
            from: newFrom,
            to: newTo
        });
        return;
    }
    
    // If phantom data is already active, don't recreate it constantly
    if (phantomDataActive && distanceBeyondData <= phantomDataExtension) {
        console.log(`👻 Using existing phantom data (distance: ${distanceBeyondData}, extension: ${phantomDataExtension})`);
        chart.timeScale().setVisibleRange({
            from: newFrom,
            to: newTo
        });
        return;
    }
    
    // NEW STRATEGY: Extend the chart data temporarily to allow scrolling
    console.log(`🚀 PHANTOM DATA STRATEGY - Creating temporary extension`);
    
    try {
        // Create phantom data points to the left of real data
        const phantomDataPoints = [];
        const extendLeftBy = Math.max(distanceBeyondData + (timePerBar * 50), timePerBar * 200); // Extend by at least 200 bars for better scrolling
        
        // Calculate the phantom range - going BACKWARDS from firstTime
        const phantomEndTime = firstTime - timePerBar; // End just before real data
        const phantomStartTime = phantomEndTime - extendLeftBy; // Start much earlier
        
        console.log(`👻 Creating phantom data from ${new Date(phantomStartTime * 1000)} to ${new Date(phantomEndTime * 1000)}`);
        console.log(`👻 timePerBar: ${timePerBar}, extendLeftBy: ${extendLeftBy}`);
        
        // Generate phantom candles going FORWARD from start to end
        for (let time = phantomStartTime; time <= phantomEndTime; time += timePerBar) {
            phantomDataPoints.push({
                time: Math.floor(time), // Ensure integer timestamps
                open: chartData[0].open,
                high: chartData[0].high,
                low: chartData[0].low,
                close: chartData[0].close
            });
        }
        
        console.log(`👻 Generated ${phantomDataPoints.length} phantom data points`);
        
        if (phantomDataPoints.length === 0) {
            console.log(`❌ No phantom data generated - falling back to normal scroll`);
            chart.timeScale().setVisibleRange({
                from: newFrom,
                to: newTo
            });
            return;
        }
        
        // Combine phantom data with real data
        const extendedData = [...phantomDataPoints, ...chartData];
        
        console.log(`📊 Extended data: ${phantomDataPoints.length} phantom + ${chartData.length} real = ${extendedData.length} total`);
        
        // Update the chart with extended data
        candlestickSeries.setData(extendedData);
        
        // Mark phantom data as active
        phantomDataActive = true;
        phantomDataExtension = extendLeftBy;
        
        // Now try to scroll to our target position
        console.log(`⬅️ Setting range with phantom data: ${new Date(newFrom * 1000)} to ${new Date(newTo * 1000)}`);
        
        chart.timeScale().setVisibleRange({
            from: newFrom,
            to: newTo
        });
        
        // Verify the scroll worked - be much more lenient with tolerance
        setTimeout(() => {
            const actualRange = chart.timeScale().getVisibleRange();
            console.log(`✅ Range after phantom data: ${new Date(actualRange.from * 1000)} to ${new Date(actualRange.to * 1000)}`);
            
            // MUCH more generous tolerance - allow LightweightCharts to extend the range as needed
            const fromTolerance = timePerBar * 10; // 10 bars tolerance
            const toTolerance = timePerBar * 60; // 60 bars tolerance (LightweightCharts extends the end a lot)
            
            const fromMatches = Math.abs(actualRange.from - newFrom) <= fromTolerance;
            const toMatches = Math.abs(actualRange.to - newTo) <= toTolerance;
            
            console.log(`🔍 From difference: ${Math.abs(actualRange.from - newFrom)} (tolerance: ${fromTolerance})`);
            console.log(`🔍 To difference: ${Math.abs(actualRange.to - newTo)} (tolerance: ${toTolerance})`);
            
            if (fromMatches) {
                console.log(`🎯 SUCCESS! Chart is showing the correct FROM range`);
                console.log(`🎯 Keeping phantom data for continued scrolling`);
                
                // Keep the phantom data in place - user can scroll around freely now
                // Only the FROM position matters for left scrolling
                
            } else {
                console.log(`❌ FROM range mismatch - removing phantom data`);
                console.log(`❌ From match: ${fromMatches}`);
                phantomDataActive = false;
                phantomDataExtension = 0;
                candlestickSeries.setData(chartData);
            }
        }, 50);
        
    } catch (error) {
        console.error(`❌ Phantom data strategy failed:`, error);
        phantomDataActive = false;
        phantomDataExtension = 0;
        // Restore original data if something goes wrong
        try {
            candlestickSeries.setData(chartData);
        } catch (e) {
            console.error(`❌ Failed to restore original data:`, e);
        }
    }
}

async function loadMoreHistoricalDataSync(targetFrom, targetTo) {
    if (isLoadingMoreData) {
        console.log('Already loading data, skipping...');
        return;
    }
    
    // Don't check hasMoreDataLeft here - let's try to load data anyway
    // and only set hasMoreDataLeft = false if we actually get no data
    
    isLoadingMoreData = true;
    
    try {
        const firstTime = chartData[0]?.time;
        if (!firstTime) {
            console.log('No chart data available');
            return;
        }
        
        console.log(`Loading historical data before ${new Date(firstTime * 1000)}`);
        console.log(`Target range: ${new Date(targetFrom * 1000)} to ${new Date(targetTo * 1000)}`);
        
        const url = `/candles?symbol=${currentSymbol}&timeframe=${currentTimeframe}&before=${firstTime}`;
        console.log(`API call: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            if (response.status === 404) {
                console.log('No more historical data available (404) - but allowing continued scrolling');
                hasMoreDataLeft = false;
                // Still allow scrolling by setting the target range
                chart.timeScale().setVisibleRange({
                    from: targetFrom,
                    to: targetTo
                });
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        
        const newData = await response.json();
        
        if (!newData || newData.length === 0) {
            console.log('No more historical data available (empty response) - but allowing continued scrolling');
            hasMoreDataLeft = false;
            // Still allow scrolling by setting the target range
            chart.timeScale().setVisibleRange({
                from: targetFrom,
                to: targetTo
            });
            return;
        }
        
        console.log(`Received ${newData.length} historical candles`);
        
        // Verify the data is actually older
        const newDataLastTime = newData[newData.length - 1]?.time;
        if (newDataLastTime && newDataLastTime >= firstTime) {
            console.log('API returned overlapping data - but allowing continued scrolling');
            hasMoreDataLeft = false;
            chart.timeScale().setVisibleRange({
                from: targetFrom,
                to: targetTo
            });
            return;
        }
        
        newData.sort((a, b) => a.time - b.time);
        
        console.log(`Old first time: ${new Date(firstTime * 1000)}`);
        console.log(`New first time: ${new Date(newData[0]?.time * 1000)}`);
        
        // Save current visible range BEFORE any chart updates
        const currentVisibleRange = chart.timeScale().getVisibleRange();
        console.log(`Current visible range before update: ${new Date(currentVisibleRange.from * 1000)} to ${new Date(currentVisibleRange.to * 1000)}`);
        
        // Update our internal chartData array
        chartData = [...newData, ...chartData];
        
        // Reset phantom data state since we now have real data
        phantomDataActive = false;
        phantomDataExtension = 0;
        
        // Remove the old series and create a new one
        chart.removeSeries(candlestickSeries);
        
        candlestickSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        });
        
        // Set all the data at once
        candlestickSeries.setData(chartData);
        
        // Reapply any existing markers
        if (markers && markers.length > 0) {
            candlestickSeries.setMarkers(markers);
        }
        
        console.log(`Setting visible range to: ${new Date(targetFrom * 1000)} to ${new Date(targetTo * 1000)}`);
        
        // Wait for the chart to finish rendering
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Set the target range
        chart.timeScale().setVisibleRange({
            from: targetFrom,
            to: targetTo
        });
        
        console.log(`Successfully loaded ${newData.length} historical bars (total: ${chartData.length})`);
        
        // Only set hasMoreDataLeft = false if we got very little data
        if (newData.length < 50) {
            console.log('Received very little data, probably near beginning');
            hasMoreDataLeft = false;
        }
        
    } catch (error) {
        console.error('Failed to load historical data:', error);
        hasMoreDataLeft = false;
        // Even on error, allow scrolling to the target position
        try {
            chart.timeScale().setVisibleRange({
                from: targetFrom,
                to: targetTo
            });
        } catch (e) {
            console.error('Failed to set visible range after error:', e);
        }
    } finally {
        isLoadingMoreData = false;
    }
}

async function handleRightArrowNavigation(step, range, timePerBar) {
    const lastTime = chartData.at(-1)?.time;
    const newFrom = range.from + step;
    const newTo = range.to + step;
    
    // Check if we need to load more data (when we're getting close to the end)
    const bufferTime = timePerBar * 20; // 20 bars buffer
    if (newTo >= lastTime - bufferTime && hasMoreDataRight && !isLoadingMoreData) {
        console.log('Loading more recent data...');
        // Load more data but don't wait for it - continue scrolling
        loadMoreRecentData().catch(err => console.error('Failed to load more data:', err));
    }
    
    // ALWAYS allow scrolling - let the chart handle empty areas
    chart.timeScale().setVisibleRange({
        from: newFrom,
        to: newTo
    });
}

// Remove the old loadMoreHistoricalData function since we're replacing it
async function loadMoreRecentData() {
    if (isLoadingMoreData) {
        console.log('Already loading recent data, skipping...');
        return;
    }
    
    if (!hasMoreDataRight) {
        console.log('No more recent data available, skipping load attempt');
        return;
    }
    
    isLoadingMoreData = true;
    
    try {
        const lastTime = chartData.at(-1)?.time;
        if (!lastTime) {
            console.log('No chart data available');
            return;
        }
        
        // Save the current visible range before loading new data
        const currentRange = chart.timeScale().getVisibleRange();
        if (!currentRange) {
            console.log('No visible range available');
            return;
        }
        
        console.log(`Loading recent data after ${new Date(lastTime * 1000)}`);
        
        const url = `/candles?symbol=${currentSymbol}&timeframe=${currentTimeframe}&start=${lastTime + 1}`;
        console.log(`API call: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            if (response.status === 404) {
                console.log('No more recent data available (404)');
                hasMoreDataRight = false;
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        
        const newData = await response.json();
        
        if (!newData || newData.length === 0) {
            console.log('No more recent data available (empty response)');
            hasMoreDataRight = false;
            return;
        }
        
        console.log(`Received ${newData.length} recent candles`);
        
        // Filter out any overlapping data
        const filteredData = newData.filter(candle => candle.time > lastTime);
        
        if (filteredData.length === 0) {
            console.log('All received data was overlapping, no new data');
            hasMoreDataRight = false;
            return;
        }
        
        // Sort to ensure correct order
        filteredData.sort((a, b) => a.time - b.time);
        
        // Append new data to existing data
        chartData = [...chartData, ...filteredData];
        
        // Update the chart with all data
        candlestickSeries.setData(chartData);
        
        // For right scrolling, maintain the current view
        setTimeout(() => {
            chart.timeScale().setVisibleRange(currentRange);
        }, 50);
        
        console.log(`Successfully loaded ${filteredData.length} recent bars (total: ${chartData.length})`);
        
        if (filteredData.length < 100) {
            hasMoreDataRight = false;
        }
        
    } catch (error) {
        console.error('Failed to load recent data:', error);
        if (error.message.includes('404') || error.message.includes('No data')) {
            hasMoreDataRight = false;
        }
    } finally {
        isLoadingMoreData = false;
    }
}

async function loadMoreRecentData() {
    if (isLoadingMoreData || !hasMoreDataRight) return;
    
    isLoadingMoreData = true;
    
    try {
        const lastTime = chartData.at(-1)?.time;
        if (!lastTime) return;
        
        // Calculate how much data to load
        const timePerBar = (chartData.at(-1)?.time - chartData[0]?.time) / chartData.length;
        const barsToLoad = 500;
        const startTime = lastTime + timePerBar; // Start just after current last bar
        const endTime = startTime + (timePerBar * barsToLoad);
        
        console.log(`Loading recent data from ${new Date(startTime * 1000)} to ${new Date(endTime * 1000)}`);
        
        const response = await fetch(`/candles?symbol=${currentSymbol}&timeframe=${currentTimeframe}&start=${startTime}&end=${endTime}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const newData = await response.json();
        
        if (newData.length === 0) {
            console.log('No more recent data available');
            hasMoreDataRight = false;
            return;
        }
        
        // Append new data to existing data
        chartData = [...chartData, ...newData];
        
        // Update the chart with all data
        candlestickSeries.setData(chartData);
        
        console.log(`Loaded ${newData.length} recent bars`);
        
        // If we got less data than requested, we've probably hit the end
        if (newData.length < barsToLoad) {
            hasMoreDataRight = false;
        }
        
    } catch (error) {
        console.error('Failed to load recent data:', error);
        hasMoreDataRight = false;
    } finally {
        isLoadingMoreData = false;
    }
}

// Remove the old navigateChart function and related functions since we replaced them
function navigateToStart(range, timePerBar) {
    const firstTime = chartData[0]?.time;
    const rangeSize = range.to - range.from;
    chart.timeScale().setVisibleRange({
        from: firstTime,
        to: firstTime + Math.min(rangeSize, 100 * timePerBar)
    });
}

function navigateToEnd(range, timePerBar) {
    const lastTime = chartData.at(-1)?.time;
    const rangeSize = range.to - range.from;
    chart.timeScale().setVisibleRange({
        from: lastTime - Math.min(rangeSize, 100 * timePerBar),
        to: lastTime
    });
}

function resetChartView(timePerBar) {
    const barCount = 100;
    const lastTime = chartData.at(-1)?.time;
    const visibleLength = timePerBar * barCount;

    chart.timeScale().setVisibleRange({
        from: lastTime - visibleLength,
        to: lastTime
    });

    candlestickSeries.priceScale().applyOptions({ autoScale: true });
}

function handleWindowResize() {
    if (!chart) return;
    const chartContainer = document.getElementById("chart");
    chart.resize(chartContainer.clientWidth, 500);
}

// Debounce utility function
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

        // Re-enable some interactions but keep control of keyboard
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
                },
                rightOffset: 12,
                barSpacing: 6,
                minBarSpacing: 0.5,
                fixLeftEdge: false,
                fixRightEdge: false,
                lockVisibleTimeRangeOnResize: true,
                rightBarStaysOnScroll: true,
                shiftVisibleRangeOnNewBar: true
            },
            localization: {
                priceFormatter: price => Number(price).toFixed(isJPY ? 2 : 4)
            },
            crosshair: { 
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: {
                    width: 1,
                    color: '#C3BCDB44',
                    style: LightweightCharts.LineStyle.Solid,
                },
                horzLine: {
                    width: 1,
                    color: '#C3BCDB44',
                    style: LightweightCharts.LineStyle.Solid,
                }
            },
            handleScroll: {
                mouseWheel: true,  // Re-enable mouse wheel for testing
                pressedMouseMove: true,
            },
            handleScale: {
                axisPressedMouseMove: true,
                mouseWheel: true,
                pinch: true,
            },
            kineticScroll: {
                touch: false,
                mouse: false  // Keep this disabled
            }
        });

        console.log("📊 Chart created with scroll functionality restored");

        candlestickSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        });

        // Enhanced crosshair subscription
        chart.subscribeCrosshairMove(createCrosshairHandler());

        // ADD: Subscribe to visible range changes for drag/wheel scrolling
        chart.timeScale().subscribeVisibleTimeRangeChange(async (newRange) => {
            if (!newRange || isLoadingMoreData || !chartData.length) return;
            
            const firstTime = chartData[0]?.time;
            const lastTime = chartData[chartData.length - 1]?.time;
            const calculatedTimePerBar = (lastTime - firstTime) / chartData.length;
            const bufferTime = calculatedTimePerBar * 2000; // Match the 2000-bar buffer  
            const needsMoreData = (newRange.from - firstTime) <= bufferTime;
            
            console.log(`📊 Range changed: ${new Date(newRange.from * 1000)} to ${new Date(newRange.to * 1000)}`);
            console.log(`📊 Distance from start: ${(newRange.from - firstTime) / calculatedTimePerBar} bars, needsMoreData: ${needsMoreData}`);
            console.log(`📊 Logic check: ${(newRange.from - firstTime)} <= ${bufferTime} = ${needsMoreData}`);
            
            if (needsMoreData && hasMoreDataLeft && !isLoadingMoreData) {
                console.log('🔄 Loading more data due to drag/wheel scroll...');
                await loadMoreHistoricalDataSync(newRange.from - (calculatedTimePerBar * 5), newRange.to);
            }
        });

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
        // Store current symbol and timeframe for infinite scroll
        currentSymbol = symbol;
        currentTimeframe = timeframe;
        
        // Reset infinite scroll state
        hasMoreDataLeft = true;
        hasMoreDataRight = true;
        isLoadingMoreData = false; // FORCE RESET
        phantomDataActive = false;
        phantomDataExtension = 0;
        
        console.log(`🔧 RESET: isLoadingMoreData = ${isLoadingMoreData}`);
        
        const candleRes = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}`);
        if (!candleRes.ok) throw new Error(`HTTP ${candleRes.status}`);
        
        chartData = await candleRes.json();
        candlestickSeries.setData(chartData);
        
        console.log(`Loaded ${chartData.length} initial candles for ${symbol} ${timeframe}`);
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

function showErrorMessage(message) {
    // You could implement a toast notification system here
    console.error(message);
    // For now, just alert - you might want to replace with a nicer UI
    // alert(message);
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

// Debounced filter update for better performance
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

function updateElementText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
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

function timeframeToSeconds(tf) {
    const timeframes = {
        "M1": 60,
        "M5": 300,
        "M15": 900,
        "M30": 1800,
        "H1": 3600,
        "H4": 14400,
        "D1": 86400,
        "W1": 604800
    };
    return timeframes[tf] || 60;
}

async function fetchChartDataRange(symbol, timeframe) {
    try {
        const res = await fetch(`/candles_range?symbol=${symbol}&timeframe=${timeframe}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error("Failed to fetch chart data range:", error);
        return { min: null, max: null };
    }
}

// Additional utility functions for enhanced functionality

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
    
    // You could implement more sophisticated error handling here
    // Such as displaying user-friendly messages, retry logic, etc.
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        showErrorMessage("Network error. Please check your connection and try again.");
    } else if (error.name === 'SyntaxError') {
        showErrorMessage("Data format error. Please contact support.");
    } else {
        showErrorMessage(`An error occurred${context ? ` in ${context}` : ''}. Please try again.`);
    }
}

// Add these functions to window for external access if needed
window.tradingChart = {
    exportFilteredTrades,
    resetAllFilters,
    clearAllTrades,
    showAllTrades,
    scrollToTrade
};
