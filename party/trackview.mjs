// Shared overhead circuit renderer for the solo game and the classroom
// whiteboard. Pure string building on top of the baked track geometry; the
// only DOM touch is sampling the SVG path element for cell coordinates.
export const TRACK_X_SCALE = 1.4;

const escHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function sampleTrack(pathD, trackLength) {
  let path = document.querySelector('#track-path');
  if (!path) {
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
  }
  const length = path.getTotalLength();
  return Array.from({length: trackLength + 1}, (_, i) => {
    const point = path.getPointAtLength(length * i / trackLength);
    return {x: point.x, y: point.y};
  });
}

export function pointAt(position, points, trackLength) {
  if (!points.length) return {x: 420, y: 310};
  const p = Math.max(0, Math.min(trackLength, Number(position) || 0));
  const low = Math.floor(p), high = Math.min(trackLength, low + 1), mix = p - low;
  return {x: points[low].x + (points[high].x - points[low].x) * mix, y: points[low].y + (points[high].y - points[low].y) * mix};
}

export function lanePoint(position, lane, points, trackLength) {
  const p = pointAt(position, points, trackLength);
  const before = pointAt(Math.max(0, Number(position) - .5), points, trackLength);
  const after = pointAt(Math.min(trackLength, Number(position) + .5), points, trackLength);
  let dx = after.x - before.x, dy = after.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length; dy /= length;
  return {x: p.x - dy * lane * 10, y: p.y + dx * lane * 10};
}

export function heading(position, points, trackLength) {
  const before = pointAt(Math.max(0, Number(position) - 1), points, trackLength);
  const after = pointAt(Math.min(trackLength, Number(position) + 1), points, trackLength);
  return Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
}

export function carTransform(position, lane, points, trackLength, scale = 1.5) {
  const p = lanePoint(position, lane, points, trackLength);
  return `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${heading(position, points, trackLength).toFixed(1)}) scale(${scale})`;
}

// Packs sharing one cell: up to four cars keep the classic lateral spread,
// bigger classroom packs fold into a tight grid so nobody parks in the lake.
export function stackOffset(index, count) {
  if (count <= 4) return { lane: (index - (count - 1) / 2) * 1.8, along: 0 };
  const cols = 4;
  const col = index % cols, row = Math.floor(index / cols);
  const rows = Math.ceil(count / cols);
  return { lane: (col - (cols - 1) / 2) * 1.15, along: (row - (rows - 1) / 2) * 1.1 };
}

export const CAR_SHAPE = `<rect class="car-wing" x="-7.4" y="-6.2" width="2" height="12.4" rx="1"/>
        <rect class="car-wing" x="7.2" y="-5.5" width="1.8" height="11" rx=".9"/>
        <polygon class="car-chassis" points="4.5,-1.4 4.5,1.4 8.6,0"/>
        <rect class="car-chassis" x="-5.6" y="-1.8" width="10.4" height="3.6" rx="1.2"/>
        <polygon class="car-stripe" points="4.5,-0.5 4.5,0.5 8.2,0"/>
        <rect class="car-stripe" x="-5.6" y="-0.55" width="10.4" height="1.1"/>
        <rect class="car-pod" x="-3.4" y="-3.6" width="5" height="1.8" rx=".9"/>
        <rect class="car-pod" x="-3.4" y="1.8" width="5" height="1.8" rx=".9"/>
        <rect class="car-wheel" x="2.6" y="-5.9" width="3.6" height="2.2" rx="1"/>
        <rect class="car-wheel" x="2.6" y="3.7" width="3.6" height="2.2" rx="1"/>
        <rect class="car-wheel" x="-6.8" y="-6" width="3.8" height="2.2" rx="1"/>
        <rect class="car-wheel" x="-6.8" y="3.8" width="3.8" height="2.2" rx="1"/>
        <ellipse class="car-cockpit" cx="-.8" cy="0" rx="2.1" ry="1.4"/>`;

export function cellOverlays(points, trackLength) {
  const half = 3.3;
  const quads = Array.from({length: trackLength}, (_, i) => {
    if (i % 2) return '';
    const a = lanePoint(i, -half, points, trackLength), b = lanePoint(i + 1, -half, points, trackLength);
    const c = lanePoint(i + 1, half, points, trackLength), d = lanePoint(i, half, points, trackLength);
    return `<polygon class="cell-quad" points="${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}"/>`;
  }).join('');
  const dividers = Array.from({length: trackLength + 1}, (_, i) => {
    const a = lanePoint(i, -half, points, trackLength), b = lanePoint(i, half, points, trackLength);
    return `<line class="cell-divider" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  }).join('');
  const lanes = [-1.1, 1.1].map((lane) => `<polyline class="cell-lane" points="${Array.from({length: trackLength + 1}, (_, i) => {
    const p = lanePoint(i, lane, points, trackLength);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ')}"/>`).join('');
  return `<g class="cell-grid">${quads}${lanes}${dividers}</g>`;
}

export function pathPoints(points, start, end, trackLength) {
  return points.slice(Math.max(0, start), Math.min(trackLength, end) + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function cornerOverlays(points, track) {
  return track.corners.map((corner, i) => {
    const poly = pathPoints(points, corner.start - 1, corner.end, track.length);
    const [bx, by] = track.layout.badges[corner.id] || [0, 0];
    return `<polyline class="${i % 2 ? 'corner-band-teal' : 'corner-band'}" points="${poly}" />
      <g class="corner-tag" transform="translate(${bx} ${by})"><rect width="168" height="48" rx="10"/><text x="84" y="34"><tspan class="stop-num">${corner.stops}</tspan> STOP${corner.stops > 1 ? 'S' : ''}</text></g>`;
  }).join('');
}

const defaultOpts = () => ({
  activeId: null,
  visualPositions: null,
  colorOf: (car) => car.color,
  nameOf: (car) => car.name,
  indexOf: (car, list) => list.findIndex((item) => item.id === car?.id),
});

export function trackSvg(cars, track, opts = {}) {
  const { activeId, visualPositions, colorOf, nameOf, indexOf } = { ...defaultOpts(), ...opts };
  const points = sampleTrack(track.pathD, track.length);
  const finish = points[0] || { x: 0, y: 0 };
  const poly = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const labels = track.corners.flatMap((corner) => [corner.start, corner.end]).map((cell) => {
    const p = lanePoint(cell, -4, points, track.length);
    return `<text class="cell-label" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}">${cell}</text>`;
  }).join('');
  const laneOrder = [...cars].sort((a,b) => a.position - b.position || indexOf(a, cars) - indexOf(b, cars));
  const carsSvg = laneOrder.map((car) => {
    const same = laneOrder.filter((other) => other.position === car.position);
    const { lane, along } = stackOffset(same.indexOf(car), same.length);
    const base = visualPositions && visualPositions.has(car.id) ? visualPositions.get(car.id) : car.position;
    return `<g id="car-${escHtml(car.id)}" class="car ${car.id === activeId ? 'active' : ''} ${car.retired ? 'retired' : ''}" fill="${colorOf(car, cars)}" transform="${carTransform(base + along, lane, points, track.length)}" aria-label="${escHtml(nameOf(car))}, position ${escHtml(car.position)}">
      ${CAR_SHAPE}<text class="car-number" x="-.8" y=".4">${indexOf(car, cars) + 1}</text></g>`;
  }).join('');
  return `<svg class="track-svg" viewBox="0 0 1176 620" role="img" aria-label="Overhead ${escHtml(track.title)} with ${track.length} cells">
    <defs><linearGradient id="skyday" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7cc4ff"/><stop offset="1" stop-color="#cdeeff"/></linearGradient><pattern id="checker" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#fff"/><rect width="4" height="4" fill="#16324a"/><rect x="4" y="4" width="4" height="4" fill="#16324a"/></pattern></defs>
    <rect width="1176" height="620" fill="url(#skyday)"/>
    <circle class="sun" cx="86" cy="78" r="30"/>
    <g class="cloud"><ellipse cx="950" cy="80" rx="46" ry="18"/><ellipse cx="985" cy="68" rx="34" ry="16"/></g>
    <g class="cloud"><ellipse cx="200" cy="540" rx="52" ry="18"/><ellipse cx="245" cy="528" rx="36" ry="15"/></g>
    <g transform="scale(${TRACK_X_SCALE} 1)">
      <path class="water-line" d="M-40 89 C160 32 260 125 420 70 S730 61 900 112 M-30 508 C140 454 277 558 435 511 S730 500 900 540 M120 -30 C170 110 112 212 174 332 S190 530 143 660"/>
      <path class="dock" d="M37 120 h115 l-22 41 H19z M680 72 h119 l22 34 H678z M626 532 h160 l-22 35 H630z"/>
      <g class="grandstand"><path d="M252 27 h125 l15 18 H237z"/><path d="M431 557 h149 l-15 18 H415z"/><path d="M719 253 h90 v86 h-90z"/></g>
    </g>
    <path id="track-path" class="track-shadow" d="${track.pathD}"/>
    <path class="track-asphalt" d="${track.pathD}"/>
    <path class="track-edge" d="${track.pathD}"/>
    <path class="track-edge-red" d="${track.pathD}"/>
    <path class="track-lane" d="${track.pathD}"/>
    ${cellOverlays(points, track.length)}
    <polyline class="track-center" points="${poly}"/>
    ${cornerOverlays(points, track)}
    <rect class="finish-line" x="${(finish.x - 6).toFixed(1)}" y="${(finish.y - 40).toFixed(1)}" width="12" height="80" fill="url(#checker)" transform="rotate(${track.layout.finishRotation} ${finish.x.toFixed(1)} ${finish.y.toFixed(1)})"/><text class="track-label" x="${track.layout.startLabel[0]}" y="${track.layout.startLabel[1]}">START / FINISH</text>
    <text class="track-direction" x="${track.layout.arrow.x}" y="${track.layout.arrow.y}" transform="rotate(${track.layout.arrow.rotation} ${track.layout.arrow.x} ${track.layout.arrow.y})">➜</text><text class="track-label" x="${track.layout.arrowLabel[0]}" y="${track.layout.arrowLabel[1]}">RACE FLOW</text>${labels}${carsSvg}
  </svg>`;
}

export function tower(cars, track, opts = {}) {
  const { activeId, colorOf, nameOf, indexOf } = { ...defaultOpts(), ...opts };
  const sorted = [...cars].sort((a,b) => b.position - a.position || indexOf(a, cars) - indexOf(b, cars));
  return `<div class="timing-tower"><div class="tower-title"><span>Timing tower</span><span>${sorted.length} cars</span></div>${sorted.map((car,i) => `<div class="tower-row ${car.id === activeId ? 'current' : ''}"><span class="tower-pos">${i+1}</span><i class="mini-chip" style="background:${colorOf(car, cars)}"></i><span class="tower-name">${escHtml(nameOf(car))}${car.retired ? ' · DNF' : ''}</span><span class="tower-dist">${car.position}/${track.length}</span></div>`).join('')}</div>`;
}
