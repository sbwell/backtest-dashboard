import { chart, chartData, candlestickSeries } from '../render/chart.js';

export function handleKeyboardNavigation(e) {
    if (!chart || !chartData.length) return;

    const range = chart.timeScale().getVisibleRange();
    if (!range) return;

    const timePerBar = (chartData.at(-1)?.time - chartData[0]?.time) / chartData.length;
    const step = timePerBar * 5;
    const firstTime = chartData[0]?.time;
    const lastTime = chartData.at(-1)?.time;
    const TOLERANCE = timePerBar * 0.1;

    if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (range.from <= firstTime + TOLERANCE) return;
        const newFrom = Math.max(range.from - step, firstTime);
        const newTo = newFrom + (range.to - range.from);
        chart.timeScale().setVisibleRange({
            from: newFrom <= firstTime + TOLERANCE ? firstTime : newFrom,
            to: newFrom <= firstTime + TOLERANCE ? firstTime + (range.to - range.from) : newTo
        });
    }

    if (e.key === "ArrowRight") {
        e.preventDefault();
        if (range.to >= lastTime - TOLERANCE) return;
        const newTo = Math.min(range.to + step, lastTime);
        const newFrom = newTo - (range.to - range.from);
        chart.timeScale().setVisibleRange({
            from: newTo >= lastTime - TOLERANCE ? lastTime - (range.to - range.from) : newFrom,
            to: newTo
        });
    }

    if (e.key === "Home") {
        e.preventDefault();
        const show100Bars = timePerBar * 100;
        chart.timeScale().setVisibleRange({
            from: firstTime,
            to: firstTime + show100Bars
        });
    }

    if (e.key === "End" || e.key === "r" || e.key === "R") {
        e.preventDefault();
        const show100Bars = timePerBar * 100;
        chart.timeScale().setVisibleRange({
            from: lastTime - show100Bars,
            to: lastTime
        });
        setTimeout(() => {
            candlestickSeries.priceScale().applyOptions({ autoScale: true });
        }, 50);
    }
}

export function handleWindowResize() {
    if (!chart) return;
    const chartContainer = document.getElementById("chart");
    chart.resize(chartContainer.clientWidth, 500);
}
