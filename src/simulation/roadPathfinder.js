(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Field = root.OrbitRoadCostField;
  // Sixteen headings: the eight neighbours plus knight moves, so roads can
  // run at 26.6° and 63.4° and bend gradually instead of in 45° steps.
  const directions = Object.freeze([
    [1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1],
    [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]
  ].map(([x, y]) => Object.freeze({ x, y, length: Math.hypot(x, y), angle: Math.atan2(y, x),
    // Cells a move passes between, which must be open too: the two
    // orthogonal neighbours of a diagonal, the two cells a knight move skims.
    via: Object.freeze(Math.abs(x) === 2 ? [{ x: Math.sign(x), y: 0 }, { x: Math.sign(x), y: Math.sign(y) }]
      : Math.abs(y) === 2 ? [{ x: 0, y: Math.sign(y) }, { x: Math.sign(x), y: Math.sign(y) }]
        : x && y ? [{ x, y: 0 }, { x: 0, y }] : []) })));
  const HEADINGS = directions.length, NONE = HEADINGS, STATES = HEADINGS + 1, EPSILON = 1e-9;
  // Turn between two headings, in eighths of a full turn.
  const turns = new Float64Array(HEADINGS * HEADINGS);
  for (let from = 0; from < HEADINGS; from++) for (let to = 0; to < HEADINGS; to++) {
    let turn = Math.abs(directions[to].angle - directions[from].angle);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    turns[from * HEADINGS + to] = turn / (Math.PI / 4);
  }
  // Search buffers are reused between calls of the same size.
  let buffers = null;

  class MinHeap {
    constructor(capacity) {
      this.states = new Int32Array(capacity); this.gs = new Float64Array(capacity);
      this.fs = new Float64Array(capacity); this.hs = new Float64Array(capacity);
      this.size = 0; this.poppedG = 0;
    }
    less(a, b) {
      return this.fs[a] < this.fs[b] || (this.fs[a] === this.fs[b] &&
        (this.hs[a] < this.hs[b] || (this.hs[a] === this.hs[b] && this.states[a] < this.states[b])));
    }
    grow() {
      const size = this.states.length * 2;
      const states = new Int32Array(size), gs = new Float64Array(size);
      const fs = new Float64Array(size), hs = new Float64Array(size);
      states.set(this.states); gs.set(this.gs); fs.set(this.fs); hs.set(this.hs);
      this.states = states; this.gs = gs; this.fs = fs; this.hs = hs;
    }
    push(state, g, h) {
      if (this.size === this.states.length) this.grow();
      let index = this.size++;
      this.states[index] = state; this.gs[index] = g; this.fs[index] = g + h; this.hs[index] = h;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!this.less(index, parent)) break;
        this.swap(index, parent); index = parent;
      }
    }
    swap(a, b) {
      let value = this.states[a]; this.states[a] = this.states[b]; this.states[b] = value;
      value = this.gs[a]; this.gs[a] = this.gs[b]; this.gs[b] = value;
      value = this.fs[a]; this.fs[a] = this.fs[b]; this.fs[b] = value;
      value = this.hs[a]; this.hs[a] = this.hs[b]; this.hs[b] = value;
    }
    pop() {
      if (!this.size) return -1;
      const result = this.states[0]; this.poppedG = this.gs[0];
      this.size--;
      if (!this.size) return result;
      this.states[0] = this.states[this.size]; this.gs[0] = this.gs[this.size];
      this.fs[0] = this.fs[this.size]; this.hs[0] = this.hs[this.size];
      let index = 0;
      while (true) {
        const left = index * 2 + 1, right = left + 1;
        if (left >= this.size) break;
        const child = right < this.size && this.less(right, left) ? right : left;
        if (!this.less(child, index)) break;
        this.swap(index, child); index = child;
      }
      return result;
    }
  }

  function findPath(field, terrain, from, to) {
    if (!field || !terrain || !from || !to || !Number.isFinite(from.x) || !Number.isFinite(from.y) ||
        !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
    const start = Field.cellIndex(field, from), goal = Field.cellIndex(field, to);
    if (field.blocked[start.index] || field.blocked[goal.index]) return null;
    if (field.waterBody && field.waterBody[start.index] !== field.waterBody[goal.index]) return null;
    if (start.index === goal.index) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];

    const stateCount = field.count * STATES;
    if (!buffers || buffers.size !== stateCount) {
      buffers = { size: stateCount, best: new Float64Array(stateCount), parent: new Int32Array(stateCount),
        closed: new Uint8Array(stateCount) };
    }
    const { best, parent, closed } = buffers;
    best.fill(Infinity); parent.fill(-1); closed.fill(0);
    const startState = start.index * STATES + NONE;
    best[startState] = 0;
    const heap = new MinHeap(4096);
    const minCost = Number.isFinite(field.minimumCost) ? field.minimumCost : Config.weights.roadReuse;
    // Above 1 the search trades a little optimality for speed.
    const heuristicWeight = Config.search.heuristicWeight || 1;
    const heuristic = index => {
      const x = index % field.width, y = Math.floor(index / field.width);
      return Math.hypot(goal.x - x, goal.y - y) * minCost * heuristicWeight;
    };
    heap.push(startState, 0, heuristic(start.index));

    const weights = Config.weights, elevations = field.elevations;
    let found = -1, expanded = 0;
    while (heap.size) {
      const currentState = heap.pop(), queuedG = heap.poppedG;
      if (closed[currentState] || queuedG > best[currentState] + EPSILON) continue;
      if (++expanded > (field.maxExpandedStates || Config.search.maxExpandedStates)) return null;
      closed[currentState] = 1;
      const current = Math.floor(currentState / STATES), incoming = currentState % STATES;
      if (current === goal.index) { found = currentState; break; }
      const x = current % field.width, y = Math.floor(current / field.width), currentElevation = elevations[current];
      // Grade of the step that led here: climbing roads fold into hairpins,
      // so turning is cheap on a steep grade.
      let previousGrade = 0;
      if (incoming !== NONE) {
        const previousDirection = directions[incoming];
        const previousX = x - previousDirection.x, previousY = y - previousDirection.y;
        if (previousX >= 0 && previousY >= 0 && previousX < field.width && previousY < field.height) {
          const previous = previousY * field.width + previousX;
          if (!field.water[previous] && !field.water[current]) {
            previousGrade = Math.abs(currentElevation - elevations[previous]) / (field.step * previousDirection.length);
          }
        }
      }
      for (let direction = 0; direction < HEADINGS; direction++) {
        const delta = directions[direction], nx = x + delta.x, ny = y + delta.y;
        if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
        const next = ny * field.width + nx;
        if (field.blocked[next]) continue;
        if (current !== start.index && next !== goal.index) {
          let squeezed = false;
          for (const cell of delta.via) if (field.blocked[(y + cell.y) * field.width + x + cell.x]) { squeezed = true; break; }
          if (squeezed) continue;
        }
        const travel = delta.length, run = field.step * travel;
        const elevationDelta = elevations[next] - currentElevation;
        const grade = Math.abs(elevationDelta) / run;
        const bothLand = !field.water[current] && !field.water[next];
        if (bothLand && grade > weights.maxSlopePerHeightCell) continue;
        const rise = bothLand ? Math.max(0, elevationDelta) / run : 0;
        const fall = bothLand ? Math.max(0, -elevationDelta) / run : 0;
        const excessGrade = bothLand ? Math.max(0, grade - weights.comfortableSlopePerHeightCell) : 0;
        // Earthworks: cutting across a hillside costs with the side slope.
        let crossSlope = 0;
        if (bothLand && field.slopeX) {
          const slopeX = (field.slopeX[current] + field.slopeX[next]) / 2, slopeY = (field.slopeY[current] + field.slopeY[next]) / 2;
          crossSlope = Math.abs(slopeX * delta.y - slopeY * delta.x) / travel;
        }
        const slopeCost = rise * weights.uphillPerElevation + fall * weights.downhillPerElevation +
          excessGrade * excessGrade * weights.steepGradePenalty + crossSlope * crossSlope * weights.crossSlopePenalty;
        // Rivers are crossed by a bridge, never followed down their bed.
        const riverCost = field.river?.[next] ? (field.river[current] ? weights.riverAlong : weights.riverCrossing) : 0;
        let turnCost = 0;
        if (incoming !== NONE) {
          const turnMultiplier = Math.max(previousGrade, grade) >= weights.switchbackGradePerHeightCell
            ? weights.switchbackTurnMultiplier : 1;
          turnCost = turns[incoming * HEADINGS + direction] * weights.directionChange * turnMultiplier;
        }
        const nextState = next * STATES + direction;
        const nextG = best[currentState] + travel * ((field.costs[current] + field.costs[next]) / 2 + slopeCost) +
          turnCost + riverCost;
        if (nextG + EPSILON >= best[nextState]) continue;
        best[nextState] = nextG; parent[nextState] = currentState; closed[nextState] = 0;
        heap.push(nextState, nextG, heuristic(next));
      }
    }
    if (found < 0) return null;

    const cells = [];
    for (let current = found; current >= 0; current = parent[current]) {
      cells.push(Math.floor(current / STATES));
      if (current === startState) break;
    }
    cells.reverse();
    const points = [{ x: from.x, y: from.y }];
    for (let i = 1; i < cells.length - 1; i++) {
      const cell = cells[i], x = cell % field.width, y = Math.floor(cell / field.width);
      points.push({ x: x * field.cellWorld, y: y * field.cellWorld });
    }
    points.push({ x: to.x, y: to.y });
    return points;
  }

  root.OrbitRoadPathfinder = Object.freeze({ findPath });
})(globalThis);
