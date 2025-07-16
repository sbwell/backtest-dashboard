// uiManager.js - Handles all UI updates and interactions

class UIManager {
    constructor() {
        this.filterUpdateTimeout = null;
        this.activeFilters = {};
        this.metricsToFilter = [
            "atr_20d", "avg_volume_20d", "rvol",
            "move_1h", "move_1h_atr", "move_2h", "move_2h_atr", "move_1d", "move_1d_atr",
            "range_15m", "range_15m_atr", "range_60m", "range_60m_atr",
            "range_2h", "range_2h_atr", "range_1d", "range_1d_atr"
        ];
        this.metricsToBucket = [...this.metricsToFilter];
    }

    // Utility functions
    debounce(func, wait) {
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

    updateElementText(id, text) {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    }

    formatDateTime(isoString) {
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

    // Backtest dropdown management
    populateBacktestDropdown(backtests, symbol) {
        const select = document.getElementById("backtest-select");
        if (!select) return null;

        const previousValue = select.value;
        select.innerHTML = "";

        const filtered = backtests.filter(bt => bt.symbol === symbol || bt.symbol === "multi");

        filtered.forEach(bt => {
            const option = document.createElement("option");
            option.value = bt.id;
            option.textContent = bt.name || bt.run_name || `Backtest ${bt.id}`;
            select.appendChild(option);
        });

        let selectedId = null;
        if (filtered.some(bt => bt.id == previousValue)) {
            select.value = previousValue;
            selectedId = previousValue;
        } else if (filtered.length > 0) {
            select.value = filtered[0].id;
            selectedId = filtered[0].id;
        }

        return selectedId;
    }

    // Summary panel updates
    renderSummary(filteredTrades, originalTrades, tradeManager) {
        const filtered = tradeManager.getTradeStats(filteredTrades);
        const original = tradeManager.getTradeStats(originalTrades);

        // Update filtered stats
        this.updateElementText("sumProfitFiltered", filtered.profit.toFixed(2));
        this.updateElementText("sumEfficiencyFiltered", filtered.efficiency.toFixed(4));
        this.updateElementText("sumTradesFiltered", filtered.total);
        this.updateElementText("sumWinRateFiltered", filtered.winRate.toFixed(1) + "%");
        this.updateElementText("sumStartFiltered", filtered.start);
        this.updateElementText("sumEndFiltered", filtered.end);

        // Update original stats
        this.updateElementText("sumProfitOriginal", original.profit.toFixed(2));
        this.updateElementText("sumEfficiencyOriginal", original.efficiency.toFixed(4));
        this.updateElementText("sumTradesOriginal", original.total);
        this.updateElementText("sumWinRateOriginal", original.winRate.toFixed(1) + "%");
        this.updateElementText("sumStartOriginal", original.start);
        this.updateElementText("sumEndOriginal", original.end);
    }

    // Trade table rendering
    renderTradeTable(trades, tradeManager) {
        const tableBody = document.querySelector("#trades tbody");
        if (!tableBody) return;
        
        tableBody.innerHTML = "";

        trades.forEach((trade, i) => {
            const row = this.createTradeRow(trade, tradeManager);
            tableBody.appendChild(row);
        });
    }

    createTradeRow(trade, tradeManager) {
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
            <td>${this.formatDateTime(trade.entry_time)}</td>
            <td>${this.formatDateTime(trade.exit_time)}</td>
            <td style="color: ${trade.side === 'buy' ? '#2e7d32' : '#d32f2f'}">${trade.side}</td>
            <td>${trade.entry_price?.toFixed(4) ?? "—"}</td>
            <td>${trade.exit_price?.toFixed(4) ?? "—"}</td>
            <td style="color: ${pnl > 0 ? '#2e7d32' : pnl < 0 ? '#d32f2f' : '#666'}">${trade.pnl?.toFixed(2) ?? "—"}</td>
        `;

        row.addEventListener("click", () => {
            document.querySelectorAll("#trades tbody tr").forEach(r => r.classList.remove("selected-row"));
            row.classList.add("selected-row");
            tradeManager.scrollToTrade(trade);
        });
        
        return row;
    }

    // Filter rendering and management
    renderFilters(trades, tradeManager, onFilterUpdate) {
        const container = document.getElementById("filtersContainer");
        if (!container) return;
        
        container.innerHTML = "";

        this.metricsToFilter.forEach(metric => {
            const values = tradeManager.getMetricValues(metric);
            if (values.length === 0) return;

            const min = Math.min(...values);
            const max = Math.max(...values);
            if (min === max) return; // Skip if no range

            const wrapper = this.createFilterWrapper(metric, min, max, onFilterUpdate);
            container.appendChild(wrapper);
        });
    }

    createFilterWrapper(metric, min, max, onFilterUpdate) {
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

        const minInput = this.createNumericInput(`${metric}-min`, min);
        const maxInput = this.createNumericInput(`${metric}-max`, max);

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
            this.activeFilters[metric] = [vMin, vMax];
            this.debouncedFilterUpdate(onFilterUpdate);
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

    createNumericInput(id, value) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.0001";
        input.style.width = "80px";
        input.id = id;
        input.value = value.toFixed(4);
        input.style.textAlign = "right";
        return input;
    }

    debouncedFilterUpdate(callback) {
        if (this.filterUpdateTimeout) {
            clearTimeout(this.filterUpdateTimeout);
        }
        
        this.filterUpdateTimeout = setTimeout(() => {
            callback(this.activeFilters);
        }, 100);
    }

    // Bucket analysis rendering
    renderAllBuckets(trades, tradeManager) {
        const bucketContainer = document.getElementById("tab-buckets");
        if (!bucketContainer) return;
        
        bucketContainer.innerHTML = "";

        this.metricsToBucket.forEach(metric => {
            const values = tradeManager.getMetricValues(metric);
            if (values.length === 0) return;

            const section = this.createBucketSection(metric, trades, values);
            bucketContainer.appendChild(section);
        });
    }

    createBucketSection(metric, trades, values) {
        let min = Math.min(...values);
        let max = Math.max(...values);
        const range = max - min;
        
        if (range === 0) return document.createElement("div"); // Skip if no range

        const step = this.getNiceStep(range);
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

        const table = this.createBucketTable();
        const tbody = table.querySelector("tbody");
        const rows = [];

        // Create bucket rows
        for (let i = 0; i < 6; i++) {
            const rowData = this.createBucketRow(defaultBoundaries[i], defaultBoundaries[i + 1], metric, trades);
            tbody.appendChild(rowData.element);
            rows.push(rowData);
        }

        // Setup cross-updating logic
        this.setupBucketRowUpdates(rows);

        section.appendChild(table);
        return section;
    }

    getNiceStep(range) {
        const pow = Math.pow(10, Math.floor(Math.log10(range / 6)));
        const candidates = [1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001];
        for (const c of candidates) {
            const step = c * pow;
            if (range / step <= 10) return step;
        }
        return pow;
    }

    createBucketTable() {
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

    createBucketRow(bMin, bMax, metric, trades) {
        const row = document.createElement("tr");

        const inputMin = this.createNumericInput(`${metric}-bucket-min`, bMin);
        const inputMax = this.createNumericInput(`${metric}-bucket-max`, bMax);

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

    setupBucketRowUpdates(rows) {
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

    resetAllFilters() {
        // Clear active filters
        Object.keys(this.activeFilters).forEach(key => delete this.activeFilters[key]);
        
        // Reset all sliders and inputs
        document.querySelectorAll('[id$="-slider"]').forEach(sliderDiv => {
            if (sliderDiv.noUiSlider) {
                const range = sliderDiv.noUiSlider.options.range;
                sliderDiv.noUiSlider.set([range.min, range.max]);
            }
        });
        
        console.log("🔄 Reset all filters");
    }
}

// Export for use in other modules
window.UIManager = UIManager;
