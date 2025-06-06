let candlestickSeries;
let trades = [];
let chart;
let markers = [];
let tradeLines = [];
let selectedBacktestId = null;

async function fetchBacktests() {
    const symbol = document.getElementById("symbol").value;
    const res = await fetch("/backtests");
    const data = await res.json();
    const select = document.getElementById("backtest-select");
    select.innerHTML = "";

    const filtered = data.filter(bt => bt.symbol === symbol || bt.symbol === "multi");

    filtered.forEach(bt => {
        const option = document.createElement("option");
        option.value = bt.id;
        option.textContent = bt.name || bt.run_name || `Backtest ${bt.id}`;
        select.appendChild(option);
    });

    if (filtered.length > 0) {
        select.value = filtered[0].id;
        selectedBacktestId = filtered[0].id;
        await renderChart();
    }

    select.addEventListener("change", async () => {
        selectedBacktestId = select.value;
        await renderChart();
    });
}

async function renderChart() {
    const chartContainer = document.getElementById("chart");
    chartContainer.innerHTML = "";

    const symbol = document.getElementById("symbol").value;
    const timeframe = document.getElementById("timeframe").value;
    const isJPY = symbol.endsWith("JPY");

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
        const chartData = await candleRes.json();
        candlestickSeries.setData(chartData);
    } catch (err) {
        console.error("Failed to load candles:", err);
        return;
    }

    if (!selectedBacktestId) return;

    try {
        const tradeRes = await fetch(`/trades?backtest_id=${selectedBacktestId}`);
        trades = await tradeRes.json();

        const tableBody = document.querySelector("#trades tbody");
        tableBody.innerHTML = "";

        markers = [];
        tradeLines = [];

        trades.forEach((trade, index) => {
            const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
            const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
            const isBuy = trade.side === "buy";

            // Table row
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${new Date(trade.entry_time).toLocaleString()}</td>
                <td>${new Date(trade.exit_time).toLocaleString()}</td>
                <td>${isBuy ? "Buy" : "Sell"}</td>
                <td>${trade.entry_price?.toFixed(4) ?? '—'}</td>
                <td>${trade.exit_price?.toFixed(4) ?? '—'}</td>
                <td>${trade.pnl ?? '—'}</td>
            `;
            row.style.cursor = "pointer";

            row.addEventListener("click", () => {
                const entryMarker = {
                    time: entryTime,
                    position: isBuy ? "belowBar" : "aboveBar",
                    color: isBuy ? "green" : "red",
                    shape: isBuy ? "arrowUp" : "arrowDown",
                    text: "Entry"
                };

                const exitMarker = {
                    time: exitTime,
                    position: isBuy ? "aboveBar" : "belowBar",
                    color: isBuy ? "red" : "green",
                    shape: isBuy ? "arrowDown" : "arrowUp",
                    text: "Exit"
                };

                candlestickSeries.setMarkers([entryMarker, exitMarker]);

                tradeLines.forEach(line => chart.removeSeries(line));
                tradeLines = [];

                const lineSeries = chart.addLineSeries({ color: "gray", lineWidth: 1 });
                lineSeries.setData([
                    { time: entryTime, value: trade.entry_price },
                    { time: exitTime, value: trade.exit_price }
                ]);
                tradeLines.push(lineSeries);

                document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
                row.classList.add("selected-row");
            });

            tableBody.appendChild(row);

            markers.push({
                time: entryTime,
                position: isBuy ? "belowBar" : "aboveBar",
                color: isBuy ? "green" : "red",
                shape: isBuy ? "arrowUp" : "arrowDown",
                text: "Entry"
            });

            markers.push({
                time: exitTime,
                position: isBuy ? "aboveBar" : "belowBar",
                color: isBuy ? "red" : "green",
                shape: isBuy ? "arrowDown" : "arrowUp",
                text: "Exit"
            });

            const lineSeries = chart.addLineSeries({ color: "gray", lineWidth: 1 });
            lineSeries.setData([
                { time: entryTime, value: trade.entry_price },
                { time: exitTime, value: trade.exit_price }
            ]);
            tradeLines.push(lineSeries);
        });

        candlestickSeries.setMarkers(markers);
    } catch (err) {
        console.error("Failed to load trades:", err);
    }
}

window.onload = () => {
    document.getElementById("loadBacktestBtn").addEventListener("click", fetchBacktests);

    document.getElementById("clearTradesBtn").addEventListener("click", () => {
        candlestickSeries.setMarkers([]);
        tradeLines.forEach(line => chart.removeSeries(line));
        tradeLines = [];
        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
    });

    document.getElementById("showAllTradesBtn").addEventListener("click", () => {
        candlestickSeries.setMarkers(markers);

        tradeLines.forEach(line => chart.removeSeries(line));
        tradeLines = [];

        trades.forEach(trade => {
            const entryTime = Math.floor(new Date(trade.entry_time).getTime() / 1000);
            const exitTime = Math.floor(new Date(trade.exit_time).getTime() / 1000);
            const lineSeries = chart.addLineSeries({ color: "gray", lineWidth: 1 });
            lineSeries.setData([
                { time: entryTime, value: trade.entry_price },
                { time: exitTime, value: trade.exit_price }
            ]);
            tradeLines.push(lineSeries);
        });

        document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
    });

    document.getElementById("symbol").addEventListener("change", fetchBacktests);
    document.getElementById("timeframe").addEventListener("change", renderChart);

    fetchBacktests();
};
