let candlestickSeries;
let trades = [];
let chart;
let markers = [];
let tradeLines = [];
let selectedBacktestId = null;
let chartData = [];

async function fetchBacktests() {
    console.log("Fetching backtests...");
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
}

async function renderChart() {
    console.log("Rendering chart...");
    const chartContainer = document.getElementById("chart");
    chartContainer.innerHTML = "";

    const symbol = document.getElementById("symbol").value;
    const timeframe = document.getElementById("timeframe").value;
    const isJPY = symbol.endsWith("JPY");

    const tableBody = document.querySelector("#trades tbody");
    tableBody.innerHTML = "";

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
            borderColor: "#D1D4DC"
        },
        localization: {
            priceFormatter: price => Number(price).toFixed(isJPY ? 2 : 4)
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal
        }
    });

    candlestickSeries = chart.addCandlestickSeries();

    chart.subscribeCrosshairMove(param => {
        const hoverBox = document.getElementById("hoverBox");
        if (!param.point || !param.time || !param.seriesData.has(candlestickSeries)) {
            hoverBox.textContent = "";
            return;
        }

        const d = param.seriesData.get(candlestickSeries);
        const date = new Date(param.time * 1000).toLocaleString();
        hoverBox.innerText =
            `Time:  ${date}
Open:  ${d.open}
High:  ${d.high}
Low:   ${d.low}
Close: ${d.close}
Volume: ${d.volume ?? '—'}`;
    });

    try {
        const candleRes = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}`);
        chartData = await candleRes.json();

        if (!chartData || chartData.length === 0) {
            console.warn("Empty chart data returned for:", symbol);
            return;
        }

        candlestickSeries.setData(chartData);

        let isLoadingMore = false;

        chart.timeScale().subscribeVisibleTimeRangeChange(async (range) => {
            if (!range || isLoadingMore) return;

            const earliestLoaded = chartData[0]?.time;
            if (range.from <= earliestLoaded + 60) {
                isLoadingMore = true;

                try {
                    const res = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}&before=${earliestLoaded}`);
                    const moreData = await res.json();

                    if (moreData && moreData.length > 0) {
                        chartData = [...moreData, ...chartData];
                        candlestickSeries.setData(chartData);
                    }
                } catch (err) {
                    console.error("Error loading more candles:", err);
                }

                isLoadingMore = false;
            }
        });

    } catch (err) {
        console.error("Failed to load candles:", err);
        return;
    }

    if (!selectedBacktestId) {
        console.warn("No backtest ID selected.");
        return;
    }

    function timestampExists(ts) {
        return chartData.some(c => Math.abs(c.time - ts) <= 60 * 15);
    }

    function getNearestTime(ts) {
        let closest = chartData[0]?.time ?? ts;
        let minDiff = Math.abs(closest - ts);

        for (let i = 1; i < chartData.length; i++) {
            const t = chartData[i].time;
            const diff = Math.abs(t - ts);
            if (diff < minDiff) {
                minDiff = diff;
                closest = t;
            }
        }

        return closest;
    }

    try {
        const tradeRes = await fetch(`/trades?backtest_id=${selectedBacktestId}&symbol=${symbol}`);
        trades = await tradeRes.json();
        console.log("Fetched trades:", trades.length);

        markers = [];
        tradeLines = [];

        trades.forEach((trade) => {
            console.log("Building row for:", trade.entry_time);
            const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
            const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
            const isBuy = trade.side === "buy";

            const entryExists = timestampExists(entryTime);
            const exitExists = timestampExists(exitTime);
            if (!entryExists || !exitExists) {
                console.warn("Entry/Exit not found in chartData!", { entryTime, exitTime });
                return;
            }

            const snappedEntryTime = getNearestTime(entryTime);
            const snappedExitTime = getNearestTime(exitTime);

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${trade.symbol}</td>
                <td>${new Date(trade.entry_time).toLocaleString()}</td>
                <td>${new Date(trade.exit_time).toLocaleString()}</td>
                <td>${isBuy ? "Buy" : "Sell"}</td>
                <td>${trade.entry_price?.toFixed(4) ?? '—'}</td>
                <td>${trade.exit_price?.toFixed(4) ?? '—'}</td>
                <td>${trade.pnl ?? '—'}</td>
            `;
            row.style.cursor = "pointer";

            row.addEventListener("click", (e) => {
                console.log("Row clicked:", trade.entry_time);
                const clickedRow = e.currentTarget;

                candlestickSeries.setMarkers([]);
                candlestickSeries.setMarkers([
                    {
                        time: snappedEntryTime,
                        position: isBuy ? "belowBar" : "aboveBar",
                        color: isBuy ? "green" : "red",
                        shape: isBuy ? "arrowUp" : "arrowDown",
                        text: "Entry"
                    },
                    {
                        time: snappedExitTime,
                        position: isBuy ? "aboveBar" : "belowBar",
                        color: isBuy ? "red" : "green",
                        shape: isBuy ? "arrowDown" : "arrowUp",
                        text: "Exit"
                    }
                ]);

                tradeLines.forEach(line => chart.removeSeries(line));
                tradeLines = [];

                const lineSeries = chart.addLineSeries({ color: "gray", lineWidth: 1 });
                lineSeries.setData([
                    { time: snappedEntryTime, value: trade.entry_price },
                    { time: snappedExitTime, value: trade.exit_price }
                ]);
                tradeLines.push(lineSeries);

                const visibleRange = chart.timeScale().getVisibleRange();
                console.log("Current visible range:", visibleRange, "→ recentering around", snappedEntryTime);
                if (visibleRange) {
                    const rangeSize = visibleRange.to - visibleRange.from;
                    chart.timeScale().setVisibleRange({
                        from: snappedEntryTime - rangeSize / 2,
                        to: snappedEntryTime + rangeSize / 2
                    });
                }

                document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
                clickedRow.classList.add("selected-row");
            });

            document.querySelector("#trades tbody").appendChild(row);
            console.log("Attached row click listener for trade at", trade.entry_time);

            markers.push({
                time: snappedEntryTime,
                position: isBuy ? "belowBar" : "aboveBar",
                color: isBuy ? "green" : "red",
                shape: isBuy ? "arrowUp" : "arrowDown",
                text: "Entry"
            });

            markers.push({
                time: snappedExitTime,
                position: isBuy ? "aboveBar" : "belowBar",
                color: isBuy ? "red" : "green",
                shape: isBuy ? "arrowDown" : "arrowUp",
                text: "Exit"
            });

            const lineSeries = chart.addLineSeries({ color: "gray", lineWidth: 1 });
            lineSeries.setData([
                { time: snappedEntryTime, value: trade.entry_price },
                { time: snappedExitTime, value: trade.exit_price }
            ]);
            tradeLines.push(lineSeries);
        });

        candlestickSeries.setMarkers(markers);
    } catch (err) {
        console.error("Failed to load trades:", err);
    }
}

window.onload = () => {
    document.getElementById("loadBacktestBtn").addEventListener("click", async () => {
        await fetchBacktests();
    });

    document.getElementById("clearTradesBtn").addEventListener("click", () => {
        candlestickSeries.setMarkers([]);
        tradeLines.forEach(line => chart.removeSeries(line));
        tradeLines = [];
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
    });

    document.getElementById("showAllTradesBtn").addEventListener("click", () => {
        candlestickSeries.setMarkers([]);
        markers = [];
        tradeLines.forEach(line => chart.removeSeries(line));
        tradeLines = [];

        trades.forEach(trade => {
            const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
            const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
            const isBuy = trade.side === "buy";

            const entryExists = timestampExists(entryTime);
            const exitExists = timestampExists(exitTime);
            if (!entryExists || !exitExists) return;

            const snappedEntryTime = getNearestTime(entryTime);
            const snappedExitTime = getNearestTime(exitTime);

            markers.push({
                time: snappedEntryTime,
                position: isBuy ? "belowBar" : "aboveBar",
                color: isBuy ? "green" : "red",
                shape: isBuy ? "arrowUp" : "arrowDown",
                text: "Entry"
            });

            markers.push({
                time: snappedExitTime,
                position: isBuy ? "aboveBar" : "belowBar",
                color: isBuy ? "red" : "green",
                shape: isBuy ? "arrowDown" : "arrowUp",
                text: "Exit"
            });

            const lineSeries = chart.addLineSeries({ color: "gray", lineWidth: 1 });
            lineSeries.setData([
                { time: snappedEntryTime, value: trade.entry_price },
                { time: snappedExitTime, value: trade.exit_price }
            ]);
            tradeLines.push(lineSeries);
        });

        candlestickSeries.setMarkers(markers);
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
    });

    document.getElementById("symbol").addEventListener("change", fetchBacktests);
    document.getElementById("timeframe").addEventListener("change", async () => {
        await fetchBacktests();
    });

    document.addEventListener("keydown", (e) => {
        const range = chart.timeScale().getVisibleRange();
        if (!range) return;

        const timePerBar = (chartData.at(-1)?.time - chartData[0]?.time) / chartData.length;
        const step = timePerBar * 5; // scroll 5 bars worth of time

        if (e.key === "ArrowLeft") {
            const firstTime = chartData[0]?.time;
            if (range.from - step >= firstTime) {
                chart.timeScale().setVisibleRange({
                    from: range.from - step,
                    to: range.to - step
                });
            } else {
                const visibleLength = range.to - range.from;
                chart.timeScale().setVisibleRange({
                    from: firstTime,
                    to: firstTime + visibleLength
                });
            }
        }


        if (e.key === "ArrowRight") {
            const lastTime = chartData.at(-1)?.time;
            if (range.to + step <= lastTime) {
                chart.timeScale().setVisibleRange({
                    from: range.from + step,
                    to: range.to + step
                });
            } else {
                // Snap to final range without overshooting
                const visibleLength = range.to - range.from;
                chart.timeScale().setVisibleRange({
                    from: lastTime - visibleLength,
                    to: lastTime
                });
            }
        }

        if (e.key === "Home") {
            const firstTime = chartData[0]?.time;
            if (firstTime) {
                const rangeSize = range.to - range.from;
                const maxRange = 100 * 60 * 15; // max 100 bars at 15 min each (adjustable)
                const visibleLength = Math.min(rangeSize, maxRange);

                chart.timeScale().setVisibleRange({
                    from: firstTime,
                    to: firstTime + visibleLength
                });
            }
        }

        if (e.key === "End") {
            const lastTime = chartData[chartData.length - 1]?.time;
            if (lastTime) {
                const rangeSize = range.to - range.from;
                const maxRange = 100 * 60 * 15; // max 100 bars at 15 min each (adjustable)
                const visibleLength = Math.min(rangeSize, maxRange);

                chart.timeScale().setVisibleRange({
                    from: lastTime - visibleLength,
                    to: lastTime
                });
            }
        }

        if (e.key === "r" || e.key === "R") {
            const barCount = 100; // ⏳ number of candles to display on reset

            const lastTime = chartData.at(-1)?.time;
            const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
            const visibleLength = timePerBar * barCount;

            chart.timeScale().setVisibleRange({
                from: lastTime - visibleLength,
                to: lastTime
            });

            candlestickSeries.priceScale().applyOptions({ autoScale: true });
        }

    });

    fetchBacktests();
};

