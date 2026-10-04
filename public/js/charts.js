// Chart.js defaults driven by the CSS colour tokens, so charts follow light/dark mode.
import { fmt } from './ui.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function themeColors() {
  return {
    series1: css('--series-1'),
    series2: css('--series-2'),
    surface: css('--surface'),
    text: css('--text-2'),
    muted: css('--text-muted'),
    grid: css('--grid'),
    axis: css('--axis'),
  };
}

function baseOptions(c, { money = true, horizontal = false } = {}) {
  const valueAxis = {
    beginAtZero: true,
    grid: { color: c.grid, drawTicks: false },
    border: { display: false },
    ticks: { color: c.muted, padding: 8, maxTicksLimit: 6, callback: (v) => (money ? fmt.moneyShort(v) : v) },
  };
  const catAxis = {
    grid: { display: false },
    border: { color: c.axis },
    ticks: { color: c.muted, padding: 6, autoSkip: true, maxRotation: 0 },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        align: 'start',
        labels: { color: c.text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 16, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: css('--tooltip-bg'),
        titleColor: css('--tooltip-text'),
        bodyColor: css('--tooltip-text'),
        borderColor: css('--border'),
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${money ? fmt.money(ctx.parsed[horizontal ? 'x' : 'y']) : ctx.formattedValue}` },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

const barStyle = (color, c) => ({
  backgroundColor: color,
  hoverBackgroundColor: color,
  borderColor: c.surface,
  borderWidth: { top: 0, bottom: 0, left: 1, right: 1 },
  borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
  borderSkipped: 'bottom',
  maxBarThickness: 22,
  categoryPercentage: 0.7,
  barPercentage: 0.9,
});

/** Grouped monthly bars: purchases vs sales. */
export function monthlyChart(canvas, monthly) {
  const c = themeColors();
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: monthly.labels.map(fmt.month),
      datasets: [
        { label: 'Purchases (received POs, at cost)', data: monthly.purchases, ...barStyle(c.series1, c) },
        { label: 'Sales (stock out, at price)', data: monthly.sales, ...barStyle(c.series2, c) },
      ],
    },
    options: baseOptions(c),
  });
}

/** Single-series horizontal bars (e.g. stock value by category). */
export function horizontalBarChart(canvas, labels, values, label) {
  const c = themeColors();
  const opts = baseOptions(c, { horizontal: true });
  opts.plugins.legend.display = false;
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label, data: values, ...barStyle(c.series1, c),
        borderWidth: { top: 1, bottom: 1, left: 0, right: 0 },
        borderRadius: { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 },
        borderSkipped: 'left',
      }],
    },
    options: opts,
  });
}

/** Re-create charts when the theme flips. Returns a cleanup function. */
export function onThemeChange(fn) {
  window.addEventListener('themechange', fn);
  return () => window.removeEventListener('themechange', fn);
}
