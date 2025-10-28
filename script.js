// Beginner-friendly DOM-based tower defense game logic.
// Uses const/let, template literals, and comments to help students learn.

// Configuration
const ROWS = 9;
const COLS = 15;
// these will be adjusted by difficulty selection
let WAVE_TARGET = 15; // survive this many waves to win
let POLLUTED_LIMIT = 8; // too many polluted drops -> lose

// Difficulty configurations - meaningful changes to win condition, tolerance, spawn speed and starting coins
const difficultyConfigs = {
  easy:  { waveTarget: 10, pollutedLimit: 12, spawnSpeed: 0.85, startingCoins: 14, waveTimeLimit: 90 },
  normal:{ waveTarget: 15, pollutedLimit: 8,  spawnSpeed: 1.0,  startingCoins: 10, waveTimeLimit: 60 },
  hard:  { waveTarget: 20, pollutedLimit: 6,  spawnSpeed: 1.25, startingCoins: 8,  waveTimeLimit: 45 }
};

let selectedDifficulty = 'normal';
let spawnSpeedMultiplier = 1.0; // used to alter spawn intervals (higher => faster spawning)
let startingCoins = 10;
let waveTimeLimit = 60; // seconds allowed per wave before penalty (adjusted by difficulty)
let waveTimerSeconds = 0;
let waveTimerIntervalId = null;

// Game state
let gridEl;
let cells = []; // DOM cells
let path = []; // indices along which drops travel
let drops = []; // active dirty drops
let towers = {}; // key = cellIndex -> tower object
let selectedTowerType = null;
let wave = 0;
let score = 0;
let coins = 10;
let health = 100;
let polluted = 0;
let spawning = false;
let gameRunning = false;
let spawnIntervalId = null;
let stepIntervalId = null;

// UI refs (we get them after DOM is ready)
let startOverlay, startBtn, backToTitleBtn, gameUI, endOverlay;
let endTitle, endMsg, restartBtn, toTitleBtn;
let waveEl, scoreEl, coinsEl, pollutedEl;
let startWaveBtn, autoWaveBtn;
let autoWave = true; // whether waves start automatically
let difficultyDisplayEl, timerDisplayEl;
let milestoneMsgEl;

// Milestones: array of objects with score threshold and message.
// This demonstrates use of arrays, conditionals, and state tracking.
const milestones = [
  { score: 20, title: 'First Steps', msg: "Nice! You've cleaned 20 points — keep going!" },
  { score: 50, title: 'Helping Hands', msg: "Great work — 50 points. The village thanks you!" },
  { score: 100, title: 'Community Hero', msg: "Amazing! 100 points — you're making a real difference." },
  { score: 200, title: 'Water Champion', msg: "Incredible — 200 points! The village is thriving." }
];
// Track which milestones we've already shown to avoid repeats
const achievedMilestones = new Set();

// Wait until DOM is ready to query elements
window.addEventListener('DOMContentLoaded', () => {
  // UI references
  startOverlay = document.getElementById('startOverlay');
  startBtn = document.getElementById('startBtn');
  backToTitleBtn = document.getElementById('backToTitle');
  gameUI = document.getElementById('gameUI');
  endOverlay = document.getElementById('endOverlay');
  endTitle = document.getElementById('endTitle');
  endMsg = document.getElementById('endMsg');
  restartBtn = document.getElementById('restartBtn');
  toTitleBtn = document.getElementById('toTitleBtn');

  waveEl = document.getElementById('wave');
  scoreEl = document.getElementById('score');
  const cheerBtn = document.getElementById('cheerBtn');
  coinsEl = document.getElementById('coins');
  pollutedEl = document.getElementById('polluted');
  startWaveBtn = document.getElementById('startWaveBtn');
  autoWaveBtn = document.getElementById('autoWaveBtn');
  timerDisplayEl = document.getElementById('timerDisplay');
  difficultyDisplayEl = document.getElementById('difficultyDisplay');
  milestoneMsgEl = document.getElementById('milestoneMsg');
  const howtoCloseBtn = document.getElementById('howtoClose');

  if (howtoCloseBtn) howtoCloseBtn.addEventListener('click', () => {
    const howto = document.getElementById('howto');
    if (howto) howto.classList.add('hidden');
  });

  // Difficulty buttons - allow choosing mode on title screen
  const diffBtns = document.querySelectorAll('.diffBtn');
  diffBtns.forEach(b => {
    b.addEventListener('click', (ev) => {
      diffBtns.forEach(x => x.classList.remove('selected'));
      ev.currentTarget.classList.add('selected');
      selectedDifficulty = ev.currentTarget.dataset.diff || 'normal';
      if (difficultyDisplayEl) difficultyDisplayEl.textContent = capitalize(selectedDifficulty);
    });
  });

  // Logo interaction: click to rotate slightly
  const logo = document.getElementById('siteLogo');
  if (logo) {
    logo.addEventListener('click', () => {
      logo.classList.add('rotating');
      setTimeout(() => logo.classList.remove('rotating'), 650);
    });
  }

  if (startWaveBtn) startWaveBtn.addEventListener('click', startNextWaveManual);
  if (autoWaveBtn) autoWaveBtn.addEventListener('click', toggleAutoWave);
  if (cheerBtn) cheerBtn.addEventListener('click', () => { score += 1; updateUI(); });

  gridEl = document.getElementById('grid');

  // Build grid, path and attach handlers
  createGrid();
  buildSimplePath();
  renderPath();
  attachPaletteHandlers();
  attachButtons();
  // wireframe apply option removed
});

// create the grid DOM cells
function createGrid() {
  gridEl.innerHTML = '';
  cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const div = document.createElement('div');
      div.className = 'cell';
      div.dataset.index = idx;
      // clicking a cell can place or upgrade a tower
      div.addEventListener('click', onCellClick);
      gridEl.appendChild(div);
      cells.push(div);
    }
  }
}

// make a simple straight path across the middle row
function buildSimplePath() {
  path = [];
  const midRow = Math.floor(ROWS / 2);
  for (let c = 0; c < COLS; c++) {
    path.push(midRow * COLS + c);
  }
}

// apply visual classes for path and towers
function renderPath() {
  cells.forEach(cell => {
    cell.classList.remove('path', 'tower');
    cell.innerHTML = '';
  });
  path.forEach(idx => cells[idx].classList.add('path'));
  // render existing towers (if any)
  for (const idxStr of Object.keys(towers)) {
    const idx = Number(idxStr);
    renderTowerAt(idx);
  }
  renderDrops();
}

// handle clicks on grid cells
function onCellClick(e) {
  if (!gameRunning) return;
  const idx = Number(e.currentTarget.dataset.index);
  // do not allow towers on the path
  if (path.includes(idx)) {
    flashCell(idx, 'red');
    return;
  }

  // upgrade if tower exists
  if (towers[idx]) {
    upgradeTower(idx);
    return;
  }

  // require tower type selected
  if (!selectedTowerType) return;

  const towerDefs = {
    basic: { cost: 10, range: 2, power: 1 },
    slow:  { cost: 10, range: 3, power: 0.5, slow: 1 } // both towers cost 10 now
  };
  const def = towerDefs[selectedTowerType] || towerDefs.basic;

  if (coins < def.cost) {
    flashCoin();
    return;
  }

  coins -= def.cost;
  updateUI();

  towers[idx] = {
    type: selectedTowerType,
    level: 1,
    power: def.power,
    range: def.range,
    slow: def.slow || 0
  };
  renderTowerAt(idx);
}

// draw tower UI into a cell
function renderTowerAt(idx) {
  const cell = cells[idx];
  cell.classList.add('tower');
  // create icon container and level badge
  cell.innerHTML = '';
  const icon = document.createElement('div');
  icon.className = 'towerIcon';
  const lvl = document.createElement('div');
  lvl.className = 'towerLevel';
  lvl.textContent = `Lv ${towers[idx].level}`;
  cell.appendChild(icon);
  cell.appendChild(lvl);
}

// upgrade a tower
function upgradeTower(idx) {
  const tower = towers[idx];
  if (!tower) return;
  const upgradeCost = tower.level * 5;
  if (coins < upgradeCost) {
    flashCoin();
    return;
  }
  coins -= upgradeCost;
  tower.level += 1;
  tower.power = Number((tower.power + 1).toFixed(2));
  renderTowerAt(idx);
  updateUI();
}

// small UI feedback helpers
function flashCoin() {
  const original = coinsEl.style.color;
  coinsEl.style.color = '#F5402C';
  setTimeout(() => coinsEl.style.color = original, 300);
}
function flashCell(idx, color = 'red') {
  const el = cells[idx];
  const orig = el.style.boxShadow;
  el.style.boxShadow = `0 0 8px ${color}`;
  setTimeout(() => el.style.boxShadow = orig, 300);
}

// palette handlers
function attachPaletteHandlers() {
  const selectBtns = document.querySelectorAll('.selectTowerBtn');
  selectBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.currentTarget.closest('.towerCard');
      selectedTowerType = card.dataset.towerType || 'basic';
      document.querySelectorAll('.towerCard').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

// top-level buttons
// Wave 10 celebration
function showWave10Celebration() {
  const overlay = document.getElementById('celebrationOverlay');
  const continueBtn = document.getElementById('continueBtn');
  const restartBtn = document.getElementById('celebrationRestartBtn');

  overlay.classList.remove('hidden');
  
  continueBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    setTimeout(nextWave, 800); // Continue to wave 11
  });
  
  restartBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    resetGame();
    startGame();
  });
}

function attachButtons() {
  startBtn.addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    gameUI.classList.remove('hidden');
    startGame();
  });

  backToTitleBtn.addEventListener('click', () => {
    stopGame();
    endOverlay.classList.add('hidden');
    gameUI.classList.add('hidden');
    startOverlay.classList.remove('hidden');
    // show how-to when returning to title screen
    const howto = document.getElementById('howto');
    if (howto) howto.classList.remove('hidden');
  });

  restartBtn.addEventListener('click', () => {
    endOverlay.classList.add('hidden');
    resetGame();
    startGame();
  });

  toTitleBtn.addEventListener('click', () => {
    endOverlay.classList.add('hidden');
    gameUI.classList.add('hidden');
    startOverlay.classList.remove('hidden');
    // ensure how-to is visible on the title screen
    const howto = document.getElementById('howto');
    if (howto) howto.classList.remove('hidden');
  });
}

// start the game
function startGame() {
  // apply chosen difficulty then reset state
  applySelectedDifficulty();
  resetGame();
  // hide the how-to/help panel once the player starts the game
  const howto = document.getElementById('howto');
  if (howto) howto.classList.add('hidden');
  gameRunning = true;
  nextWave();
  // Ensure we have a game step interval
  if (!stepIntervalId) {
    stepIntervalId = setInterval(gameStep, 450);
  }
}

// Apply difficulty settings to global game variables
function applySelectedDifficulty() {
  const cfg = difficultyConfigs[selectedDifficulty] || difficultyConfigs.normal;
  WAVE_TARGET = cfg.waveTarget;
  POLLUTED_LIMIT = cfg.pollutedLimit;
  spawnSpeedMultiplier = cfg.spawnSpeed;
  startingCoins = cfg.startingCoins;
  waveTimeLimit = cfg.waveTimeLimit;
  // show current selection in HUD if present
  const dd = document.getElementById('difficultyDisplay');
  if (dd) dd.textContent = capitalize(selectedDifficulty);
}

// small helper
function capitalize(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

// reset state
function resetGame() {
  // Clear any existing intervals first
  clearIntervals();
  
  // Reset all game state
  wave = 0;
  score = 0;
  coins = startingCoins || 10;
  health = 100;
  polluted = 0;
  drops = [];
  towers = {};
  selectedTowerType = null;
  spawning = false;
  gameRunning = false;
  
  // Update UI
  updateUI();
  renderPath();
}

// clear intervals
function clearIntervals() {
  if (spawnIntervalId) clearInterval(spawnIntervalId);
  if (stepIntervalId) clearInterval(stepIntervalId);
  spawnIntervalId = null;
  stepIntervalId = null;
  if (waveTimerIntervalId) clearInterval(waveTimerIntervalId);
  waveTimerIntervalId = null;
}

// stop game (used when returning to title)
function stopGame() {
  gameRunning = false;
  clearIntervals();
}

// configure next wave
function nextWave() {
  if (!gameRunning) return;
  wave += 1;
  updateUI();
  // Fewer drops in early waves (easier first 10 waves)
  const spawnCount = wave <= 10 ? Math.max(1, Math.floor((2 + wave) / 1.5)) : (4 + wave);
  let spawned = 0;
  spawning = true;

  // compute spawn interval and apply difficulty multiplier
  const baseInterval = (wave <= 10 ? 1100 : 700);
  const intervalMs = Math.max(120, Math.round(baseInterval / spawnSpeedMultiplier));

  // reset wave timer each wave
  waveTimerSeconds = 0;
  if (waveTimerIntervalId) clearInterval(waveTimerIntervalId);
  waveTimerIntervalId = setInterval(() => {
    waveTimerSeconds += 1;
    if (timerDisplayEl) timerDisplayEl.textContent = `${waveTimerSeconds}s`;
    if (waveTimerSeconds >= (waveTimeLimit || 60)) {
      // time penalty: small health reduction and visual feedback, then reset wave timer
      health = Math.max(0, health - 5);
      flashCell(path[path.length - 1], 'orange');
      waveTimerSeconds = 0;
      updateUI();
      if (health <= 0) {
        endGame(false);
      }
    }
  }, 1000);

  spawnIntervalId = setInterval(() => {
    if (spawned >= spawnCount) {
      spawning = false;
      clearInterval(spawnIntervalId);
      spawnIntervalId = null;
      return;
    }
    spawnDrop();
    spawned += 1;
  }, intervalMs); // spawn interval respects difficulty multiplier
}

// Manual start for next wave (used when autoWave is off)
function startNextWaveManual() {
  if (!gameRunning) return;
  if (!spawning && drops.length === 0) {
    nextWave();
  }
}

function toggleAutoWave() {
  autoWave = !autoWave;
  if (autoWaveBtn) autoWaveBtn.textContent = `Auto: ${autoWave ? 'On' : 'Off'}`;
  // hide or show manual button
  if (startWaveBtn) startWaveBtn.classList.toggle('hidden', autoWave);
}

// spawn a dirty drop at start of path
function spawnDrop() {
  // Weaker drops in first 10 waves
  const baseHp = wave <= 10 ? 1 : 2;
  const waveBonus = Math.floor((wave - 1) / 2);
  const totalHp = baseHp + waveBonus;
  const drop = {
    pathIndex: 0,
    hp: totalHp,
    maxHp: totalHp,
    id: Date.now() + Math.random()
  };
  drops.push(drop);
  renderDrops();
}

// Show a transient milestone message in the HUD
function showMilestone(title, message) {
  if (!milestoneMsgEl) return;
  milestoneMsgEl.textContent = `${title} — ${message}`;
  milestoneMsgEl.classList.remove('hidden');
  // trigger visible class for animation
  requestAnimationFrame(() => milestoneMsgEl.classList.add('visible'));
  // hide after a few seconds
  setTimeout(() => {
    if (!milestoneMsgEl) return;
    milestoneMsgEl.classList.remove('visible');
    // wait for transition then hide completely
    setTimeout(() => milestoneMsgEl.classList.add('hidden'), 300);
  }, 3500);
}

// Check milestones against current score and award/notify once
function checkMilestones() {
  for (const m of milestones) {
    if (score >= m.score && !achievedMilestones.has(m.score)) {
      achievedMilestones.add(m.score);
  // award a small coin bonus for hitting milestone
  coins += 5;
  // notify player
  showMilestone(m.title, m.msg);
  // update coins display quickly without re-entering updateUI to avoid recursion
  if (coinsEl) coinsEl.textContent = `${coins}`;
    }
  }
}

// draw drops into grid cells
function renderDrops() {
  // clear previous drop DOM nodes
  cells.forEach(cell => {
    const existing = cell.querySelector('.drop');
    if (existing) existing.remove();
  });

  for (const drop of drops) {
    const idx = path[drop.pathIndex] || null;
    if (idx == null) continue;
    const el = document.createElement('div');
    el.className = 'drop';
    el.dataset.dropId = String(drop.id);
    // Add classes for damaged vs cleaned
    if (drop.cleaned) {
      el.classList.add('cleaned');
    } else if (drop.maxHp && drop.hp < drop.maxHp) {
      el.classList.add('damaged');
    }
    // targeted feedback
    if (drop.targeted) el.classList.add('targeted');
    // transient damage animation
    if (drop.wasDamaged) el.classList.add('hit-anim');
    el.title = `HP ${drop.hp}`;

    // clicking a drop manually cleans it and grants a small reward
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = ev.currentTarget.dataset.dropId;
      const d = drops.find(x => String(x.id) === id);
      if (!d) return;
      if (!d.cleaned) {
        d.cleaned = true;
        score += 6;
        coins += 3;
        playCleanSound();
      }
      // animate then remove
      ev.currentTarget.classList.add('clicked');
      setTimeout(() => {
        d.toRemove = true;
        renderDrops();
        updateUI();
      }, 300);
    });

    cells[idx].appendChild(el);
  }
}

// main game loop step
function gameStep() {
  if (!gameRunning) return;

  // towers attack
  // clear targeted flags each tick
  for (const d of drops) d.targeted = false;
  // clear tower targeting state and classes
  for (const idxStr of Object.keys(towers)) {
    const tIdx = Number(idxStr);
    const t = towers[idxStr];
    t.targeting = false;
    if (cells[tIdx]) cells[tIdx].classList.remove('targeting');
  }

  for (const [idxStr, tower] of Object.entries(towers)) {
    const tIdx = Number(idxStr);
    const tRow = Math.floor(tIdx / COLS);
    const tCol = tIdx % COLS;

    // find first drop in range
    for (const drop of drops) {
      const dropCellIdx = path[drop.pathIndex];
      const dRow = Math.floor(dropCellIdx / COLS);
      const dCol = dropCellIdx % COLS;
      const dist = Math.abs(tRow - dRow) + Math.abs(tCol - dCol);
      if (dist <= tower.range) {
        // don't target drops that are already cleaned
        if (drop.cleaned) continue;
        // tower targets this drop
        drop.targeted = true;
        tower.targeting = true;
        // visually highlight tower that's targeting
        if (cells[tIdx]) cells[tIdx].classList.add('targeting');
        // tower hits drop
        drop.wasDamaged = true;
        drop.hp -= tower.power;
        if (tower.slow) {
          // slow could reduce movement speed (simple example: reduce next move)
          drop.slow = (drop.slow || 0) + tower.slow;
        }
        if (drop.hp <= 0 && !drop.cleaned) {
          // mark as cleaned and reward, but keep it moving
          drop.cleaned = true;
          drop.hp = 0;
          score += 10;
          coins += 4; // cleaned drop now gives 4 coins
          playCleanSound();
        }
        break; // one attack per tick per tower
      }
    }
  }

  // clear transient wasDamaged flags shortly after to allow CSS animation
  for (const drop of drops) {
    if (drop.wasDamaged) {
      // capture ref
      const d = drop;
      setTimeout(() => {
        d.wasDamaged = false;
        // re-render drops to remove animation class
        renderDrops();
      }, 220);
    }
  }

  // do not remove cleaned drops here; they'll continue moving until end

  // move drops forward
  for (const drop of drops) {
    // if slowed, skip movement some ticks (simple mechanic)
    if (drop.slow && Math.random() < 0.5) {
      // occasionally skip movement while slowed
      drop.slow = Math.max(0, drop.slow - 1);
      continue;
    }
    drop.pathIndex += 1;
    if (drop.pathIndex >= path.length) {
      // reached village
      // if the drop is cleaned, it does no damage and simply exits
      if (drop.cleaned) {
        drop.toRemove = true;
      } else {
        polluted += 1;
        // do not reduce coins when drops escape
        health = Math.max(0, health - 5); // Reduce health by 5
        drop.toRemove = true;

        // Check for game over due to health
        if (health <= 0) {
          endGame(false);
          return;
        }
      }
    }
  }

  // cleanup drops that reached the end
  drops = drops.filter(d => !d.toRemove);

  renderDrops();
  updateUI();

  // lose condition
  if (polluted >= POLLUTED_LIMIT) {
    endGame(false);
    return;
  }

  // wave complete?
  if (!spawning && drops.length === 0) {
    if (wave === 10) {
      showWave10Celebration();
      return;
    }
    if (wave >= WAVE_TARGET) {
      endGame(true);
      return;
    }
    if (autoWave) {
      setTimeout(nextWave, 800);
    } else {
      // show manual start button
      if (startWaveBtn) startWaveBtn.classList.remove('hidden');
    }
  }
}

// update HUD values
function updateUI() {
  waveEl.textContent = `${wave}`;
  scoreEl.textContent = `${score}`;
  if (timerDisplayEl) timerDisplayEl.textContent = `${waveTimerSeconds}s`;
  coinsEl.textContent = `${coins}`;
  // Some HUD elements may not exist (polluted was removed). Update defensively.
  if (typeof pollutedEl !== 'undefined' && pollutedEl && pollutedEl !== null) {
    pollutedEl.textContent = `${polluted}`;
  }
  
  // Update health display
  const healthEl = document.getElementById('health');
  const healthFill = document.getElementById('healthFill');
  if (healthEl && healthFill) {
    healthEl.textContent = Math.max(0, health);
    healthFill.style.width = `${Math.max(0, health)}%`;
    
    // Update color based on health level
    if (health <= 25) {
      healthFill.style.background = '#F5402C'; // Red when critical
    } else if (health <= 50) {
      healthFill.style.background = '#FF902A'; // Orange when low
    } else {
      // use CSS variable set in styles for dark green
      healthFill.style.background = getComputedStyle(document.documentElement).getPropertyValue('--cw-dark-green') || '#4FCB53';
    }
  }
    // After updating basic UI, check milestones (will only notify once per milestone)
    checkMilestones();
}

  // After updating basic UI, check milestones (will only notify once per milestone)
  checkMilestones();

// end the game and show overlay
function endGame(victory) {
  gameRunning = false;
  clearIntervals();
  endOverlay.classList.remove('hidden');
  if (victory) {
    endTitle.textContent = 'VICTORY';
    endMsg.textContent = `You survived ${wave} waves and brought clean water to the village! Score: ${score}`;
  } else {
    endTitle.textContent = 'GAME OVER';
    endMsg.textContent = `Too many polluted drops reached the village. Score: ${score}`;
  }
}

// tiny WebAudio sound for cleaned drop (no external file)
function playCleanSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 600;
    g.gain.value = 0.02;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 80);
  } catch (err) {
    // ignore audio errors on older browsers
  }
}
