// Bucket Master: fill your bucket with clean water, dodge the dirty stuff,
// and push the mesh filter around to clean dirty drops before they land.

// Grab the elements we need to update while the game runs
const gameArea = document.getElementById('game-area');
const bucket = document.getElementById('bucket');
const bucketFillElement = document.getElementById('bucket-fill');
const filterElement = document.getElementById('filter');
const livesDisplay = document.getElementById('lives-display');
const bucketsDisplay = document.getElementById('buckets-display');
const levelDisplay = document.getElementById('level-display');
const timerDisplay = document.getElementById('timer-display');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalBucketsText = document.getElementById('final-buckets');
const finalTimeText = document.getElementById('final-time');
const finalRateText = document.getElementById('final-rate');
const collectionRateText = document.getElementById('collection-rate');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const startLeaderboardList = document.getElementById('start-leaderboard-list');
const gameOverLeaderboardList = document.getElementById('game-over-leaderboard-list');
const startBtn = document.getElementById('start-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const resetBtn = document.getElementById('reset-btn');
const pauseBtn = document.getElementById('pause-btn');
const pauseScreen = document.getElementById('pause-screen');
const resumeBtn = document.getElementById('resume-btn');
const soundToggleBtn = document.getElementById('sound-toggle');
const confettiLayer = document.getElementById('confetti-layer');
const riverBgA = document.getElementById('river-bg-a');
const riverBgB = document.getElementById('river-bg-b');

// How many clean drops it takes to fill one bucket
const FILL_STEP = 10;

// A rotating gallery of river photos, one shown at a time behind the game
const riverBackgrounds = [
    'img/rivers/river-1-tranquil-stream.jpg',
    'img/rivers/river-2-forest-rocks.jpg',
    'img/rivers/river-3-forest-reflection.jpg',
    'img/rivers/river-4-gorges-du-tarn.jpg',
    'img/rivers/river-5-mountain-stream.jpg',
    'img/rivers/river-6-scenic-view.jpg'
];

// Game state variables
let score = 0;
let lives = 3;
let level = 1;
let dropSpeed = 2;
let spawnDelay = 1100;
let nextLevelScore = 10;
let cleanDropsSpawned = 0;
let cleanDropsCaught = 0;
let bucketJammed = false;
let gameRunning = false;
let activeDrops = [];

// Bucket-filling state
let bucketFill = 0;
let bucketsCompleted = 0;

// How long the current run has been going, counted up in the game loop so
// it naturally freezes whenever the loop is paused or stopped
let elapsedMs = 0;
let lastDisplayedSecond = -1;

// The smallest a run is allowed to be before it can rank on the scoreboard,
// so one lucky early bucket can't fake an absurd buckets-per-minute rate
const MIN_RANKED_MS = 10000;
const LEADERBOARD_KEY = 'bucketMasterLeaderboard';
const LEADERBOARD_SIZE = 10;

// Bucket velocity, tracked each tick so we can push the filter realistically
let lastBucketX = 0;
let lastBucketY = 0;
let bucketVX = 0;
let bucketVY = 0;

// Filter position and velocity, for the physics simulation
let filterX = 0;
let filterY = 0;
let filterVX = 0;
let filterVY = 0;

let spawnTimerId = null;
let gameLoopId = null;
let gamePaused = false;

// Which river photo is showing, and which of the two layers is on top
let currentRiverIndex = 0;
let activeRiverLayer = 'a';

// Sound on/off, remembered between visits
let soundOn = localStorage.getItem('bucketMasterSoundOn');
soundOn = soundOn === null ? true : soundOn === 'true';

let audioContext = null;

// --- Sound ------------------------------------------------------------

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    return audioContext;
}

// Plays a short beep. type is a waveform like 'sine', 'square', 'sawtooth', or 'triangle'.
function playTone(frequency, duration, type) {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
}

function playCatchCleanSound() {
    playTone(660, 0.15, 'sine');
}

function playCatchDirtySound() {
    playTone(160, 0.25, 'sawtooth');
}

function playFilterPingSound() {
    playTone(880, 0.1, 'triangle');
}

function playLevelUpSound() {
    playTone(440, 0.1, 'square');
    setTimeout(function () {
        playTone(660, 0.15, 'square');
    }, 100);
}

function playBucketCompleteSound() {
    playTone(523, 0.12, 'sine');
    setTimeout(function () {
        playTone(659, 0.12, 'sine');
    }, 120);
    setTimeout(function () {
        playTone(784, 0.2, 'sine');
    }, 240);
}

function playGameOverSound() {
    playTone(300, 0.2, 'sawtooth');
    setTimeout(function () {
        playTone(200, 0.3, 'sawtooth');
    }, 150);
}

function updateSoundButton() {
    if (soundOn) {
        soundToggleBtn.textContent = '🔊';
        soundToggleBtn.classList.remove('muted');
        soundToggleBtn.setAttribute('aria-label', 'Mute sound');
    } else {
        soundToggleBtn.textContent = '🔇';
        soundToggleBtn.classList.add('muted');
        soundToggleBtn.setAttribute('aria-label', 'Unmute sound');
    }
}

soundToggleBtn.addEventListener('click', function () {
    soundOn = !soundOn;
    localStorage.setItem('bucketMasterSoundOn', soundOn);
    updateSoundButton();

    if (soundOn) {
        playTone(880, 0.08, 'sine');
    }
});

updateSoundButton();

// --- Bucket movement ----------------------------------------------------

// The bucket can roam the full width, but only the lower part of the height,
// so it still feels like you're catching things falling from above.
function getBucketBounds() {
    const areaWidth = gameArea.clientWidth;
    const areaHeight = gameArea.clientHeight;
    const bucketWidth = bucket.offsetWidth;
    const bucketHeight = bucket.offsetHeight;

    return {
        minX: 0,
        maxX: areaWidth - bucketWidth,
        minY: areaHeight * 0.4,
        maxY: areaHeight - bucketHeight - 6
    };
}

function moveBucketTo(targetX, targetY) {
    if (!gameRunning || bucketJammed || gamePaused) {
        return;
    }

    const bounds = getBucketBounds();
    const newX = Math.max(bounds.minX, Math.min(targetX, bounds.maxX));
    const newY = Math.max(bounds.minY, Math.min(targetY, bounds.maxY));

    bucket.style.left = `${newX}px`;
    bucket.style.top = `${newY}px`;
}

// The bucket follows the mouse directly while it hovers over the game area
gameArea.addEventListener('mousemove', function (event) {
    const areaRect = gameArea.getBoundingClientRect();
    const targetX = event.clientX - areaRect.left - (bucket.offsetWidth / 2);
    const targetY = event.clientY - areaRect.top - (bucket.offsetHeight / 2);
    moveBucketTo(targetX, targetY);
});

// Touch dragging: the bucket follows the finger directly, on both axes
gameArea.addEventListener('touchmove', function (event) {
    event.preventDefault();
    const touch = event.touches[0];
    const areaRect = gameArea.getBoundingClientRect();
    const targetX = touch.clientX - areaRect.left - (bucket.offsetWidth / 2);
    const targetY = touch.clientY - areaRect.top - (bucket.offsetHeight / 2);
    moveBucketTo(targetX, targetY);
}, { passive: false });

// --- Drops ----------------------------------------------------------------

// Create one falling drop or obstacle
function spawnDrop() {
    const drop = document.createElement('div');
    drop.classList.add('drop');

    const roll = Math.random();
    let dropType = 'clean';

    if (roll < 0.65) {
        dropType = 'clean';
        cleanDropsSpawned = cleanDropsSpawned + 1;
    } else if (roll < 0.9) {
        dropType = 'dirty';
    } else {
        dropType = 'obstacle';
    }

    drop.classList.add(dropType);

    const areaWidth = gameArea.clientWidth;
    const randomLeft = Math.random() * (areaWidth - 28);
    drop.style.left = `${randomLeft}px`;
    drop.style.top = '0px';

    gameArea.appendChild(drop);
    activeDrops.push({ element: drop, type: dropType });
}

// Two rectangles are colliding if they overlap on both axes
function isColliding(rectA, rectB) {
    return !(
        rectA.right < rectB.left ||
        rectA.left > rectB.right ||
        rectA.bottom < rectB.top ||
        rectA.top > rectB.bottom
    );
}

// A dirty drop that touches the filter becomes clean, with a little celebration
function filterDrop(dropInfo) {
    dropInfo.type = 'clean';
    dropInfo.element.classList.remove('dirty');
    dropInfo.element.classList.add('clean');
    cleanDropsSpawned = cleanDropsSpawned + 1;

    filterElement.classList.add('filtering');
    setTimeout(function () {
        filterElement.classList.remove('filtering');
    }, 350);

    const filterCenterX = filterX + (filterElement.offsetWidth / 2);
    const filterCenterY = filterY + (filterElement.offsetHeight / 2);
    launchSplash(filterCenterX, filterCenterY, 'clean-splash', 5);
    playFilterPingSound();
}

// --- Filter physics ---------------------------------------------------

// Moves the filter each tick: gravity pulls it down slowly, friction slows
// it down over time, and it bounces gently off the walls of the game area.
function updateFilterPhysics() {
    filterVY = filterVY + 0.05;

    filterX = filterX + filterVX;
    filterY = filterY + filterVY;

    filterVX = filterVX * 0.94;
    filterVY = filterVY * 0.94;

    const areaWidth = gameArea.clientWidth;
    const areaHeight = gameArea.clientHeight;
    const filterWidth = filterElement.offsetWidth;
    const filterHeight = filterElement.offsetHeight;

    if (filterX < 0) {
        filterX = 0;
        filterVX = -filterVX * 0.5;
    } else if (filterX > areaWidth - filterWidth) {
        filterX = areaWidth - filterWidth;
        filterVX = -filterVX * 0.5;
    }

    if (filterY < 0) {
        filterY = 0;
        filterVY = -filterVY * 0.5;
    } else if (filterY > areaHeight - filterHeight) {
        filterY = areaHeight - filterHeight;
        // Extra kick off the floor, with a minimum bounce so gravity can't
        // just pin it flat against the bottom
        filterVY = (-Math.abs(filterVY) * 0.6) - 1.3;
    }

    filterElement.style.left = `${filterX}px`;
    filterElement.style.top = `${filterY}px`;
}

// If the bucket bumps the filter, shove the filter along the bucket's
// direction of travel, plus a little push straight away from the bucket.
function checkBucketFilterCollision() {
    const bucketRect = bucket.getBoundingClientRect();
    const filterRect = filterElement.getBoundingClientRect();

    if (!isColliding(bucketRect, filterRect)) {
        return;
    }

    const bucketCenterX = bucketRect.left + (bucketRect.width / 2);
    const bucketCenterY = bucketRect.top + (bucketRect.height / 2);
    const filterCenterX = filterRect.left + (filterRect.width / 2);
    const filterCenterY = filterRect.top + (filterRect.height / 2);

    const pushX = filterCenterX - bucketCenterX;
    const pushY = filterCenterY - bucketCenterY;
    const pushDistance = Math.sqrt((pushX * pushX) + (pushY * pushY)) || 1;

    filterVX = filterVX + (bucketVX * 0.7) + ((pushX / pushDistance) * 1.5);
    filterVY = filterVY + (bucketVY * 0.7) + ((pushY / pushDistance) * 1.5);

    filterElement.classList.add('bumped');
    setTimeout(function () {
        filterElement.classList.remove('bumped');
    }, 200);
}

function updateBucketVelocity() {
    const currentX = bucket.offsetLeft;
    const currentY = bucket.offsetTop;
    bucketVX = currentX - lastBucketX;
    bucketVY = currentY - lastBucketY;
    lastBucketX = currentX;
    lastBucketY = currentY;
}

// --- Bucket jamming (from hitting an oil slick) ------------------------

function jamBucket() {
    bucketJammed = true;
    bucket.classList.add('jammed');

    setTimeout(function () {
        bucketJammed = false;
        bucket.classList.remove('jammed');
    }, 1000);
}

// --- Score, lives, level, and the bucket-filling mechanic ---------------

// Briefly pops a stat number to draw the eye to it when it changes
function popStat(element) {
    element.classList.add('stat-pop');
    setTimeout(function () {
        element.classList.remove('stat-pop');
    }, 150);
}

// Score itself is no longer shown. It still climbs in the background purely
// to drive the level-up pacing below; buckets-per-minute is the real metric.
function addScore(points) {
    score = score + points;

    if (score >= nextLevelScore) {
        level = level + 1;
        levelDisplay.textContent = level;
        popStat(levelDisplay);
        // Each level needs a bit more score than the last, so the ramp
        // eases off instead of speeding up at a constant rate
        nextLevelScore = nextLevelScore + 10 + (level * 2);

        // The speed and spawn-rate bumps shrink as the level climbs, so the
        // difficulty tapers off instead of stacking up into a sudden wall
        dropSpeed = dropSpeed + Math.max(0.1, 0.3 - (level * 0.02));
        spawnDelay = Math.max(500, spawnDelay - Math.max(15, 45 - (level * 3)));
        restartSpawnTimer();
        launchConfetti(18);
        playLevelUpSound();
    }
}

function loseLife() {
    lives = lives - 1;
    livesDisplay.textContent = '💧'.repeat(Math.max(lives, 0));
    popStat(livesDisplay);

    if (lives <= 0) {
        endGame();
    }
}

// Each clean catch tops off the bucket a little. Full bucket, and it counts.
function fillBucket() {
    bucketFill = bucketFill + FILL_STEP;

    if (bucketFill >= 100) {
        completeBucket();
    } else {
        bucketFillElement.style.height = `${bucketFill}%`;
    }
}

function completeBucket() {
    bucketsCompleted = bucketsCompleted + 1;
    bucketsDisplay.textContent = bucketsCompleted;
    popStat(bucketsDisplay);
    bucketFillElement.style.height = '100%';
    addScore(10);

    const bucketCenterX = bucket.offsetLeft + (bucket.offsetWidth / 2);
    const bucketTopY = bucket.offsetTop;
    launchSplash(bucketCenterX, bucketTopY, 'clean-splash', 16);
    launchConfetti(20);
    playBucketCompleteSound();
    showNextRiver();

    setTimeout(function () {
        bucketFill = 0;
        bucketFillElement.style.height = '0%';
    }, 260);
}

// A dirty catch dumps out whatever progress the current bucket had
function spillBucket() {
    if (bucketFill > 0) {
        const bucketCenterX = bucket.offsetLeft + (bucket.offsetWidth / 2);
        const bucketBottomY = bucket.offsetTop + bucket.offsetHeight;
        launchSplash(bucketCenterX, bucketBottomY, 'dirty-splash', 10);
    }

    bucketFill = 0;
    bucketFillElement.style.height = '0%';
}

// Decide what happens when the bucket touches a drop
function handleCatch(dropInfo) {
    const dropX = dropInfo.element.offsetLeft + (dropInfo.element.offsetWidth / 2);
    const dropY = dropInfo.element.offsetTop + (dropInfo.element.offsetHeight / 2);
    dropInfo.element.remove();

    if (dropInfo.type === 'clean') {
        cleanDropsCaught = cleanDropsCaught + 1;
        addScore(1);
        fillBucket();
        launchSplash(dropX, dropY, 'clean-splash', 7);
        playCatchCleanSound();
    } else if (dropInfo.type === 'dirty') {
        loseLife();
        spillBucket();
        launchSplash(dropX, dropY, 'dirty-splash', 7);
        playCatchDirtySound();
    } else if (dropInfo.type === 'obstacle') {
        loseLife();
        spillBucket();
        jamBucket();
        launchSplash(dropX, dropY, 'dirty-splash', 9);
        playCatchDirtySound();
    }
}

// --- Timer -------------------------------------------------------------

// Turns a millisecond count into an "m:ss" string
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Only touches the DOM when the displayed second actually changes
function updateTimerDisplay() {
    const currentSecond = Math.floor(elapsedMs / 1000);
    if (currentSecond !== lastDisplayedSecond) {
        lastDisplayedSecond = currentSecond;
        timerDisplay.textContent = formatTime(elapsedMs);
    }
}

// --- Scoreboard (buckets per minute) ------------------------------------

function computeBucketsPerMinute() {
    const minutes = elapsedMs / 60000;
    return minutes > 0 ? bucketsCompleted / minutes : 0;
}

function loadLeaderboard() {
    const stored = localStorage.getItem(LEADERBOARD_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveLeaderboard(entries) {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
}

// A run only gets a name prompt if it would actually crack the list
function qualifiesForLeaderboard(bpm) {
    if (elapsedMs < MIN_RANKED_MS || bucketsCompleted <= 0) {
        return false;
    }

    const entries = loadLeaderboard();
    return entries.length < LEADERBOARD_SIZE || bpm > entries[entries.length - 1].bpm;
}

function addLeaderboardEntry(name, bpm) {
    const entries = loadLeaderboard();
    entries.push({
        name: name,
        bpm: bpm,
        buckets: bucketsCompleted,
        timeSeconds: Math.floor(elapsedMs / 1000)
    });

    entries.sort(function (a, b) {
        return b.bpm - a.bpm;
    });

    const trimmed = entries.slice(0, LEADERBOARD_SIZE);
    saveLeaderboard(trimmed);
    return trimmed;
}

function renderLeaderboard(listElement, entries) {
    listElement.innerHTML = '';

    if (entries.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.classList.add('empty');
        emptyItem.textContent = 'No runs yet. Be the first!';
        listElement.appendChild(emptyItem);
        return;
    }

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const item = document.createElement('li');
        item.textContent = `${entry.name} — ${entry.bpm.toFixed(1)} buckets/min (${entry.buckets} in ${formatTime(entry.timeSeconds * 1000)})`;
        listElement.appendChild(item);
    }
}

// --- Main game loop ----------------------------------------------------

// Runs every tick: moves drops, updates the filter's physics, and checks
// every collision (bucket-filter, drop-filter, drop-bucket, drop-miss).
function gameLoop() {
    elapsedMs = elapsedMs + 20;
    updateTimerDisplay();

    updateBucketVelocity();
    updateFilterPhysics();
    checkBucketFilterCollision();

    const bucketRect = bucket.getBoundingClientRect();
    const filterRect = filterElement.getBoundingClientRect();
    const areaBottom = gameArea.getBoundingClientRect().bottom;

    for (let i = activeDrops.length - 1; i >= 0; i--) {
        const dropInfo = activeDrops[i];
        const dropElement = dropInfo.element;
        const currentTop = parseFloat(dropElement.style.top);
        dropElement.style.top = `${currentTop + dropSpeed}px`;

        const dropRect = dropElement.getBoundingClientRect();

        if (dropInfo.type === 'dirty' && isColliding(dropRect, filterRect)) {
            filterDrop(dropInfo);
        }

        if (isColliding(dropRect, bucketRect)) {
            handleCatch(dropInfo);
            activeDrops.splice(i, 1);
        } else if (dropRect.top > areaBottom) {
            // The drop fell past the bucket without being caught
            dropElement.remove();
            activeDrops.splice(i, 1);
        }
    }
}

// Restart the spawn timer, used whenever spawnDelay changes between levels
function restartSpawnTimer() {
    clearInterval(spawnTimerId);
    spawnTimerId = setInterval(spawnDrop, spawnDelay);
}

// Remove every drop currently on screen
function clearDrops() {
    for (let i = 0; i < activeDrops.length; i++) {
        activeDrops[i].element.remove();
    }
    activeDrops = [];
}

// --- Starting, resetting, and ending the game ---------------------------

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    dropSpeed = 2;
    spawnDelay = 1100;
    nextLevelScore = 10;
    cleanDropsSpawned = 0;
    cleanDropsCaught = 0;
    bucketJammed = false;
    gameRunning = true;
    bucketFill = 0;
    bucketsCompleted = 0;
    gamePaused = false;
    elapsedMs = 0;
    lastDisplayedSecond = -1;

    livesDisplay.textContent = '💧💧💧';
    levelDisplay.textContent = level;
    bucketsDisplay.textContent = bucketsCompleted;
    timerDisplay.textContent = '0:00';
    bucketFillElement.style.height = '0%';
    setInitialRiver();

    clearDrops();
    bucket.classList.remove('jammed');
    gameArea.classList.add('playing');
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    pauseScreen.classList.add('hidden');
    nameEntry.classList.add('hidden');
    nameInput.value = '';

    // Place the bucket at the bottom-center of its allowed range
    const bounds = getBucketBounds();
    const startX = (gameArea.clientWidth - bucket.offsetWidth) / 2;
    const startY = bounds.maxY;
    bucket.style.left = `${startX}px`;
    bucket.style.top = `${startY}px`;
    lastBucketX = startX;
    lastBucketY = startY;
    bucketVX = 0;
    bucketVY = 0;

    // Place the filter roughly in the upper-middle of the game area
    filterX = (gameArea.clientWidth - filterElement.offsetWidth) / 2;
    filterY = gameArea.clientHeight * 0.25;
    filterVX = 0;
    filterVY = 0;
    filterElement.style.left = `${filterX}px`;
    filterElement.style.top = `${filterY}px`;

    restartSpawnTimer();
    gameLoopId = setInterval(gameLoop, 20);
}

function endGame() {
    gameRunning = false;
    clearInterval(spawnTimerId);
    clearInterval(gameLoopId);
    clearDrops();
    gameArea.classList.remove('playing');

    const bpm = computeBucketsPerMinute();

    finalBucketsText.textContent = `Buckets filled: ${bucketsCompleted}`;
    finalTimeText.textContent = `Time played: ${formatTime(elapsedMs)}`;
    finalRateText.textContent = `Rate: ${bpm.toFixed(1)} buckets/min`;

    const collectionRate = cleanDropsSpawned > 0
        ? Math.round((cleanDropsCaught / cleanDropsSpawned) * 100)
        : 0;
    collectionRateText.textContent = `Clean water collected: ${collectionRate}%`;

    renderLeaderboard(gameOverLeaderboardList, loadLeaderboard());

    if (qualifiesForLeaderboard(bpm)) {
        nameEntry.classList.remove('hidden');
        launchConfetti(40);
    } else {
        nameEntry.classList.add('hidden');
    }

    playGameOverSound();
    gameOverScreen.classList.remove('hidden');
}

// Reset everything back to the start screen, no matter where the player is
function resetGame() {
    gameRunning = false;
    clearInterval(spawnTimerId);
    clearInterval(gameLoopId);
    clearDrops();

    score = 0;
    lives = 3;
    level = 1;
    bucketFill = 0;
    bucketsCompleted = 0;
    gamePaused = false;
    elapsedMs = 0;
    lastDisplayedSecond = -1;
    livesDisplay.textContent = '💧💧💧';
    levelDisplay.textContent = level;
    bucketsDisplay.textContent = bucketsCompleted;
    timerDisplay.textContent = '0:00';
    bucketFillElement.style.height = '0%';

    gameArea.classList.remove('playing');
    gameOverScreen.classList.add('hidden');
    pauseScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    renderLeaderboard(startLeaderboardList, loadLeaderboard());
}

// Freezes the game in place, without losing any progress
function pauseGame() {
    if (!gameRunning || gamePaused) {
        return;
    }

    gamePaused = true;
    clearInterval(spawnTimerId);
    clearInterval(gameLoopId);
    gameArea.classList.remove('playing');
    pauseScreen.classList.remove('hidden');
}

// Picks back up right where the game left off
function resumeGame() {
    if (!gameRunning || !gamePaused) {
        return;
    }

    gamePaused = false;
    gameArea.classList.add('playing');
    pauseScreen.classList.add('hidden');
    restartSpawnTimer();
    gameLoopId = setInterval(gameLoop, 20);
}

// --- River backgrounds ---------------------------------------------------

// Puts a river photo on a background layer, with a light blue wash over it
// so the drops, bucket, and filter stay easy to see
function setRiverLayerImage(layer, path) {
    layer.style.backgroundImage = `linear-gradient(rgba(139, 209, 203, 0.45), rgba(139, 209, 203, 0.45)), url('${path}')`;
}

// Shows the first river photo, used when a new game starts
function setInitialRiver() {
    currentRiverIndex = 0;
    setRiverLayerImage(riverBgA, riverBackgrounds[currentRiverIndex]);
    riverBgA.classList.add('active');
    riverBgB.classList.remove('active');
    activeRiverLayer = 'a';
}

// Crossfades to the next river photo in the gallery, used on every full bucket
function showNextRiver() {
    currentRiverIndex = (currentRiverIndex + 1) % riverBackgrounds.length;
    const nextPath = riverBackgrounds[currentRiverIndex];

    if (activeRiverLayer === 'a') {
        setRiverLayerImage(riverBgB, nextPath);
        riverBgB.classList.add('active');
        riverBgA.classList.remove('active');
        activeRiverLayer = 'b';
    } else {
        setRiverLayerImage(riverBgA, nextPath);
        riverBgA.classList.add('active');
        riverBgB.classList.remove('active');
        activeRiverLayer = 'a';
    }
}

// --- Visual flourishes: splashes and confetti ---------------------------

// A quick burst of small particles at a point inside the game area,
// used whenever the bucket catches or loses something
function launchSplash(x, y, colorClass, count) {
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.classList.add('splash-particle', colorClass);

        const angle = Math.random() * Math.PI * 2;
        const distance = 18 + (Math.random() * 28);
        const dx = Math.cos(angle) * distance;
        const dy = (Math.sin(angle) * distance) - 12;

        particle.style.setProperty('--dx', `${dx}px`);
        particle.style.setProperty('--dy', `${dy}px`);
        particle.style.left = `${x - 4}px`;
        particle.style.top = `${y - 4}px`;

        gameArea.appendChild(particle);

        setTimeout(function () {
            particle.classList.add('active');
        }, 10);

        setTimeout(function () {
            particle.remove();
        }, 550);
    }
}

// A simple DOM-based confetti burst, no canvas or libraries needed
function launchConfetti(pieceCount) {
    const colors = ['#FFC907', '#2E9DF7', '#4FCB53', '#FF902A', '#F16061'];

    for (let i = 0; i < pieceCount; i++) {
        const piece = document.createElement('div');
        piece.classList.add('confetti-piece');
        piece.style.left = `${Math.random() * 100}vw`;
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animation = `confetti-fall ${1 + Math.random()}s linear forwards`;

        confettiLayer.appendChild(piece);

        setTimeout(function () {
            piece.remove();
        }, 2000);
    }
}

// Wire up the buttons
startBtn.addEventListener('click', startGame);
playAgainBtn.addEventListener('click', startGame);
resetBtn.addEventListener('click', resetGame);
pauseBtn.addEventListener('click', pauseGame);
resumeBtn.addEventListener('click', resumeGame);

saveNameBtn.addEventListener('click', function () {
    const name = nameInput.value.trim() || 'Anonymous';
    const bpm = computeBucketsPerMinute();
    const updatedEntries = addLeaderboardEntry(name, bpm);

    renderLeaderboard(gameOverLeaderboardList, updatedEntries);
    nameEntry.classList.add('hidden');
});

// Show whatever scoreboard already exists as soon as the page loads
renderLeaderboard(startLeaderboardList, loadLeaderboard());
