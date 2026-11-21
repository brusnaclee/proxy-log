/**
 * Minimal PNG chart renderer for Discord.
 *
 * Why hand-rolled: the bot host has no `canvas`, no `sharp`, no `rsvg-convert`
 * and no Python PIL, so every library route needs a native build. Discord can
 * only show raster images in an embed, so an inline SVG string is not an option
 * either. This module writes a PNG directly using only Node's `zlib`, which
 * every Node install ships with.
 *
 * Scope is deliberately small: the three charts the panel needs — requests
 * (ok/fail stacked bars), latency p50 (line) and throughput (line). Drawing is
 * done in an RGBA buffer then deflated into a PNG.
 *
 * CommonJS on purpose: the bot package has no `"type": "module"`.
 */

const zlib = require('node:zlib');

const W = 900;
const H = 300;
const PAD_L = 46;
const PAD_R = 24;
const PAD_T = 16;
const PAD_B = 28;

const BG = [13, 17, 23, 255]; // #0d1117
const GRID = [70, 78, 88, 255]; // #30363d
const TEXT = [139, 148, 158, 255]; // #8b949e
const GREEN = [34, 197, 94, 255];
const RED = [239, 68, 68, 255];
const BLUE = [59, 130, 246, 255];
const PURPLE = [168, 85, 247, 255];

/** 5x7 bitmap font, enough for axis labels and digits. */
const FONT = {
	'0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
	'1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
	'2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
	'3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
	'4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
	'5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
	'6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
	'7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
	'8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
	'9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
	A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
	B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
	C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
	D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
	E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
	F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
	G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
	H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
	I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
	J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
	K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
	L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
	M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
	N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
	O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
	P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
	Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
	R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
	S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
	T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
	U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
	V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
	W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
	X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
	Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
	Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
	' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
	'.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
	':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
	'/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
	'-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
	'%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
	'#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
	'(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
	')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
	'+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
	',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
};

class Canvas {
	constructor(w, h) {
		this.w = w;
		this.h = h;
		this.buf = Buffer.alloc(w * h * 4);
		for (let i = 0; i < w * h; i++) {
			this.buf[i * 4] = BG[0];
			this.buf[i * 4 + 1] = BG[1];
			this.buf[i * 4 + 2] = BG[2];
			this.buf[i * 4 + 3] = BG[3];
		}
	}

	px(x, y, c) {
		x = Math.round(x);
		y = Math.round(y);
		if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
		const i = (y * this.w + x) * 4;
		this.buf[i] = c[0];
		this.buf[i + 1] = c[1];
		this.buf[i + 2] = c[2];
		this.buf[i + 3] = c[3] ?? 255;
	}

	rect(x, y, w, h, c) {
		for (let yy = 0; yy < h; yy++) {
			for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, c);
		}
	}

	hline(x1, x2, y, c) {
		for (let x = x1; x <= x2; x++) this.px(x, y, c);
	}

	vline(x, y1, y2, c) {
		for (let y = y1; y <= y2; y++) this.px(x, y, c);
	}

	line(x1, y1, x2, y2, c, thick = 2) {
		const dx = Math.abs(x2 - x1);
		const dy = Math.abs(y2 - y1);
		const steps = Math.max(dx, dy, 1);
		for (let s = 0; s <= steps; s++) {
			const x = x1 + ((x2 - x1) * s) / steps;
			const y = y1 + ((y2 - y1) * s) / steps;
			for (let t = 0; t < thick; t++) this.px(x + t * 0.6, y, c);
		}
	}

	text(str, x, y, c = TEXT, scale = 1) {
		let cx = x;
		for (const raw of String(str).toUpperCase()) {
			const glyph = FONT[raw] || FONT[' '];
			for (let row = 0; row < 7; row++) {
				for (let col = 0; col < 5; col++) {
					if (glyph[row][col] === '1') {
						for (let sy = 0; sy < scale; sy++) {
							for (let sx = 0; sx < scale; sx++) {
								this.px(cx + col * scale + sx, y + row * scale + sy, c);
							}
						}
					}
				}
			}
			cx += 6 * scale;
		}
	}

	/** Encode as PNG (RGBA, 8-bit, no interlace). */
	toPng() {
		const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
		for (let y = 0; y < this.h; y++) {
			raw[y * (this.w * 4 + 1)] = 0; // filter: none
			this.buf.copy(raw, y * (this.w * 4 + 1) + 1, y * this.w * 4, (y + 1) * this.w * 4);
		}
		const idat = zlib.deflateSync(raw, { level: 9 });

		const chunk = (type, data) => {
			const len = Buffer.alloc(4);
			len.writeUInt32BE(data.length, 0);
			const t = Buffer.from(type, 'ascii');
			const body = Buffer.concat([t, data]);
			const crc = Buffer.alloc(4);
			crc.writeUInt32BE(crc32(body) >>> 0, 0);
			return Buffer.concat([len, body, crc]);
		};

		const ihdr = Buffer.alloc(13);
		ihdr.writeUInt32BE(this.w, 0);
		ihdr.writeUInt32BE(this.h, 4);
		ihdr[8] = 8; // bit depth
		ihdr[9] = 6; // colour type RGBA
		ihdr[10] = 0;
		ihdr[11] = 0;
		ihdr[12] = 0;

		return Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk('IHDR', ihdr),
			chunk('IDAT', idat),
			chunk('IEND', Buffer.alloc(0)),
		]);
	}
}

let CRC_TABLE = null;
function crc32(buf) {
	if (!CRC_TABLE) {
		CRC_TABLE = new Int32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			CRC_TABLE[n] = c;
		}
	}
	let crc = -1;
	for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	return crc ^ -1;
}

function niceMax(v) {
	if (v <= 0) return 1;
	const mag = Math.pow(10, Math.floor(Math.log10(v)));
	const n = v / mag;
	const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
	return step * mag;
}

function fmtShort(v) {
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
	return String(Math.round(v));
}

function dayLabel(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '?';
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Draw shared axes + return the plot rect.
 *
 * `centerLabels` matters for bar charts: bars are drawn centred inside their
 * slot, so a label placed on the tick (slot boundary) sits half a slot away
 * from the bar it names — every bar appears to belong to the previous date.
 * Bar callers pass true; line callers leave it false.
 */
function axes(cv, maxY, points, centerLabels = false) {
	const x0 = PAD_L;
	const x1 = W - PAD_R;
	const y0 = PAD_T;
	const y1 = H - PAD_B;

	// horizontal grid + y labels
	const rows = 4;
	for (let i = 0; i <= rows; i++) {
		const y = y1 - ((y1 - y0) * i) / rows;
		cv.hline(x0, x1, Math.round(y), GRID);
		const val = (maxY * i) / rows;
		cv.text(fmtShort(val), 6, Math.round(y) - 4, TEXT, 1);
	}

	// x labels: one per bar whenever they fit, otherwise evenly spaced. Cap at
	// 12 — beyond that the 5x7 glyphs collide and the axis turns to mush.
	const n = points.length;
	let idxs;
	if (n <= 12) {
		idxs = points.map((_, i) => i);
	} else {
		const wanted = 10;
		idxs = [];
		for (let k = 0; k < wanted; k++) {
			idxs.push(Math.round((k * (n - 1)) / (wanted - 1)));
		}
		idxs = [...new Set(idxs)];
	}
	for (const i of idxs) {
		// Bar charts centre bars inside slots, so their labels must be centred
		// on the slot too; line charts put points exactly on the tick.
		const x = centerLabels
			? x0 + ((x1 - x0) / n) * (i + 0.5)
			: x0 + (n === 1 ? (x1 - x0) / 2 : ((x1 - x0) * i) / (n - 1));
		const label = points[i]?.label ?? '';
		// Centre on the tick, then clamp inside the canvas so the first and
		// last labels never clip against either edge.
		const half = Math.floor((label.length * 6) / 2);
		const lx = Math.min(Math.max(Math.round(x) - half, 2), W - label.length * 6 - 4);
		cv.text(label, lx, y1 + 8, TEXT, 1);
	}

	return { x0, x1, y0, y1 };
}

module.exports.renderRequestsChart = function renderRequestsChart(history) {
	const cv = new Canvas(W, H);
	const pts = history.points.map((p) => ({ ...p, label: dayLabel(p.t) }));
	if (pts.length === 0) {
		cv.text('NO TRAFFIC IN THIS RANGE', PAD_L, H / 2, TEXT, 2);
		return cv.toPng();
	}
	const maxY = niceMax(Math.max(...pts.map((p) => p.req)));
	const { x0, x1, y0, y1 } = axes(cv, maxY, pts, true);

	const slot = (x1 - x0) / pts.length;
	const barW = Math.max(2, Math.min(28, slot * 0.66));
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const cx = x0 + slot * i + slot / 2;
		const totalH = (p.req / maxY) * (y1 - y0);
		const okH = maxY > 0 ? (p.ok / maxY) * (y1 - y0) : 0;
		// failed portion on top, successes below — an outage is visible instantly
		const failH = Math.max(0, totalH - okH);
		if (failH > 0) {
			cv.rect(Math.round(cx - barW / 2), Math.round(y1 - totalH), Math.round(barW), Math.round(failH), RED);
		}
		if (okH > 0) {
			cv.rect(Math.round(cx - barW / 2), Math.round(y1 - okH), Math.round(barW), Math.round(okH), GREEN);
		}
	}

	// "WIN 7D" instead of "REQUESTS 7D": the range glued to the word read as a
	// number ("70") in the 5x7 font. A separator keeps it unambiguous.
	const win = String(history.range || '').toUpperCase();
	cv.text(
		`TOTAL ${fmtShort(history.totals.req)} | OK ${fmtShort(history.totals.ok)} | FAIL ${fmtShort(history.totals.fail)} | WIN ${win}`,
		PAD_L,
		4,
		GREEN,
		1,
	);
	return cv.toPng();
}

module.exports.renderLineChart = function renderLineChart(history, valueKey, colour, title) {
	const cv = new Canvas(W, H);
	const pts = history.points
		.map((p) => ({ ...p, label: dayLabel(p.t), v: p[valueKey] }))
		.filter((p) => p.v != null && Number.isFinite(p.v));

	if (pts.length === 0) {
		cv.text(`NO ${title} DATA`, PAD_L, H / 2, TEXT, 2);
		return cv.toPng();
	}
	const maxY = niceMax(Math.max(...pts.map((p) => p.v)));
	const { x0, x1, y0, y1 } = axes(cv, maxY, pts, false);

	const stepX = pts.length === 1 ? 0 : (x1 - x0) / (pts.length - 1);
	let prev = null;
	for (let i = 0; i < pts.length; i++) {
		const x = pts.length === 1 ? (x0 + x1) / 2 : x0 + stepX * i;
		const y = y1 - (pts[i].v / maxY) * (y1 - y0);
		if (prev) cv.line(prev.x, prev.y, x, y, colour, 2);
		prev = { x, y };
	}

	const last = pts[pts.length - 1];
	cv.text(`${title} ${history.range.toUpperCase()}  LAST ${fmtShort(last.v)}`, PAD_L, 4, colour, 1);
	return cv.toPng();
}
