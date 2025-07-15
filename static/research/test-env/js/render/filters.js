import { updateFilteredTrades } from './filters.js';
import { activeFilters, metricsToFilter, originalTrades, filteredTrades } from './chart.js';
import { renderAllBuckets } from './buckets.js';

export function renderFilters(trades) {
    const container = document.getElementById("filtersContainer");
    if (!container) return;

    container.innerHTML = "";

    metricsToFilter.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        const min = Math.min(...values);
        const max = Math.max(...values);
        if (min === max) return;

        const wrapper = createFilterWrapper(metric, min, max);
        container.appendChild(wrapper);
    });
}

function createFilterWrapper(metric, min, max) {
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

    const minInput = createNumericInput(`${metric}-min`, min);
    const maxInput = createNumericInput(`${metric}-max`, max);

    const sliderDiv = document.createElement("div");
    sliderDiv.id = `${metric}-slider`;
    sliderDiv.style.flex = "1";
    sliderDiv.style.maxWidth = "300px";

    row.appendChild(minInput);
    row.appendChild(document.createTextNode("to"));
    row.appendChild(maxInput);
    row.appendChild(sliderDiv);
    wrapper.appendChild(row);

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
        if (!isNaN(valMin) && !isNaN(valMax) && valMin <= valMax) {
            slider.set([valMin, valMax]);
        }
    };

    minInput.addEventListener("change", syncInputsToSlider);
    maxInput.addEventListener("change", syncInputsToSlider);

    return wrapper;
}

function createNumericInput(id, value) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.0001";
    input.style.width = "80px";
    input.id = id;
    input.value = value.toFixed(4);
    input.style.textAlign = "right";
    return input;
}

export function updateFilteredTrades() {
    filteredTrades.length = 0;

    originalTrades.forEach(t => {
        for (const [key, [min, max]] of Object.entries(activeFilters)) {
            const value = t[key];
            if (value == null) return;
            const EPSILON = 0.00009;
            if (value < min - EPSILON || value > max + EPSILON) return;
        }
        filteredTrades.push(t);
    });

    renderAllBuckets(filteredTrades);
    renderTradeTable(filteredTrades);
}
