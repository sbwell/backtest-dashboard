let candlestickSeries;
let trades = [];
let chart;
let markers = [];
let tradeLines = [];
let selectedBacktestId = null;
let chartData = [];
let originalTrades = [];
let filteredTrades = [];

const metricsToFilter = [
    "atr_20d", "avg_volume_20d", "rvol",
    "move_1h", "move_1h_atr", "move_2h", "move_2h_atr", "move_1d", "move_1d_atr",
    "range_15m", "range_15m_atr", "range_60m", "range_60m_atr",
    "range_2h", "range_2h_atr", "range_1d", "range_1d_atr"
];

const metricsToBucket = [...metricsToFilter];

const activeFilters = {};

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
        const symbol = document.getElementById("symbol").value;
        const timeframe = document.getElementById("timeframe").value;

        if (!range) return;

        const timePerBar = (chartData.at(-1)?.time - chartData[0]?.time) / chartData.length;
        const step = timePerBar * 5;

        if (e.key === "ArrowLeft") {
            const firstTime = chartData[0]?.time;
            if (range.from - step >= firstTime) {
                chart.timeScale().setVisibleRange({
                    from: range.from - step,
                    to: range.to - step
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
            }
        }

        if (e.key === "Home") {
            const firstTime = chartData[0]?.time;
            const rangeSize = range.to - range.from;
            chart.timeScale().setVisibleRange({
                from: firstTime,
                to: firstTime + Math.min(rangeSize, 100 * timePerBar)
            });
        }

        if (e.key === "End") {
            const lastTime = chartData.at(-1)?.time;
            const rangeSize = range.to - range.from;
            chart.timeScale().setVisibleRange({
                from: lastTime - Math.min(rangeSize, 100 * timePerBar),
                to: lastTime
            });
        }

        if (e.key === "r" || e.key === "R") {
            const barCount = 100;
            const lastTime = chartData.at(-1)?.time;
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

async function fetchBacktests() {
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
    const chartContainer = document.getElementById("chart");
    chartContainer.innerHTML = "";

    chartContainer.style.position = "relative"; // restore hover box positioning

    const hover = document.createElement("div");
    hover.id = "hoverBox";
    hover.style.position = "absolute";
    hover.style.top = "10px";
    hover.style.left = "10px";
    hover.style.backgroundColor = "rgba(255,255,255,0.9)";
    hover.style.border = "1px solid #ccc";
    hover.style.padding = "8px";
    hover.style.fontSize = "13px";
    hover.style.zIndex = "10";
    hover.style.pointerEvents = "none";
    hover.style.whiteSpace = "pre-line";

    chartContainer.appendChild(hover);

    const symbol = document.getElementById("symbol").value;
    const timeframe = document.getElementById("timeframe").value;
    const isJPY = symbol.endsWith("JPY");

    const tableBody = document.querySelector("#trades tbody");
    tableBody.innerHTML = "";

    if (chart) chart.remove();
    chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: 500,
        layout: { background: { color: "#ffffff" }, textColor: "#000000" },
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
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            }
        },
        localization: {
            priceFormatter: price => Number(price).toFixed(isJPY ? 2 : 4)
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });

    candlestickSeries = chart.addCandlestickSeries();

    chart.subscribeCrosshairMove(param => {
        const hoverBox = document.getElementById("hoverBox");
        if (!hoverBox) return; // 🛑 Prevent crash if element doesn't exist

        if (!param.point || !param.time || !param.seriesData.has(candlestickSeries)) {
            hoverBox.textContent = "";
            return;
        }

        const d = param.seriesData.get(candlestickSeries);
        const date = new Date(param.time * 1000).toLocaleString();
        hoverBox.innerText = `Time:  ${date}
    Open:  ${d.open}
    High:  ${d.high}
    Low:   ${d.low}
    Close: ${d.close}
    Volume: ${d.volume ?? "—"}`;
    });


    try {
        const candleRes = await fetch(`/candles?symbol=${symbol}&timeframe=${timeframe}`);
        chartData = await candleRes.json();
        candlestickSeries.setData(chartData);
    } catch (err) {
        console.error("Failed to load candles:", err);
        return;
    }

    if (!selectedBacktestId) return;

    const tradeRes = await fetch(`/trades?backtest_id=${selectedBacktestId}&symbol=${symbol}`);
    trades = await tradeRes.json();

    originalTrades = [...trades];
    filteredTrades = [...originalTrades];

    renderSummary(filteredTrades, originalTrades);
    renderFilters(originalTrades);
    renderAllBuckets(originalTrades);
    renderTradeTable(filteredTrades);
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

window.addEventListener("resize", () => {
    if (!chart) return;
    const chartContainer = document.getElementById("chart");
    chart.resize(chartContainer.clientWidth, 500);
});

function updateFilteredTrades() {
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
}

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

function renderFilters(trades) {
    const container = document.getElementById("filtersContainer");
    container.innerHTML = "";

    metricsToFilter.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        const min = Math.min(...values);
        const max = Math.max(...values);

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

        const minInput = document.createElement("input");
        minInput.type = "number";
        minInput.step = "0.0001";
        minInput.style.width = "80px";
        minInput.id = `${metric}-min`; 
        minInput.value = `${min.toFixed(4)}`;
        minInput.style.textAlign = "right";

        const maxInput = document.createElement("input");
        maxInput.type = "number";
        maxInput.step = "0.0001";
        maxInput.style.width = "80px";
        maxInput.id = `${metric}-max`; 
        maxInput.value = `${max.toFixed(4)}`;
        maxInput.style.textAlign = "right";

        const sliderDiv = document.createElement("div");
        sliderDiv.id = `${metric}-slider`;
        sliderDiv.style.flex = "1";
        sliderDiv.style.maxWidth = "300px";

        row.appendChild(minInput);
        row.appendChild(document.createTextNode("to"));
        row.appendChild(maxInput);
        row.appendChild(sliderDiv);
        wrapper.appendChild(row);
        container.appendChild(wrapper);

        const slider = noUiSlider.create(sliderDiv, {
            start: [min, max],
            connect: true,
            step: 0.0001,
            range: { min, max },
            format: {
                to: v => parseFloat(v).toFixed(4),
                from: v => parseFloat(v)
            }
        });

        slider.on("update", values => {
            const [vMin, vMax] = values.map(parseFloat);
            minInput.value = vMin.toFixed(4);
            maxInput.value = vMax.toFixed(4);
            activeFilters[metric] = [vMin, vMax];
            updateFilteredTrades();
        });

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

function renderAllBuckets(trades) {
    const bucketContainer = document.getElementById("tab-buckets");
    bucketContainer.innerHTML = "";

    metricsToBucket.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        let min = Math.min(...values);
        let max = Math.max(...values);
        const range = max - min;

        // Determine rounded step like 0.01, 0.005, etc.
        function getNiceStep(r) {
            const pow = Math.pow(10, Math.floor(Math.log10(r / 6)));
            const candidates = [1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001];
            for (const c of candidates) {
                const step = c * pow;
                if (r / step <= 10) return step;
            }
            return pow;
        }

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

        const tbody = table.querySelector("tbody");

        const rows = [];

        for (let i = 0; i < 6; i++) {
            const row = document.createElement("tr");

            const bMin = defaultBoundaries[i];
            const bMax = defaultBoundaries[i + 1];

            const inputMin = document.createElement("input");
            inputMin.type = "number";
            inputMin.step = "0.0001";
            inputMin.value = bMin;
            inputMin.style.width = "80px";

            const inputMax = document.createElement("input");
            inputMax.type = "number";
            inputMax.step = "0.0001";
            inputMax.value = bMax;
            inputMax.style.width = "80px";

            const cells = [];
            for (let j = 0; j < 6; j++) {
                const td = document.createElement("td");
                if (j === 0) td.appendChild(inputMin);
                else if (j === 1) td.appendChild(inputMax);
                cells.push(td);
                row.appendChild(td);
            }

            tbody.appendChild(row);
            rows.push({ inputMin, inputMax, cells });
        }

        // Add cross-updating logic and stat updates
        rows.forEach((rowObj, i) => {
            const { inputMin, inputMax, cells } = rowObj;

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
            };

            inputMin.addEventListener("change", () => {
                let minVal = parseFloat(inputMin.value);
                let maxVal = parseFloat(inputMax.value);

                // Clamp: min cannot exceed max
                if (minVal > maxVal) {
                    minVal = maxVal;
                    inputMin.value = minVal.toFixed(4);
                }

                // Sync with previous row's max
                if (i > 0) {
                    rows[i - 1].inputMax.value = inputMin.value;
                    rows[i - 1].updateStats();
                }

                updateStats();
            });

            inputMax.addEventListener("change", () => {
                let minVal = parseFloat(inputMin.value);
                let maxVal = parseFloat(inputMax.value);

                // Clamp: max cannot go below min
                if (maxVal < minVal) {
                    maxVal = minVal;
                    inputMax.value = maxVal.toFixed(4);
                }

                // Sync with next row's min
                if (i < rows.length - 1) {
                    rows[i + 1].inputMin.value = inputMax.value;
                    rows[i + 1].updateStats();
                }

                updateStats();
            });

            rowObj.updateStats = updateStats;
            updateStats();
        });

        section.appendChild(table);
        bucketContainer.appendChild(section);
    });
}

function renderTradeTable(trades) {
    const tableBody = document.querySelector("#trades tbody");
    tableBody.innerHTML = "";

    trades.forEach((trade, i) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${trade.symbol ?? symbol}</td>
          <td>${formatDateTime(trade.entry_time)}</td>
          <td>${formatDateTime(trade.exit_time)}</td>
          <td>${trade.side}</td>
          <td>${trade.entry_price?.toFixed(4)}</td>
          <td>${trade.exit_price?.toFixed(4)}</td>
          <td>${trade.pnl?.toFixed(2) ?? "—"}</td>
        `;

        row.addEventListener("click", () => {
            document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
            row.classList.add("selected-row");
            scrollToTrade(trade);
        });
        tableBody.appendChild(row);
    });
}

function scrollToTrade(trade) {
    const entryTs = Math.floor(new Date(trade.entry_time).getTime() / 1000);
    const exitTs = Math.floor(new Date(trade.exit_time).getTime() / 1000);
    const entryExists = timestampExists(entryTs);
    const exitExists = timestampExists(exitTs);
    if (!entryExists || !exitExists) return;

    const snappedEntry = getNearestTime(entryTs);
    const snappedExit = getNearestTime(exitTs);

    console.log("Snapped Entry:", snappedEntry, "Snapped Exit:", snappedExit);

    const entryFound = chartData.some(c => c.time === snappedEntry);
    const exitFound = chartData.some(c => c.time === snappedExit);

    console.log("Entry timestamp found in chartData?", entryFound);
    console.log("Exit timestamp found in chartData?", exitFound);

    const mid = Math.floor((snappedEntry + snappedExit) / 2);
    const timePerBar = (chartData.at(-1).time - chartData[0].time) / chartData.length;
    const buffer = timePerBar * 50;

    chart.timeScale().setVisibleRange({
        from: mid - buffer,
        to: mid + buffer
    });

    candlestickSeries.setMarkers([]);
    markers = [];

    const isBuy = trade.side === "buy";
    markers.push({
        time: snappedEntry,
        position: isBuy ? "belowBar" : "aboveBar",
        color: isBuy ? "green" : "red",
        shape: isBuy ? "arrowUp" : "arrowDown",
        text: "Entry"
    });
    markers.push({
        time: snappedExit,
        position: isBuy ? "aboveBar" : "belowBar",
        color: isBuy ? "red" : "green",
        shape: isBuy ? "arrowDown" : "arrowUp",
        text: "Exit"
    });

    for (const line of tradeLines) {
        try {
            chart.removeSeries(line);
        } catch (err) {
            console.warn("Tried to remove invalid line series", err);
        }
    }
    tradeLines = [];


    const line = chart.addLineSeries({ color: "gray", lineWidth: 1 });
    line.setData([
        { time: snappedEntry, value: trade.entry_price },
        { time: snappedExit, value: trade.exit_price }
    ]);
    tradeLines.push(line);
    candlestickSeries.setMarkers(markers);
}

function formatDateTime(isoString) {
    if (!isoString) return "—";
    return isoString.replace("T", " ").replace("Z", "");
}

function timeframeToSeconds(tf) {
    switch (tf) {
        case "M1": return 60;
        case "M5": return 300;
        case "M15": return 900;
        case "H1": return 3600;
        case "H4": return 14400;
        case "D1": return 86400;
        default: return 60;
    }
}

async function fetchChartDataRange(symbol, timeframe) {
    const res = await fetch(`/candles_range?symbol=${symbol}&timeframe=${timeframe}`);
    return await res.json();  // { min: timestamp, max: timestamp }
}
