import { metricsToBucket } from './chart.js';

export function renderAllBuckets(trades) {
    const bucketContainer = document.getElementById("tab-buckets");
    if (!bucketContainer) return;

    bucketContainer.innerHTML = "";

    metricsToBucket.forEach(metric => {
        const values = trades.map(t => t[metric]).filter(v => typeof v === "number");
        if (values.length === 0) return;

        const section = createBucketSection(metric, trades, values);
        bucketContainer.appendChild(section);
    });
}

function createBucketSection(metric, trades, values) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    const range = max - min;

    if (range === 0) return document.createElement("div");

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

    const table = createBucketTable();
    const tbody = table.querySelector("tbody");
    const rows = [];

    for (let i = 0; i < 6; i++) {
        const rowData = createBucketRow(defaultBoundaries[i], defaultBoundaries[i + 1], metric, trades);
        tbody.appendChild(rowData.element);
        rows.push(rowData);
    }

    setupBucketRowUpdates(rows);
    section.appendChild(table);
    return section;
}

function getNiceStep(range) {
    const pow = Math.pow(10, Math.floor(Math.log10(range / 6)));
    const candidates = [1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001];
    for (const c of candidates) {
        const step = c * pow;
        if (range / step <= 10) return step;
    }
    return pow;
}

function createBucketTable() {
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

function createBucketRow(bMin, bMax, metric, trades) {
    const row = document.createElement("tr");

    const inputMin = createNumericInput(`${metric}-bucket-min`, bMin);
    const inputMax = createNumericInput(`${metric}-bucket-max`, bMax);

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

function setupBucketRowUpdates(rows) {
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
