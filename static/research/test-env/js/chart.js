import { renderChart, fetchBacktests } from './render/chart.js';
import { handleKeyboardNavigation, handleWindowResize } from './utils/scroll.js';
import { clearAllTrades, showAllTrades } from './utils/markers.js';

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

    document.addEventListener("keydown", handleKeyboardNavigation);
    window.addEventListener("resize", handleWindowResize);
}

import { loadEarlierData, loadMoreRecentData } from './render/chart.js';

window.tradingChart = {
  loadEarlierData,
  loadMoreRecentData
};
