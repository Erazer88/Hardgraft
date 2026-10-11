(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Field = root.OrbitRoadCostField;
  const directions = Object.freeze([
    Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: 1, y: 1 }),
    Object.freeze({ x: 0, y: 1 }), Object.freeze({ x: -1, y: 1 }),
    Object.freeze({ x: -1, y: 0 }), Object.freeze({ x: -1, y: -1 }),
    Object.freeze({ x: 0, y: -1 }), Object.freeze({ x: 1, y: -1 })
  ]);
  const NONE = 8, EPSILON = 1e-9;

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
    if (start.index === goal.index) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];

    const stateCount = field.count * 9, best = new Float64Array(stateCount), parent = new Int32Array(stateCount);
    const closed = new Uint8Array(stateCount);
    best.fill(Infinity); parent.fill(-1);
    const startState = start.index * 9 + NONE;
    best[startState] = 0;
    const heap = new MinHeap(Math.min(4096, Math.max(64, stateCount)));
    const minCost = Config.weights.roadReuse;
    const heuristic = index => {
      const x = index % field.width, y = Math.floor(index / field.width);
      return Math.hypot(goal.x - x, goal.y - y) * minCost;
    };
    heap.push(startState, 0, heuristic(start.index));

    let found = -1, expanded = 0;
    const elevationAt = index => field.elevations[index];
    while (heap.size) {
      const currentState = heap.pop(), queuedG = heap.poppedG;
      if (closed[currentState] || queuedG > best[currentState] + EPSILON) continue;
      if (++expanded > Config.search.maxExpandedStates) return null;
      closed[currentState] = 1;
      const current = Math.floor(currentState / 9), incoming = currentState % 9;
      if (current === goal.index) { found = currentState; break; }
      const x = current % field.width, y = Math.floor(current / field.width), currentElevation = elevationAt(current);
      for (let direction = 0; direction < directions.length; direction++) {
        const delta = directions[direction], nx = x + delta.x, ny = y + delta.y;
        if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
        const next = ny * field.width + nx;
        if (field.blocked[next]) continue;
        if (delta.x && delta.y && current !== start.index && next !== goal.index &&
            (field.blocked[y * field.width + nx] || field.blocked[ny * field.width + x])) continue;
        const elevationDelta = elevationAt(next) - currentElevation;
        const travel = delta.x && delta.y ? Math.SQRT2 : 1;
        const grade = Math.abs(elevationDelta) / (field.step * travel);
        const bothLand = !field.water[current] && !field.water[next];
        if (bothLand && grade > Config.weights.maxSlopePerHeightCell) continue;
        const rise = bothLand ? Math.max(0, elevationDelta) / (field.step * travel) : 0;
        const fall = bothLand ? Math.max(0, -elevationDelta) / (field.step * travel) : 0;
        const excessGrade = bothLand ? Math.max(0, grade - Config.weights.comfortableSlopePerHeightCell) : 0;
        const slopeCost = rise * Config.weights.uphillPerElevation + fall * Config.weights.downhillPerElevation +
          excessGrade * excessGrade * Config.weights.steepGradePenalty;
        let turnCost = 0;
        if (incoming !== NONE) {
          const turn = Math.abs(direction - incoming);
          const previousDirection = directions[incoming];
          const previousX = x - previousDirection.x, previousY = y - previousDirection.y;
          const previous = previousX >= 0 && previousY >= 0 && previousX < field.width && previousY < field.height
            ? previousY * field.width + previousX : -1;
          const previousTravel = Math.hypot(previousDirection.x, previousDirection.y);
          const previousRise = previous >= 0 && !field.water[previous] && !field.water[current]
            ? Math.max(0, currentElevation - elevationAt(previous)) / (field.step * previousTravel) : 0;
          const climbingGrade = Math.max(previousRise, rise);
          const turnMultiplier = climbingGrade >= Config.weights.switchbackGradePerHeightCell
            ? Config.weights.switchbackTurnMultiplier : 1;
          turnCost = Math.min(turn, 8 - turn) * Config.weights.directionChange * turnMultiplier;
        }
        const nextState = next * 9 + direction;
        const nextG = best[currentState] + travel * ((field.costs[current] + field.costs[next]) / 2 + slopeCost) + turnCost;
        if (nextG + EPSILON >= best[nextState]) continue;
        best[nextState] = nextG; parent[nextState] = currentState; closed[nextState] = 0;
        heap.push(nextState, nextG, heuristic(next));
      }
    }
    if (found < 0) return null;

    const cells = [];
    for (let current = found; current >= 0; current = parent[current]) {
      cells.push(Math.floor(current / 9));
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
