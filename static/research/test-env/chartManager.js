// chartManager.js - Handles chart creation, rendering, and interactions

class ChartManager {
    constructor() {
        this.chart = null;
        this.candlestickSeries = null;
        this.chartData = [];
        this.markers = [];
        this.tradeLines = [];
        this.currentSymbol = '';
        this.currentTimeframe = '';
        this.hoverBox = null;
    }

    initialize(containerId, options = {}) {
        const chartContainer = document.getElementById(containerId);
        if (!chartContainer) {
            throw new Error(`Chart container with id '${containerId}' not found`);
        }

        chartContainer.innerHTML = "";
        chartContainer.style.position = "relative";

        // Create hover box
        this.hoverBox = this.createHoverBox();
        chartContainer.appendChild(this.hoverBox);

        // Default chart options
        const defaultOptions = {
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
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal
            }
        };

        // Merge options
        const chartOptions = { ...defaultOptions, ...options };

        // Create chart
        this.chart = LightweightCharts.createChart(chartContainer, chartOptions);

        // Create candlestick series
        this.candlestickSeries = this.chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        });

        // Setup crosshair handler
        this.chart.subscribeCrosshairMove(this.createCrosshairHandler());

        console.log("📊 Chart initialized successfully");
    }

    createHoverBox() {
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

    createCrosshairHandler() {
        return (param) => {
            if (!this.hoverBox) return;

            if (!param.point || !param.time || !param.seriesData.has(this.candlestickSeries)) {
                this.hoverBox.textContent = "";
                return;
            }

            const d = param.seriesData.get(this.candlestickSeries);
            const date = new Date(param.time * 1000).toLocaleString();
            
            this.hoverBox.innerText = `Time:   ${date}
Open:   ${d.open}
High:   ${d.high}
Low:    ${d.low}
Close:  ${d.close}
Volume: ${d.volume ? Number(d.volume).toLocaleString() : "—"}`;
        };
    }

    setData(data) {
        if (!this.candlestickSeries) {
            throw new Error("Chart not initialized. Call initialize() first.");
        }
        
        this.chartData = data;
        this.candlestickSeries.setData(data);
        console.log(`✅ Set ${data.length} candles on chart`);
    }

    appendData(newData) {
        if (!this.candlestickSeries || !Array.isArray(newData)) {
            return;
        }

        // Merge with existing data, ensuring no duplicates
        const existingTimes = new Set(this.chartData.map(c => c.time));
        const uniqueNewData = newData.filter(c => !existingTimes.has(c.time));
        
        if (uniqueNewData.length > 0) {
            this.chartData = [...this.chartData, ...uniqueNewData].sort((a, b) => a.time - b.time);
            this.candlestickSeries.setData(this.chartData);
            console.log(`✅ Appended ${uniqueNewData.length} new candles`);
        }
    }

    prependData(newData) {
        if (!this.candlestickSeries || !Array.isArray(newData)) {
            return;
        }

        // Merge with existing data, ensuring no duplicates
        const existingTimes = new Set(this.chartData.map(c => c.time));
        const uniqueNewData = newData.filter(c => !existingTimes.has(c.time));
        
        if (uniqueNewData.length > 0) {
            this.chartData = [...uniqueNewData, ...this.chartData].sort((a, b) => a.time - b.time);
            this.candlestickSeries.setData(this.chartData);
            console.log(`✅ Prepended ${uniqueNewData.length} new candles`);
        }
    }

    clearMarkers() {
        if (this.candlestickSeries) {
            this.candlestickSeries.setMarkers([]);
            this.markers = [];
        }
    }

    clearTradeLines() {
        this.tradeLines.forEach(line => {
            try {
                this.chart.removeSeries(line);
            } catch (err) {
                console.warn("Error removing trade line:", err);
            }
        });
        this.tradeLines = [];
    }

    clearAllTrades() {
        this.clearMarkers();
        this.clearTradeLines();
    }

    setMarkers(markers) {
        if (!this.candlestickSeries) return;
        
        this.markers = markers;
        this.candlestickSeries.setMarkers(markers);
    }

    addTradeLine(data, options = {}) {
        if (!this.chart) return null;

        const defaultOptions = {
            color: "blue",
            lineWidth: 1,
            lineStyle: 0 // solid
        };

        const lineOptions = { ...defaultOptions, ...options };
        const lineSeries = this.chart.addLineSeries(lineOptions);
        lineSeries.setData(data);
        this.tradeLines.push(lineSeries);
        
        return lineSeries;
    }

    setVisibleRange(from, to) {
        if (!this.chart) return;
        
        this.chart.timeScale().setVisibleRange({ from, to });
    }

    getVisibleRange() {
        if (!this.chart) return null;
        
        return this.chart.timeScale().getVisibleRange();
    }

    resize(width, height) {
        if (this.chart) {
            this.chart.resize(width, height);
        }
    }

    timestampExists(timestamp, tolerance = 60 * 15) {
        return this.chartData.some(c => Math.abs(c.time - timestamp) <= tolerance);
    }

    getNearestTime(timestamp) {
        if (!this.chartData || this.chartData.length === 0) return timestamp;

        let closestIndex = 0;
        let minDiff = Math.abs(this.chartData[0].time - timestamp);

        for (let i = 1; i < this.chartData.length; i++) {
            const diff = Math.abs(this.chartData[i].time - timestamp);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }

        return this.chartData[closestIndex].time;
    }

    getFirstTime() {
        return this.chartData.length > 0 ? this.chartData[0].time : null;
    }

    getLastTime() {
        return this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : null;
    }

    getTimePerBar() {
        if (this.chartData.length < 2) return 0;
        return (this.getLastTime() - this.getFirstTime()) / this.chartData.length;
    }

    autoScale() {
        if (this.candlestickSeries) {
            setTimeout(() => {
                this.candlestickSeries.priceScale().applyOptions({ autoScale: true });
            }, 50);
        }
    }

    destroy() {
        if (this.chart) {
            this.chart.remove();
            this.chart = null;
            this.candlestickSeries = null;
            this.chartData = [];
            this.markers = [];
            this.tradeLines = [];
        }
    }
}

// Export for use in other modules
window.ChartManager = ChartManager;
