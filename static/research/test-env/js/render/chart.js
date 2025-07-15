import { clearAllTrades, showAllTrades, scrollToTrade } from '../utils/markers.js';
import { renderFilters, updateFilteredTrades } from './filters.js';
import { renderAllBuckets } from './buckets.js';

export let chart = null;
export let candlestickSeries = null;
export let chartData = [];
export let trades = [];
export let originalTrades = [];
export let filteredTrades = [];
export let selectedBacktestId = null;
export let markers = [];
export let tradeLines = [];
export let currentSymbol = '';
export let currentTimeframe = '';

const metricsToFilter = [
    "atr_20d", "avg_volume_20d", "rvol",
    "move_1h", "move_1h_atr", "move_2h", "move_2h_atr", "move_1d", "move_1d_atr",
    "range_15m", "range_15m_atr", "range_60m", "range_60m_atr",
    "range_2h", "range_2h_atr", "range_1d", "range_1d_atr"
];

export const metricsToBucket = [...metricsToFilter];
export const activeFilters = {};

export async function fetchBacktests() {
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
    } catch (err) {
        console.error("Failed to fetch backtests:", err);
    }
}

export async function renderChart() {
    const chartContainer = document.getElementById("chart");
    chartContainer.innerHTML = "";
    chartContainer.style.position = "relative";

    const symbol = document.getElementById("symbol").value;
    const timeframe = document.getElementById("timeframe").value;
    const isJPY = symbol.endsWith("JPY");
    currentSymbol = symbol;
    currentTimeframe = timeframe;

    const tableBody = document.querySelector("#trades tbody");
    if (tableBody) tableBody.innerHTML = "";

    if (chart) {
        chart.remove();
        chart = null;
    }

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

    candlestickSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350'
    });

    chart.subscribeCrosshairMove(createCrosshairHandler());

    chartData = await loadCandleData(symbol, timeframe);
    if (!chartData || chartData.length === 0) return;

    candlestickSeries.setData(chartData);

    if (selectedBacktestId) {
        await loadTradeData(symbol);
    }
}

async function loadCandleData(symbol, timeframe) {
    const candleRes = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}`);
    if (!candleRes.ok) throw new Error(`HTTP ${candleRes.status}`);
    return await candleRes.json();
}

async function loadTradeData(symbol) {
    const tradeRes = await fetch(`/trades?backtest_id=${selectedBacktestId}&symbol=${symbol}`);
    if (!tradeRes.ok) throw new Error(`HTTP ${tradeRes.status}`);

    trades = await tradeRes.json();
    originalTrades = [...trades];
    filteredTrades = [...originalTrades];

    renderSummary(filteredTrades, originalTrades);
    renderFilters(originalTrades);
    renderAllBuckets(originalTrades);
    renderTradeTable(filteredTrades);
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
    const pnl = trade.pnl ?? 0;

    if (pnl > 0) row.style.backgroundColor = '#e8f5e8';
    else if (pnl < 0) row.style.backgroundColor = '#ffe8e8';

    row.innerHTML = `
        <td>${trade.symbol ?? symbol}</td>
        <td>${formatDateTime(trade.entry_time)}</td>
        <td>${formatDateTime(trade.exit_time)}</td>
        <td style="color: ${trade.side === 'buy' ? '#2e7d32' : '#d32f2f'}">${trade.side}</td>
        <td>${trade.entry_price?.toFixed(4) ?? "—"}</td>
        <td>${trade.exit_price?.toFixed(4) ?? "—"}</td>
        <td style="color: ${pnl > 0 ? '#2e7d32' : pnl < 0 ? '#d32f2f' : '#666'}">${pnl.toFixed(2) ?? "—"}</td>
    `;

    row.addEventListener("click", () => {
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
        row.classList.add("selected-row");
        scrollToTrade(trade);
    });

    return row;
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

    updateElementText("sumProfitFiltered", f.profit.toFixed(2));
    updateElementText("sumEfficiencyFiltered", f.efficiency.toFixed(4));
    updateElementText("sumTradesFiltered", f.total);
    updateElementText("sumWinRateFiltered", f.winRate.toFixed(1) + "%");
    updateElementText("sumStartFiltered", f.start);
    updateElementText("sumEndFiltered", f.end);

    updateElementText("sumProfitOriginal", o.profit.toFixed(2));
    updateElementText("sumEfficiencyOriginal", o.efficiency.toFixed(4));
    updateElementText("sumTradesOriginal", o.total);
    updateElementText("sumWinRateOriginal", o.winRate.toFixed(1) + "%");
    updateElementText("sumStartOriginal", o.start);
    updateElementText("sumEndOriginal", o.end);
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

        hoverBox.innerText = `Time:   ${date}
Open:   ${d.open}
High:   ${d.high}
Low:    ${d.low}
Close:  ${d.close}
Volume: ${d.volume ? Number(d.volume).toLocaleString() : "—"}`;
    };
}

export async function loadEarlierData() {
    if (!chartData.length) return;
    const oldestTime = chartData[0].timestamp;
    const symbol = currentSymbol;
    const timeframe = currentTimeframe;

    try {
        const res = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}&before=${oldestTime}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const newData = await res.json();
        if (newData.length > 0) {
            chartData = [...newData, ...chartData];
            candlestickSeries.setData(chartData);
        }
    } catch (err) {
        console.error("Failed to load earlier data:", err);
    }
}

export async function loadMoreRecentData() {
    if (!chartData.length) return;
    const latestTime = chartData[chartData.length - 1].timestamp;
    const symbol = currentSymbol;
    const timeframe = currentTimeframe;

    try {
        const res = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}&after=${latestTime}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const newData = await res.json();
        if (newData.length > 0) {
            chartData = [...chartData, ...newData];
            candlestickSeries.setData(chartData);
        }
    } catch (err) {
        console.error("Failed to load more recent data:", err);
    }
}
