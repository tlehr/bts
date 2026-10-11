/* eslint-env browser */
'use strict';

window.DrillCharts = (() => {
	const svg_ns = 'http://www.w3.org/2000/svg';
	const colors = ['#4268df', '#169d83', '#d69035', '#8661c5', '#d06c7f', '#5c8ba5', '#8b9853', '#996c51'];
	const hidden = new WeakMap();
	const node = (tag, attrs = {}) => {
		const element = document.createElementNS(svg_ns, tag);
		for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
		return element;
	};
	const label = (svg, text, x, y, anchor = 'start') => {
		const element = node('text', { x, y, fill: '#8998af', 'font-size': 10, 'text-anchor': anchor });
		element.textContent = text; svg.append(element);
	};
	const nice = value => {
		const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
		return ([1, 2, 5, 10].find(multiplier => multiplier * power >= value) || 10) * power;
	};
	const time = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	function draw(container, series, unit = '', description = '') {
		if (!hidden.has(container)) hidden.set(container, new Set());
		const disabled = hidden.get(container), visible = series.filter(line => !disabled.has(line.key));
		const points = visible.flatMap(line => line.points).filter(point => point.value != null && Number.isFinite(point.value));
		container.replaceChildren();
		if (!points.length) {
			const empty = document.createElement('div'); empty.className = 'chart-empty';
			empty.textContent = disabled.size ? 'Kurven ausgeblendet – unten wieder einblenden.' : 'Warte auf Messwerte …'; container.append(empty);
		} else {
			const all_times = series.flatMap(line => line.points.map(point => point.ts));
			const from = Math.min(...all_times), to = Math.max(from + 1000, ...all_times);
			const max = nice(Math.max(1, ...points.map(point => point.value)));
			const svg = node('svg', { viewBox: '0 0 600 225', role: 'img', 'aria-label': description });
			const title = node('title'); title.textContent = description; svg.append(title);
			const x = ts => 48 + (ts - from) / (to - from) * 535, y = value => 185 - value / max * 155;
			for (const value of [0, max / 2, max]) {
				svg.append(node('line', { x1: 48, y1: y(value), x2: 583, y2: y(value), stroke: '#e9edf5', 'stroke-width': 1 }));
				label(svg, new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value), 40, y(value) + 4, 'end');
			}
			label(svg, unit, 48, 14);
			for (const [ts, anchor] of [[from, 'start'], [(from + to) / 2, 'middle'], [to, 'end']]) label(svg, time(ts), x(ts), 207, anchor);
			for (const line of visible) {
				let path = '', connected = false;
				for (const point of line.points) {
					if (point.value == null || !Number.isFinite(point.value)) { connected = false; continue; }
					path += (connected ? 'L' : 'M') + x(point.ts).toFixed(2) + ',' + y(point.value).toFixed(2); connected = true;
				}
				svg.append(node('path', { d: path, fill: 'none', stroke: line.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
				if (line.points.filter(point => point.value != null).length === 1) {
					const point = line.points.find(point => point.value != null); svg.append(node('circle', { cx: x(point.ts), cy: y(point.value), r: 3, fill: line.color }));
				}
			}
			const cursor = node('line', { x1: 48, y1: 25, x2: 48, y2: 185, stroke: '#99a9c4', visibility: 'hidden', 'stroke-dasharray': '3 3' });
			svg.append(cursor); container.append(svg);
			const tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.textContent = 'Mit der Maus einen Zeitpunkt ansehen.';
			container.append(tooltip);
			svg.addEventListener('mousemove', event => {
				const fraction = Math.min(1, Math.max(0, ((event.clientX - svg.getBoundingClientRect().left) / svg.getBoundingClientRect().width * 600 - 48) / 535));
				const target = from + fraction * (to - from);
				const nearest = visible.map(line => ({ line, point: line.points.reduce((best, point) => !best || Math.abs(point.ts - target) < Math.abs(best.ts - target) ? point : best, null) }));
				cursor.setAttribute('x1', x(target)); cursor.setAttribute('x2', x(target)); cursor.setAttribute('visibility', 'visible');
				tooltip.textContent = time(target) + ' · ' + nearest.map(({ line, point }) => line.label + ': ' + (point?.value == null ? 'keine Messung' : Number(point.value.toFixed(1)).toLocaleString('de-DE') + ' ' + unit)).join(' · ');
			});
			svg.addEventListener('mouseleave', () => cursor.setAttribute('visibility', 'hidden'));
		}
		const legend = document.createElement('div'); legend.className = 'chart-legend';
		for (const line of series) {
			const button = document.createElement('button'); button.type = 'button'; button.className = disabled.has(line.key) ? 'off' : '';
			button.setAttribute('aria-pressed', String(!disabled.has(line.key)));
			const dot = document.createElement('span'); dot.className = 'legend-dot'; dot.style.backgroundColor = line.color;
			button.append(dot, document.createTextNode(line.label));
			button.addEventListener('click', () => { if (disabled.has(line.key)) disabled.delete(line.key); else disabled.add(line.key); draw(container, series, unit, description); });
			legend.append(button);
		}
		container.append(legend);
	}
	return { draw, colors };
})();
