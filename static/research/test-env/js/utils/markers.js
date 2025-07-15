import { chart, candlestickSeries, chartData, trades, markers, tradeLines } from '../render/chart.js';

export function clearAllTrades() {
    if (!candlestickSeries) return;

    candlestickSeries.setMarkers([]);
    markers.length = 0;

    tradeLines.forEach(line => {
        try {
            chart.removeSeries(line);
        } catch (err) {
            console.warn("Error removing trade line:", err);
        }
    });
    tradeLines.length = 0;

    document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
}

export function showAllTrades() {
    if (!candlestickSeries || !trades.length) return;

    clearAllTrades();

    const newMarkers = [];
    const newLines = [];

    trades.forEach(trade => {
        const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
        const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
        const isBuy = trade.side === "buy";

        if (!timestampExists(entryTime) || !timestampExists(exitTime)) return;

        const snappedEntryTime = getNearestTime(entryTime);
        const snappedExitTime = getNearestTime(exitTime);

        newMarkers.push({
            time: snappedEntryTime,
            position: isBuy ? "belowBar" : "aboveBar",
            color: isBuy ? "green" : "red",
            shape: isBuy ? "arrowUp" : "arrowDown",
            text: "Entry"
        });

        newMarkers.push({
            time: snappedExitTime,
            position: isBuy ? "aboveBar" : "belowBar",
            color: isBuy ? "red" : "green",
            shape: isBuy ? "arrowDown" : "arrowUp",
            text: "Exit"
        });

        const lineSeries = chart.addLineSeries({
            color: trade.pnl > 0 ? "green" : "red",
            lineWidth: 1,
            lineStyle: trade.pnl > 0 ? 0 : 1
        });
        lineSeries.setData([
            { time: snappedEntryTime, value: trade.entry_price },
            { time: snappedExitTime, value: trade.exit_price }
        ]);
        newLines.push(lineSeries);
    });

    markers.push(...newMarkers);
    tradeLines.push(...newLines);
    candlestickSeries.setMarkers(markers);
}

export function scrollToTrade(trade) {
    if (!chart || !chartData.length) return;

    const entryTs = Math.floor(new Date(trade.entry_time).getTime() / 1000);
    const exitTs = Math.floor(new Date(trade.exit_time).getTime() / 1000);

    if (!timestampExists(entryTs) || !timestampExists(exitTs)) {
        console.warn("Trade timestamps not found in chart data");
        return;
    }

    clearAllTrades();

    const snappedEntry = getNearestTime(entryTs);
    const snappedExit = getNearestTime(exitTs);

    const mid = Math.floor((snappedEntry + snappedExit) / 2);
    const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
    const buffer = timePerBar * 50;

    chart.timeScale().setVisibleRange({
        from: Math.max(mid - buffer, chartData[0].time),
        to: Math.min(mid + buffer, chartData.at(-1).time)
    });

    const isBuy = trade.side === "buy";
    const profitColor = trade.pnl > 0 ? "#4caf50" : "#f44336";

    const tradeMarkers = [
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

    const line = chart.addLineSeries({
        color: profitColor,
        lineWidth: 2,
        lineStyle: trade.pnl > 0 ? 0 : 1
    });

    line.setData([
        { time: snappedEntry, value: trade.entry_price },
        { time: snappedExit, value: trade.exit_price }
    ]);

    markers.push(...tradeMarkers);
    tradeLines.push(line);
    candlestickSeries.setMarkers(markers);

    setTimeout(() => {
        candlestickSeries.priceScale().applyOptions({ autoScale: true });
    }, 100);
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
