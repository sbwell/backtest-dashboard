let candlestickSeries;
let trades = [];
let chart;
let markers = [];
let tradeLines = [];
let selectedBacktestId = null;
let chartData = [];
let originalTrades = [];
let filteredTrades = [];

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
        
        originalTrades = [...trades];
        filteredTrades = [...originalTrades];

        renderSummary(filteredTrades, originalTrades);
        renderFilters(originalTrades);
        renderEntryPriceBreakdown(getEntryPriceBuckets(originalTrades));

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

function renderSummary(filtered, original) {
    function summarize(trades) {
        const total = trades.length;
        const profit = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
        const wins = trades.filter(t => t.pnl > 0).length;
        const efficiency = total > 0 ? profit / total : 0;
        const winRate = total > 0 ? (wins / total) * 100 : 0;
        const start = total > 0 ? new Date(trades[0].entry_time).toLocaleString() : "—";
        const end = total > 0 ? new Date(trades.at(-1).exit_time).toLocaleString() : "—";
        return { profit, efficiency, total, winRate, start, end };
    }

    const f = summarize(filtered);
    const o = summarize(original);

    document.getElementById("sumProfitFiltered").textContent = f.profit.toFixed(2);
    document.getElementById("sumEfficiencyFiltered").textContent = f.efficiency.toFixed(2);
    document.getElementById("sumTradesFiltered").textContent = f.total;
    document.getElementById("sumWinRateFiltered").textContent = f.winRate.toFixed(1) + "%";
    document.getElementById("sumStartFiltered").textContent = f.start;
    document.getElementById("sumEndFiltered").textContent = f.end;

    document.getElementById("sumProfitOriginal").textContent = o.profit.toFixed(2);
    document.getElementById("sumEfficiencyOriginal").textContent = o.efficiency.toFixed(2);
    document.getElementById("sumTradesOriginal").textContent = o.total;
    document.getElementById("sumWinRateOriginal").textContent = o.winRate.toFixed(1) + "%";
    document.getElementById("sumStartOriginal").textContent = o.start;
    document.getElementById("sumEndOriginal").textContent = o.end;
}

const activeFilters = {};

function getEntryPriceBuckets(trades) {
    const prices = trades.map(t => t.entry_price).filter(v => typeof v === 'number');
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    const step = range / 6;

    const buckets = [];
    for (let i = 0; i < 6; i++) {
        const bMin = +(min + i * step).toFixed(4);
        const bMax = +(min + (i + 1) * step).toFixed(4);
        const group = trades.filter(t => t.entry_price >= bMin && t.entry_price < bMax);
        const profit = group.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
        const count = group.length;
        const wins = group.filter(t => t.pnl > 0).length;
        const efficiency = count > 0 ? profit / count : 0;
        const winRate = count > 0 ? (wins / count) * 100 : 0;
        buckets.push({ min: bMin, max: bMax, profit, count, winRate, efficiency });
    }

    return buckets;
}

function renderEntryPriceBreakdown(rows) {
    const body = document.getElementById("entryPriceBreakdownBody");
    body.innerHTML = "";

    rows.forEach(row => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${row.min}–${row.max}</td>
            <td>${row.profit.toFixed(2)}</td>
            <td>${row.count}</td>
            <td>${row.winRate.toFixed(1)}%</td>
            <td>${row.efficiency.toFixed(4)}</td>
            <td><input type="number" step="0.0001" value="${row.min}" class="entryMin"></td>
            <td><input type="number" step="0.0001" value="${row.max}" class="entryMax"></td>
        `;

        body.appendChild(tr);
    });

    body.querySelectorAll(".entryMin, .entryMax").forEach(input => {
        input.addEventListener("change", () => {
            const mins = Array.from(body.querySelectorAll(".entryMin")).map(i => parseFloat(i.value));
            const maxs = Array.from(body.querySelectorAll(".entryMax")).map(i => parseFloat(i.value));
            const globalMin = Math.min(...mins);
            const globalMax = Math.max(...maxs);
            activeFilters.entry_price = [globalMin, globalMax];
            updateFilteredTrades();
        });
    });
}

function updateFilteredTrades() {
    filteredTrades = originalTrades.filter(t => {
        for (const [key, [min, max]] of Object.entries(activeFilters)) {
            const value = t[key];
            if (value == null || value < min || value > max) return false;
        }
        return true;
    });

    renderSummary(filteredTrades, originalTrades);
}

function renderFilters(trades) {
    const container = document.getElementById("filtersContainer");
    container.innerHTML = ""; // Clear existing filters

    const metrics = ["entry_price"]; // Add more later

    metrics.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        const min = Math.min(...values);
        const max = Math.max(...values);

        const wrapper = document.createElement("div");
        wrapper.style.marginBottom = "20px";

        const label = document.createElement("label");
        label.innerHTML = `<strong>${metric}</strong>`;
        wrapper.appendChild(label);

        // Create horizontal row layout
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "12px";
        row.style.marginTop = "5px";

        // Min input
        const minInput = document.createElement("input");
        minInput.type = "number";
        minInput.step = "0.01";
        minInput.style.width = "80px";
        minInput.value = min.toFixed(2);

        // Max input
        const maxInput = document.createElement("input");
        maxInput.type = "number";
        maxInput.step = "0.01";
        maxInput.style.width = "80px";
        maxInput.value = max.toFixed(2);

        // Slider
        const sliderDiv = document.createElement("div");
        sliderDiv.id = `${metric}-slider`;
        sliderDiv.style.flex = "1";
        sliderDiv.style.marginLeft = "10px";

        row.appendChild(minInput);
        row.appendChild(document.createTextNode("to"));
        row.appendChild(maxInput);
        row.appendChild(sliderDiv);
        wrapper.appendChild(row);
        container.appendChild(wrapper);

        // noUiSlider config
        const slider = noUiSlider.create(sliderDiv, {
            start: [min, max],
            connect: true,
            tooltips: [true, true],
            step: 0.0001,
            range: {
                min: min,
                max: max
            },
            format: {
                to: v => parseFloat(v).toFixed(4),
                from: v => parseFloat(v)
            }
        });

        // slider → inputs
        slider.on("update", values => {
            const [vMin, vMax] = values.map(parseFloat);
            minInput.value = vMin.toFixed(2);
            maxInput.value = vMax.toFixed(2);
            activeFilters[metric] = [vMin, vMax];
            updateFilteredTrades();
        });

        // inputs → slider
        const syncInputsToSlider = () => {
            const valMin = parseFloat(minInput.value);
            const valMax = parseFloat(maxInput.value);
            if (!isNaN(valMin) && !isNaN(valMax)) {
                slider.set([valMin, valMax]);
            }
        };

        minInput.addEventListener("change", syncInputsToSlider);
        maxInput.addEventListener("change", syncInputsToSlider);
    });
}

function applyFilters() {
    const filters = getActiveFilters();
    filteredTrades = originalTrades.filter(trade => {
        for (const metric in filters) {
            const val = trade[metric];
            if (val === undefined || val === null) return false;
            const { min, max } = filters[metric];
            if (val < min || val > max) return false;
        }
        return true;
    });

    renderSummary(filteredTrades, originalTrades);
    renderTradeMarkers(filteredTrades);
    renderTradeTable(filteredTrades);
}

function getActiveFilters() {
    const filters = {};
    const metrics = ["entry_price"]; // Same as used in renderFilters()

    metrics.forEach(metric => {
        const minInput = document.getElementById(`${metric}-min`);
        const maxInput = document.getElementById(`${metric}-max`);
        if (minInput && maxInput) {
            const min = parseFloat(minInput.value);
            const max = parseFloat(maxInput.value);
            filters[metric] = { min, max };
        }
    });

    return filters;
}

