// ═══════════════════════════════════════════════════════════════════════════════
// SCHOOLSAFE EVACUATION SIMULATOR
// Grid-based educational simulation with A* pathfinding, dynamic hazards, and scoring
// ═══════════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────────
// CONFIGURATION & CONSTANTS
// ───────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    GRID_WIDTH: 20,
    GRID_HEIGHT: 15,
    CELL_SIZE: 40,
    MAX_STUDENTS: 60,
    MAX_TICKS: 300,
    BASE_TICK_RATE: 120,
    FIRE_SPREAD_INTERVAL: 10,
    QUAKE_INTERVAL: 20,
    QUEUE_MAX_WAIT: 3,
    COLORS: {
        seated: '#6366f1',
        moving: '#3b82f6',
        waiting: '#f59e0b',
        evacuated: '#22c55e',
        injured: '#f97316',
        trapped: '#ef4444',
        panicking: '#FF00FF',
        fire: 'rgba(239,68,68,0.6)',
        debris: '#374151',
        wall: '#2d3748',
        exit: '#10b981',
        chair: '#8b5cf6',
        floor: '#f8fafc',
        grid: '#e2e8f0'
    }
};

// ───────────────────────────────────────────────────────────────────────────────
// GAME STATE
// ───────────────────────────────────────────────────────────────────────────────
const state = {
    grid: [],
    students: [],
    hazards: { fire: [], quake: [] },
    activeHazards: { fire: [], debris: [] },
    isPlaying: false,
    isPaused: false,
    tick: 0,
    speed: 1,
    selectedTool: 'chair',
    selectedHazard: null,
    showCongestion: false,
    lastTickTime: 0,
    animationId: null,
    congestionMap: [],
    exitUsage: {},
    maxStudentsReached: false
};

// ───────────────────────────────────────────────────────────────────────────────
// CANVAS SETUP
// ───────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = CONFIG.GRID_WIDTH * CONFIG.CELL_SIZE;
    canvas.height = CONFIG.GRID_HEIGHT * CONFIG.CELL_SIZE;
}

// ───────────────────────────────────────────────────────────────────────────────
// GRID MANAGEMENT
// ───────────────────────────────────────────────────────────────────────────────
function initGrid() {
    state.grid = Array(CONFIG.GRID_HEIGHT).fill(null).map(() => 
        Array(CONFIG.GRID_WIDTH).fill('floor')
    );
    state.congestionMap = Array(CONFIG.GRID_HEIGHT).fill(null).map(() => 
        Array(CONFIG.GRID_WIDTH).fill(0)
    );
}

function getCell(x, y) {
    if (x < 0 || x >= CONFIG.GRID_WIDTH || y < 0 || y >= CONFIG.GRID_HEIGHT) return null;
    return state.grid[y][x];
}

function setCell(x, y, type) {
    if (x < 0 || x >= CONFIG.GRID_WIDTH || y < 0 || y >= CONFIG.GRID_HEIGHT) return false;
    state.grid[y][x] = type;
    return true;
}

function isWalkable(x, y) {
    const cell = getCell(x, y);
    if (!cell) return false;
    return cell !== 'wall' && cell !== 'fire' && cell !== 'debris';
}

function isExit(x, y) {
    return getCell(x, y) === 'exit';
}

function countStudents() {
    return state.students.filter(s => s.state !== 'evacuated').length;
}

function canPlaceChair() {
    return countStudents() < CONFIG.MAX_STUDENTS;
}

// ───────────────────────────────────────────────────────────────────────────────
// A* PATHFINDING
// ───────────────────────────────────────────────────────────────────────────────
function findPath(startX, startY, goalX, goalY, avoidCongestion = true) {
    const openSet = [{ x: startX, y: startY, g: 0, f: 0, parent: null }];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    gScore.set(`${startX},${startY}`, 0);
    
    while (openSet.length > 0) {
        let currentIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[currentIdx].f) currentIdx = i;
        }
        const current = openSet.splice(currentIdx, 1)[0];
        const key = `${current.x},${current.y}`;
        
        if (current.x === goalX && current.y === goalY) {
            const path = [];
            let node = current;
            while (node) {
                path.unshift({ x: node.x, y: node.y });
                node = node.parent;
            }
            return path;
        }
        
        closedSet.add(key);
        
        const neighbors = [
            { x: current.x + 1, y: current.y },
            { x: current.x - 1, y: current.y },
            { x: current.x, y: current.y + 1 },
            { x: current.x, y: current.y - 1 }
        ];
        
        for (const neighbor of neighbors) {
            const nKey = `${neighbor.x},${neighbor.y}`;
            if (!isWalkable(neighbor.x, neighbor.y) || closedSet.has(nKey)) continue;
            
            let moveCost = 1;
            if (avoidCongestion && state.congestionMap[neighbor.y][neighbor.x] > 2) {
                moveCost += state.congestionMap[neighbor.y][neighbor.x] * 0.5;
            }
            const tentativeG = current.g + moveCost;
            
            const existingG = gScore.get(nKey);
            if (existingG === undefined || tentativeG < existingG) {
                cameFrom.set(nKey, current);
                gScore.set(nKey, tentativeG);
                const h = Math.abs(neighbor.x - goalX) + Math.abs(neighbor.y - goalY);
                const f = tentativeG + h;
                
                const existingIdx = openSet.findIndex(n => n.x === neighbor.x && n.y === neighbor.y);
                if (existingIdx === -1) {
                    openSet.push({ x: neighbor.x, y: neighbor.y, g: tentativeG, f, parent: current });
                } else {
                    openSet[existingIdx].g = tentativeG;
                    openSet[existingIdx].f = f;
                    openSet[existingIdx].parent = current;
                }
            }
        }
    }
    return null;
}

function findPathToNearestExit(startX, startY) {
    const exits = [];
    for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.GRID_WIDTH; x++) {
            if (state.grid[y][x] === 'exit') exits.push({ x, y });
        }
    }
    if (exits.length === 0) return null;
    
    exits.sort((a, b) => {
        const distA = Math.abs(a.x - startX) + Math.abs(a.y - startY);
        const distB = Math.abs(b.x - startX) + Math.abs(b.y - startY);
        return distA - distB;
    });
    
    for (const exit of exits.slice(0, 3)) {
        const path = findPath(startX, startY, exit.x, exit.y);
        if (path) return { path, exit };
    }
    return null;
}

// ───────────────────────────────────────────────────────────────────────────────
// STUDENT AGENT CLASS
// ───────────────────────────────────────────────────────────────────────────────
class Student {
    constructor(x, y, id) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.startX = x;
        this.startY = y;
        this.state = 'seated';
        this.path = [];
        this.targetExit = null;
        this.waitTime = 0;
        this.moveCounter = 0;
        this.history = [];
        this.panicRetryCounter = 0;
    }

    startEvacuation() {
        if (this.state !== 'seated' || isExit(this.x, this.y)) return;
        const result = findPathToNearestExit(this.x, this.y);
        if (result) {
            this.path = result.path.slice(1);
            this.targetExit = result.exit;
            this.state = 'moving';
            this.waitTime = 0;
        } else {
            this.checkTrappedOrPanic();
        }
    }

    update() {
        if (this.state === 'evacuated' || this.state === 'trapped') return;
        this.checkHazards();
        if (this.state === 'injured' || this.state === 'seated') {
            if (this.state === 'seated' && state.isPlaying) this.startEvacuation();
            return;
        }
        if (this.state === 'waiting') {
            this.waitTime++;
            if (this.waitTime >= CONFIG.QUEUE_MAX_WAIT) this.reroute();
            return;
        }
        if (this.state === 'panicking') {
            this.panicMove();
            return;
        }
        const speed = this.state === 'injured' ? 0.5 : 1;
        this.moveCounter += speed;
        if (this.moveCounter >= 1) {
            this.moveCounter -= 1;
            this.move();
        }
    }

    panicMove() {
        const speed = this.state === 'injured' ? 0.5 : 1;
        this.moveCounter += speed;
        if (this.moveCounter >= 1) {
            this.moveCounter -= 1;
            const neighbors = [
                { x: this.x + 1, y: this.y }, { x: this.x - 1, y: this.y },
                { x: this.x, y: this.y + 1 }, { x: this.x, y: this.y - 1 }
            ];
            const walkableNeighbors = neighbors.filter(n => isWalkable(n.x, n.y));
            if (walkableNeighbors.length > 0) {
                const next = walkableNeighbors[Math.floor(Math.random() * walkableNeighbors.length)];
                this.x = next.x;
                this.y = next.y;
                this.history.push({ x: this.x, y: this.y });
                if (this.history.length > 10) this.history.shift();
            }
            this.panicRetryCounter++;
            if (this.panicRetryCounter >= 5) {
                this.panicRetryCounter = 0;
                const result = findPathToNearestExit(this.x, this.y);
                if (result) {
                    this.path = result.path.slice(1);
                    this.targetExit = result.exit;
                    this.state = 'moving';
                }
            }
        }
    }

    move() {
        if (this.path.length === 0) {
            if (isExit(this.x, this.y)) this.evacuate();
            else this.reroute();
            return;
        }
        const next = this.path[0];
        if (!isWalkable(next.x, next.y)) {
            this.reroute();
            return;
        }
        if (isExit(next.x, next.y)) {
            if (state.congestionMap[next.y][next.x] > 2) {
                this.state = 'waiting';
                this.waitTime = 0;
                return;
            }
        }
        this.x = next.x;
        this.y = next.y;
        this.path.shift();
        this.history.push({ x: this.x, y: this.y });
        if (this.history.length > 10) this.history.shift();
        if (this.path.length === 0 && isExit(this.x, this.y)) this.evacuate();
    }

    reroute() {
        this.waitTime = 0;
        const result = findPathToNearestExit(this.x, this.y);
        if (result && (result.exit.x !== this.targetExit?.x || result.exit.y !== this.targetExit?.y)) {
            this.path = result.path.slice(1);
            this.targetExit = result.exit;
            this.state = 'moving';
        } else {
            this.checkTrappedOrPanic();
        }
    }

    evacuate() {
        this.state = 'evacuated';
        this.path = [];
        if (this.targetExit) {
            const key = `${this.targetExit.x},${this.targetExit.y}`;
            state.exitUsage[key] = (state.exitUsage[key] || 0) + 1;
        }
    }

    checkTrappedOrPanic() {
        const result = findPathToNearestExit(this.x, this.y);
        if (!result) {
            const neighbors = [
                { x: this.x + 1, y: this.y }, { x: this.x - 1, y: this.y },
                { x: this.x, y: this.y + 1 }, { x: this.x, y: this.y - 1 }
            ];
            const hasWalkableNeighbor = neighbors.some(n => isWalkable(n.x, n.y));
            if (hasWalkableNeighbor) {
                this.state = 'panicking';
                this.panicRetryCounter = 0;
                this.path = [];
            } else {
                this.state = 'trapped';
                this.path = [];
            }
        }
    }

    checkHazards() {
        const cell = getCell(this.x, this.y);
        if (cell === 'fire' && this.state !== 'injured' && this.state !== 'evacuated') {
            this.state = 'injured';
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// HAZARD SYSTEM
// ───────────────────────────────────────────────────────────────────────────────
function updateHazards() {
    if (state.tick > 0 && state.tick % CONFIG.FIRE_SPREAD_INTERVAL === 0) spreadFire();
    if (state.tick > 0 && state.tick % CONFIG.QUAKE_INTERVAL === 0) generateDebris();
}

function spreadFire() {
    const newFire = [];
    const fireSources = [...state.activeHazards.fire];
    if (state.tick === CONFIG.FIRE_SPREAD_INTERVAL) {
        for (const trigger of state.hazards.fire) {
            if (!fireSources.some(f => f.x === trigger.x && f.y === trigger.y)) {
                fireSources.push(trigger);
                setCell(trigger.x, trigger.y, 'fire');
            }
        }
    }
    for (const fire of fireSources) {
        const neighbors = [
            { x: fire.x + 1, y: fire.y }, { x: fire.x - 1, y: fire.y },
            { x: fire.x, y: fire.y + 1 }, { x: fire.x, y: fire.y - 1 }
        ];
        for (const n of neighbors) {
            const cell = getCell(n.x, n.y);
            if (cell && cell !== 'wall' && cell !== 'fire' && cell !== 'debris' && cell !== 'exit') {
                if (Math.random() < 0.7) {
                    newFire.push(n);
                    setCell(n.x, n.y, 'fire');
                }
            }
        }
    }
    state.activeHazards.fire.push(...newFire);
}

function generateDebris() {
    for (const trigger of state.hazards.quake) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (Math.random() < 0.3) {
                    const x = trigger.x + dx, y = trigger.y + dy;
                    const cell = getCell(x, y);
                    if (cell && cell !== 'wall' && cell !== 'exit' && cell !== 'fire') {
                        setCell(x, y, 'debris');
                        state.activeHazards.debris.push({ x, y });
                        const studentIdx = state.students.findIndex(s => s.x === x && s.y === y);
                        if (studentIdx !== -1 && state.students[studentIdx].state !== 'evacuated') {
                            state.students[studentIdx].state = 'trapped';
                        }
                    }
                }
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// SIMULATION LOOP
// ───────────────────────────────────────────────────────────────────────────────
function startSimulation() {
    if (state.isPlaying) return;
    const hasStudent = state.students.length > 0;
    if (!hasStudent) { alert('Place at least one chair before starting!'); return; }
    state.isPlaying = true; state.isPaused = false; state.tick = 0; state.exitUsage = {};
    for (const student of state.students) {
        student.state = 'seated'; student.path = []; student.targetExit = null;
        student.waitTime = 0; student.moveCounter = 0; student.history = [];
    }
    state.activeHazards.fire = []; state.activeHazards.debris = [];
    for (const trigger of state.hazards.fire) {
        setCell(trigger.x, trigger.y, 'fire');
        state.activeHazards.fire.push({ x: trigger.x, y: trigger.y });
    }
    updateUI();
    gameLoop();
}

function pauseSimulation() {
    state.isPaused = !state.isPaused;
    document.getElementById('btnPause').textContent = state.isPaused ? '▶ Resume' : '⏸ Pause';
}

function stopSimulation() {
    state.isPlaying = false; state.isPaused = false;
    cancelAnimationFrame(state.animationId);
    updateUI();
}

function gameLoop() {
    if (!state.isPlaying) return;
    const now = performance.now();
    const tickRate = CONFIG.BASE_TICK_RATE / state.speed;
    if (!state.isPaused && now - state.lastTickTime >= tickRate) {
        state.lastTickTime = now;
        tick();
    }
    render();
    state.animationId = requestAnimationFrame(gameLoop);
}

function tick() {
    state.tick++;
    for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.GRID_WIDTH; x++) state.congestionMap[y][x] = 0;
    }
    updateHazards();
    for (const student of state.students) {
        student.update();
        if (student.state === 'moving' || student.state === 'waiting' || student.state === 'panicking') {
            state.congestionMap[student.y][student.x]++;
        }
    }
    const active = state.students.filter(s => s.state === 'seated' || s.state === 'moving' || s.state === 'waiting' || s.state === 'panicking');
    if (active.length === 0 || state.tick >= CONFIG.MAX_TICKS) {
        endSimulation();
        return;
    }
    updateStats();
}

function endSimulation() {
    state.isPlaying = false;
    cancelAnimationFrame(state.animationId);
    showResults();
}

// ───────────────────────────────────────────────────────────────────────────────
// RENDERING
// ───────────────────────────────────────────────────────────────────────────────
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = CONFIG.COLORS.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = CONFIG.COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= CONFIG.GRID_WIDTH; x++) {
        ctx.beginPath(); ctx.moveTo(x * CONFIG.CELL_SIZE, 0);
        ctx.lineTo(x * CONFIG.CELL_SIZE, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= CONFIG.GRID_HEIGHT; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * CONFIG.CELL_SIZE);
        ctx.lineTo(canvas.width, y * CONFIG.CELL_SIZE); ctx.stroke();
    }
    for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.GRID_WIDTH; x++) {
            const cell = state.grid[y][x];
            const cx = x * CONFIG.CELL_SIZE, cy = y * CONFIG.CELL_SIZE;
            if (cell === 'wall') {
                ctx.fillStyle = CONFIG.COLORS.wall;
                ctx.fillRect(cx, cy, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
            } else if (cell === 'exit') {
                ctx.fillStyle = CONFIG.COLORS.exit;
                ctx.fillRect(cx + 2, cy + 2, CONFIG.CELL_SIZE - 4, CONFIG.CELL_SIZE - 4);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 12px Poppins';
                ctx.textAlign = 'center';
                ctx.fillText('EXIT', cx + CONFIG.CELL_SIZE/2, cy + CONFIG.CELL_SIZE/2 + 4);
            } else if (cell === 'fire') {
                ctx.fillStyle = CONFIG.COLORS.fire;
                ctx.fillRect(cx, cy, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
            } else if (cell === 'debris') {
                ctx.fillStyle = CONFIG.COLORS.debris;
                ctx.fillRect(cx, cy, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
                ctx.fillStyle = '#1f2937';
                ctx.fillRect(cx + 4, cy + 4, CONFIG.CELL_SIZE - 8, CONFIG.CELL_SIZE - 8);
            } else if (cell === 'chair') {
                ctx.fillStyle = '#f3e8ff';
                ctx.fillRect(cx + 2, cy + 2, CONFIG.CELL_SIZE - 4, CONFIG.CELL_SIZE - 4);
                ctx.strokeStyle = '#8b5cf6';
                ctx.lineWidth = 2;
                ctx.strokeRect(cx + 4, cy + 4, CONFIG.CELL_SIZE - 8, CONFIG.CELL_SIZE - 8);
            }
        }
    }
    if (state.showCongestion) {
        for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
            for (let x = 0; x < CONFIG.GRID_WIDTH; x++) {
                const congestion = state.congestionMap[y][x];
                if (congestion > 0) {
                    ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(congestion * 0.2, 0.8)})`;
                    ctx.fillRect(x * CONFIG.CELL_SIZE, y * CONFIG.CELL_SIZE, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
                }
            }
        }
    }
    for (const student of state.students) {
        if (student.state === 'evacuated') continue;
        const cx = student.x * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2;
        const cy = student.y * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2;
        const color = CONFIG.COLORS[student.state] || CONFIG.COLORS.seated;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (student.state === 'moving' && student.path.length > 0) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            for (const p of student.path.slice(0, 5)) {
                ctx.lineTo(p.x * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2, p.y * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    for (const trigger of state.hazards.fire) {
        if (getCell(trigger.x, trigger.y) !== 'fire') {
            const cx = trigger.x * CONFIG.CELL_SIZE, cy = trigger.y * CONFIG.CELL_SIZE;
            ctx.strokeStyle = CONFIG.COLORS.fire;
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(cx + 2, cy + 2, CONFIG.CELL_SIZE - 4, CONFIG.CELL_SIZE - 4);
            ctx.setLineDash([]);
        }
    }
    for (const trigger of state.hazards.quake) {
        const cx = trigger.x * CONFIG.CELL_SIZE, cy = trigger.y * CONFIG.CELL_SIZE;
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(cx + 2, cy + 2, CONFIG.CELL_SIZE - 4, CONFIG.CELL_SIZE - 4);
        ctx.setLineDash([]);
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// SCORING & RESULTS
// ───────────────────────────────────────────────────────────────────────────────
function calculateScore() {
    const total = state.students.length;
    const evacuated = state.students.filter(s => s.state === 'evacuated').length;
    const injured = state.students.filter(s => s.state === 'injured').length;
    const trapped = state.students.filter(s => s.state === 'trapped' || s.state === 'panicking').length;
    const baseScore = total > 0 ? (evacuated / total) * 100 : 0;
    const speedBonus = evacuated === total ? Math.max(0, 40 - state.tick / 5) : 0;
    const penalty = injured * 5 + trapped * 20;
    const finalScore = Math.max(0, Math.min(140, Math.round(baseScore + speedBonus - penalty)));
    let grade = 'F', gradeClass = 'grade-f';
    if (finalScore >= 125) { grade = 'A+'; gradeClass = 'grade-a-plus'; }
    else if (finalScore >= 110) { grade = 'A'; gradeClass = 'grade-a'; }
    else if (finalScore >= 95) { grade = 'B+'; gradeClass = 'grade-b-plus'; }
    else if (finalScore >= 80) { grade = 'B'; gradeClass = 'grade-b'; }
    else if (finalScore >= 65) { grade = 'C'; gradeClass = 'grade-c'; }
    else if (finalScore >= 50) { grade = 'D'; gradeClass = 'grade-d'; }
    return { score: finalScore, grade, gradeClass, evacuated, injured, trapped, total, baseScore, speedBonus, penalty };
}

function getSuggestions(result) {
    const suggestions = [];
    const evacuationRate = result.total > 0 ? (result.evacuated / result.total) : 0;
    if (evacuationRate < 0.8) suggestions.push('Add more exits or reposition existing ones closer to seating areas.');
    if (result.injured > 0) suggestions.push('Injured students were too close to hazards. Place exits away from the danger zone.');
    if (result.trapped > 0) suggestions.push('Some students were trapped. Ensure multiple escape routes from all areas.');
    const panickingCount = state.students.filter(s => s.state === 'panicking').length;
    if (panickingCount > 0) suggestions.push('Students were panicking with no escape route. Always place at least one exit door.');
    const exitValues = Object.values(state.exitUsage);
    const totalUsage = exitValues.reduce((a, b) => a + b, 0);
    if (totalUsage > 0 && exitValues.some(u => u / totalUsage > 0.6)) suggestions.push('Distribute exits more evenly to balance evacuation flow.');
    const exits = [];
    for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.GRID_WIDTH; x++) if (state.grid[y][x] === 'exit') exits.push({x, y});
    }
    const hasNearChairs = exits.some(e => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) if (getCell(e.x + dx, e.y + dy) === 'chair') return true;
        }
        return false;
    });
    if (hasNearChairs) suggestions.push('Avoid placing chairs directly adjacent to exits - this creates bottlenecks.');
    if (suggestions.length === 0) suggestions.push('Great job! Your evacuation plan is well-designed.');
    return suggestions.slice(0, 4);
}

function showResults() {
    const result = calculateScore();
    const suggestions = getSuggestions(result);
    document.getElementById('gradeBadge').textContent = result.grade;
    document.getElementById('gradeBadge').className = `grade-badge ${result.gradeClass}`;
    document.getElementById('scoreBreakdown').innerHTML = `
        <div class="score-row"><span>Evacuation Rate (${result.evacuated}/${result.total})</span><span class="positive">+${Math.round(result.baseScore)}</span></div>
        <div class="score-row"><span>Speed Bonus</span><span class="positive">+${Math.round(result.speedBonus)}</span></div>
        <div class="score-row"><span>Injured Penalty (${result.injured} × -5)</span><span class="negative">-${result.injured * 5}</span></div>
        <div class="score-row"><span>Trapped Penalty (${result.trapped} × -20)</span><span class="negative">-${result.trapped * 20}</span></div>
        <div class="score-row"><span>Final Score</span><span style="font-weight:800">${result.score}</span></div>
    `;
    const exitStats = Object.entries(state.exitUsage).map(([key, count]) => {
        const [x, y] = key.split(',').map(Number);
        return `<div class="stat-detail-box"><div class="stat-detail-label">Exit at (${x},${y})</div><div class="stat-detail-value">${count} students</div></div>`;
    }).join('');
    document.getElementById('statsDetail').innerHTML = `
        <div class="stat-detail-box"><div class="stat-detail-label">Time</div><div class="stat-detail-value">${Math.round(state.tick * CONFIG.BASE_TICK_RATE / 1000)}s</div></div>
        <div class="stat-detail-box"><div class="stat-detail-label">Ticks</div><div class="stat-detail-value">${state.tick}</div></div>
        ${exitStats}
    `;
    document.getElementById('suggestionsList').innerHTML = suggestions.map(s => `<div class="suggestion-item">${s}</div>`).join('');
    document.getElementById('resultsModal').classList.add('show');
}

// ───────────────────────────────────────────────────────────────────────────────
// UI CONTROLS
// ───────────────────────────────────────────────────────────────────────────────
function updateStats() {
    const states = { seated: 0, moving: 0, waiting: 0, evacuated: 0, injured: 0, trapped: 0, panicking: 0 };
    for (const s of state.students) states[s.state]++;
    document.getElementById('statSeated').textContent = states.seated;
    document.getElementById('statMoving').textContent = states.moving;
    document.getElementById('statWaiting').textContent = states.waiting;
    document.getElementById('statEvacuated').textContent = states.evacuated;
    document.getElementById('statInjured').textContent = states.injured;
    document.getElementById('statTrapped').textContent = states.trapped;
    document.getElementById('statPanicking').textContent = states.panicking;
    document.getElementById('studentCount').textContent = `${state.students.filter(s => s.state !== 'evacuated').length}/${CONFIG.MAX_STUDENTS}`;
    document.getElementById('exitCount').textContent = state.grid.flat().filter(c => c === 'exit').length;
    document.getElementById('tickCount').textContent = state.tick;
}

function updateUI() {
    document.getElementById('btnPlay').disabled = state.isPlaying;
    document.getElementById('btnPause').disabled = !state.isPlaying;
    document.getElementById('simStatus').textContent = state.isPlaying ? (state.isPaused ? 'Paused' : 'Running') : 'Ready';
    updateStats();
}

function getGridPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CONFIG.CELL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / CONFIG.CELL_SIZE);
    return { x, y };
}

function placeTool(x, y, tool) {
    if (state.isPlaying) return;
    const cell = getCell(x, y);
    if (cell === null) return;
    if (tool === 'chair') {
        if (cell === 'floor' && canPlaceChair()) {
            setCell(x, y, 'chair');
            state.students.push(new Student(x, y, state.students.length));
        }
    } else if (tool === 'exit') {
        if (cell === 'floor' || cell === 'chair') {
            if (cell === 'chair') state.students = state.students.filter(s => s.x !== x || s.y !== y);
            setCell(x, y, 'exit');
        }
    } else if (tool === 'wall') {
        if (cell === 'floor') setCell(x, y, 'wall');
    } else if (tool === 'eraser') {
        if (cell === 'chair') state.students = state.students.filter(s => s.x !== x || s.y !== y);
        setCell(x, y, 'floor');
        state.hazards.fire = state.hazards.fire.filter(h => h.x !== x || h.y !== y);
        state.hazards.quake = state.hazards.quake.filter(h => h.x !== x || h.y !== y);
    }
    updateStats();
    render();
}

function placeHazard(x, y, type) {
    if (state.isPlaying) return;
    const cell = getCell(x, y);
    if (cell !== 'floor' && cell !== 'chair') return;
    if (type === 'fire') {
        const idx = state.hazards.fire.findIndex(h => h.x === x && h.y === y);
        if (idx >= 0) state.hazards.fire.splice(idx, 1);
        else state.hazards.fire.push({ x, y });
    } else if (type === 'quake') {
        const idx = state.hazards.quake.findIndex(h => h.x === x && h.y === y);
        if (idx >= 0) state.hazards.quake.splice(idx, 1);
        else state.hazards.quake.push({ x, y });
    }
    render();
}

// Mouse handlers
let isDragging = false, dragTool = null;

canvas.addEventListener('mousedown', (e) => {
    const pos = getGridPos(e);
    if (e.button === 0) {
        if (state.selectedHazard) placeHazard(pos.x, pos.y, state.selectedHazard);
        else {
            isDragging = true;
            dragTool = state.selectedTool === 'wall' ? 'wall' : state.selectedTool;
            placeTool(pos.x, pos.y, state.selectedTool);
        }
    } else if (e.button === 2) {
        e.preventDefault();
        placeTool(pos.x, pos.y, 'eraser');
    } else if (e.button === 1) {
        e.preventDefault();
        if (state.selectedHazard) placeHazard(pos.x, pos.y, state.selectedHazard);
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging && dragTool) placeTool(getGridPos(e).x, getGridPos(e).y, dragTool);
});

canvas.addEventListener('mouseup', () => { isDragging = false; dragTool = null; });
canvas.addEventListener('mouseleave', () => { isDragging = false; dragTool = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        state.selectedTool = 'eraser';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="eraser"]').classList.add('active');
    }
    if (e.key === ' ') {
        e.preventDefault();
        if (state.isPlaying) pauseSimulation();
        else startSimulation();
    }
});

// UI Event listeners
document.getElementById('btnPlay').addEventListener('click', startSimulation);
document.getElementById('btnPause').addEventListener('click', pauseSimulation);
document.getElementById('btnReset').addEventListener('click', () => {
    stopSimulation();
    initGrid();
    state.students = [];
    state.hazards.fire = [];
    state.hazards.quake = [];
    state.tick = 0;
    state.exitUsage = {};
    loadPreset(document.getElementById('presetSelector').value);
    render();
    updateStats();
});
document.getElementById('btnCloseModal').addEventListener('click', () => {
    document.getElementById('resultsModal').classList.remove('show');
    stopSimulation();
    state.tick = 0;
    state.exitUsage = {};
    for (const student of state.students) {
        student.state = 'seated';
        student.x = student.startX;
        student.y = student.startY;
        student.path = [];
        student.targetExit = null;
        student.waitTime = 0;
        student.moveCounter = 0;
        student.history = [];
        state.grid[student.startY][student.startX] = 'chair';
    }
    state.activeHazards.fire = []; state.activeHazards.debris = [];
    for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.GRID_WIDTH; x++) {
            if (state.grid[y][x] === 'fire' || state.grid[y][x] === 'debris') {
                state.grid[y][x] = 'floor';
            }
        }
    }
    render();
    updateStats();
});

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedTool = btn.dataset.tool;
        state.selectedHazard = null;
        document.querySelectorAll('.hazard-btn').forEach(b => b.classList.remove('active'));
    });
});

document.querySelectorAll('.hazard-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const hazard = btn.dataset.hazard;
        if (state.selectedHazard === hazard) {
            state.selectedHazard = null;
            btn.classList.remove('active');
        } else {
            document.querySelectorAll('.hazard-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.selectedHazard = hazard;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        }
    });
});

document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.speed = parseInt(btn.dataset.speed);
    });
});

document.getElementById('congestionToggle').addEventListener('click', (e) => {
    state.showCongestion = !state.showCongestion;
    e.target.classList.toggle('active');
    render();
});

document.getElementById('presetSelector').addEventListener('change', (e) => loadPreset(e.target.value));

// ───────────────────────────────────────────────────────────────────────────────
// PRESET LAYOUTS
// ───────────────────────────────────────────────────────────────────────────────
function loadPreset(name) {
    initGrid();
    state.students = [];
    state.hazards.fire = [];
    state.hazards.quake = [];
    state.exitUsage = {};
    if (name === 'classroom') {
        for (let x = 0; x < CONFIG.GRID_WIDTH; x++) {
            if (x !== 5 && x !== 14) setCell(x, 0, 'wall');
            if (x !== 5 && x !== 14) setCell(x, CONFIG.GRID_HEIGHT - 1, 'wall');
        }
        for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
            if (y !== 7) setCell(0, y, 'wall');
            if (y !== 7) setCell(CONFIG.GRID_WIDTH - 1, y, 'wall');
        }
        for (let x = 3; x < 17; x++) setCell(x, 5, 'wall');
        for (let x = 3; x < 17; x++) setCell(x, 10, 'wall');
        setCell(5, 0, 'exit');
        setCell(14, 0, 'exit');
        for (let y = 2; y < 5; y++) {
            for (let x = 4; x < 16; x += 2) {
                if (canPlaceChair()) {
                    setCell(x, y, 'chair');
                    state.students.push(new Student(x, y, state.students.length));
                }
            }
        }
        for (let y = 11; y < 14; y++) {
            for (let x = 4; x < 16; x += 2) {
                if (canPlaceChair()) {
                    setCell(x, y, 'chair');
                    state.students.push(new Student(x, y, state.students.length));
                }
            }
        }
    } else if (name === 'corridor') {
        for (let y = 0; y < CONFIG.GRID_HEIGHT; y++) {
            setCell(6, y, 'wall');
            setCell(13, y, 'wall');
        }
        setCell(6, 4, 'floor');
        setCell(13, 4, 'floor');
        setCell(6, 10, 'floor');
        setCell(13, 10, 'floor');
        setCell(0, 7, 'exit');
        setCell(19, 7, 'exit');
        for (let y = 1; y < 4; y++) {
            for (let x = 1; x < 5; x++) {
                if (canPlaceChair()) {
                    setCell(x, y, 'chair');
                    state.students.push(new Student(x, y, state.students.length));
                }
            }
        }
        for (let y = 11; y < 14; y++) {
            for (let x = 15; x < 19; x++) {
                if (canPlaceChair()) {
                    setCell(x, y, 'chair');
                    state.students.push(new Student(x, y, state.students.length));
                }
            }
        }
    } else if (name === 'gym') {
        for (let y = 3; y < 12; y += 4) {
            for (let x = 4; x < 16; x += 4) setCell(x, y, 'wall');
        }
        setCell(0, 0, 'exit');
        setCell(19, 0, 'exit');
        setCell(0, 14, 'exit');
        setCell(19, 14, 'exit');
        for (let y = 2; y < 13; y += 2) {
            for (let x = 2; x < 18; x += 3) {
                if (getCell(x, y) === 'floor' && canPlaceChair()) {
                    setCell(x, y, 'chair');
                    state.students.push(new Student(x, y, state.students.length));
                }
            }
        }
    }
    render();
    updateStats();
}

// ───────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ───────────────────────────────────────────────────────────────────────────────
resizeCanvas();
loadPreset('empty');
render();
updateStats();
