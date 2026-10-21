// Bucket Master: fill your bucket with clean water, dodge the dirty stuff,
// and push the mesh filter around to clean dirty drops before they land.

// Grab the elements we need to update while the game runs
const gameArea = document.getElementById('game-area');
const bucket = document.getElementById('bucket');
const bucketFillElement = document.getElementById('bucket-fill');
const bucketCracksSvg = document.getElementById('bucket-cracks');
const filterElement = document.getElementById('filter');
const filterCracksSvg = document.getElementById('filter-cracks');
const livesDisplay = document.getElementById('lives-display');
const bucketsDisplay = document.getElementById('buckets-display');
const levelDisplay = document.getElementById('level-display');
const timerDisplay = document.getElementById('timer-display');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalRateText = document.getElementById('final-rate');
const finalDetailsText = document.getElementById('final-details');
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

// Obstacle drops get tagged with one of these for visual variety
const obstacleVariants = [
    'obstacle-bowling', 'obstacle-can', 'obstacle-bottle', 'obstacle-tire', 'obstacle-banana',
    'obstacle-paperball', 'obstacle-flipflop', 'obstacle-plank', 'obstacle-screw', 'obstacle-milkbox'
];

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

// How many times the bucket has been cracked by trash (0-3). Three cracks
// and it explodes.
let bucketCracks = 0;

// The filter is breakable like the bucket: two cracks, then the third trash
// hit blows it up. It stays gone until the next bucket is filled.
let filterCracks = 0;
let filterBroken = false;
let filterExplodeTimeoutId = null;

// True while the bucket is mid-exit or mid-entrance, so movement and
// physics pause instead of fighting the CSS animation
let bucketTransitioning = false;

// How long the current run has been going, counted up in the game loop so
// it naturally freezes whenever the loop is paused or stopped
let elapsedMs = 0;
let lastDisplayedSecond = -1;

// The smallest a run is allowed to be before it can rank on the scoreboard,
// so one lucky early bucket can't fake an absurd buckets-per-minute rate
const MIN_RANKED_MS = 10000;

// Bumped to v2 so switching to a top-5 board also clears out everyone's
// old top-10 scores instead of needing to migrate them
const LEADERBOARD_KEY = 'bucketMasterLeaderboardV2';
const LEADERBOARD_SIZE = 5;

// Bucket velocity, tracked each tick so we can push the filter realistically
let lastBucketX = 0;
let lastBucketY = 0;
let bucketVX = 0;
let bucketVY = 0;

// Spring-damped pendulum tilt, driven by side-to-side speed, plus a
// shake offset for the jam effect. Both ride on #bucket's own transform.
let bucketTilt = 0;
let bucketTiltVelocity = 0;
let bucketShakeUntil = 0;
let lastSloshSplashTime = 0;

// Filter position and velocity, for the physics simulation
let filterX = 0;
let filterY = 0;
let filterVX = 0;
let filterVY = 0;

// So the filter-bump sound doesn't machine-gun while the bucket stays
// pressed against the filter
let lastFilterBumpSoundTime = 0;

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

// Water sounds are mostly noise shaped by filters, not clean tones, so this
// builds a short burst of white noise to use as the raw material for
// splashes, pours, and drains.
function createNoiseBuffer(duration) {
    const ctx = getAudioContext();
    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) {
        data[i] = (Math.random() * 2) - 1;
    }

    return buffer;
}

// Filtered noise swept from one cutoff frequency to another, for
// splashes, pours, and drains
function playWaterNoise(duration, filterType, freqStart, freqEnd, volume) {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(duration);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(freqStart, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    noiseSource.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    noiseSource.start();
    noiseSource.stop(ctx.currentTime + duration);
}

// A single droplet "plink": a sine tone that glides quickly between two
// pitches, the classic water-drop shape, with a touch of echo so it sounds
// like it's landing in a pool rather than beeping in open air
function playWaterDrop(startFrequency, endFrequency, duration) {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(startFrequency, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + duration);

    gainNode.gain.setValueAtTime(0.25, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    const delay = ctx.createDelay();
    delay.delayTime.value = 0.09;
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0.25;

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    gainNode.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
}

// A quick bubble "pop": pitch rises instead of falling, like a bubble
// breaking the surface, with a fast shallow wobble for a liquid shimmer
function playBubble(frequency, duration) {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency * 0.6, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, ctx.currentTime + duration);

    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.value = 18;
    vibratoGain.gain.value = frequency * 0.04;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(oscillator.frequency);

    gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    vibrato.start();
    oscillator.stop(ctx.currentTime + duration);
    vibrato.stop(ctx.currentTime + duration);
}

// The pop-like catch and filter sounds stay as simple droplet/bubble
// shapes; the murkier ones below get a noise-based splash layered in
// A short, percussive water "plop": a low thump that drops in pitch fast,
// plus a tiny tick of noise right at the start for the splash of the drop
// landing. Randomized every time so no two plops sound quite the same.
function playPlop() {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();

    const startFrequency = 220 + (Math.random() * 180);
    const endFrequency = 70 + (Math.random() * 50);
    const duration = 0.09 + (Math.random() * 0.07);

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(startFrequency, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + duration);

    gainNode.gain.setValueAtTime(0.35, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);

    const tickDuration = 0.02 + (Math.random() * 0.02);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(tickDuration);

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.Q.value = 1.5;
    noiseFilter.frequency.value = 1200 + (Math.random() * 1400);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + tickDuration);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start();
    noiseSource.stop(ctx.currentTime + tickDuration);
}

function playCatchCleanSound() {
    playPlop();
}

function playCatchDirtySound() {
    playWaterNoise(0.3, 'lowpass', 500, 90, 0.3);
    playWaterDrop(260, 120, 0.22);
}

// The thunk of the bucket knocking into something solid: a low triangle
// tone that drops in pitch fast, plus muffled lowpass noise for body
function playBumpThunk(baseFrequency, duration, volume) {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(baseFrequency, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(baseFrequency * 0.5, ctx.currentTime + duration);

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(duration);

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = baseFrequency * 1.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.5, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start();
    noiseSource.stop(ctx.currentTime + duration);
}

// A burst of noise with a choppy, random-stepped gain envelope instead of
// a smooth decay, for a crackling texture tacked onto the end of a sound
function playCrackle(duration, delay, volume) {
    if (!soundOn) {
        return;
    }

    const ctx = getAudioContext();
    const startTime = ctx.currentTime + delay;

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2200;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, startTime);

    const stepCount = 18;
    for (let i = 0; i < stepCount; i++) {
        const stepTime = startTime + ((i / stepCount) * duration);
        const ceiling = volume * (1 - (i / stepCount));
        gainNode.gain.setValueAtTime(Math.random() * ceiling, stepTime);
    }
    gainNode.gain.setValueAtTime(0, startTime + duration);

    noiseSource.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    noiseSource.start(startTime);
    noiseSource.stop(startTime + duration);
}

// A gentle knock when the bucket pushes the filter around, randomly
// pitched a little higher or lower each time
function playFilterBumpSound() {
    const pitchShift = (Math.random() < 0.5 ? -1 : 1) * (20 + (Math.random() * 40));
    playBumpThunk(220 + pitchShift, 0.1, 0.22);
}

// A heavier knock when the bucket collides with a piece of trash: louder,
// longer, with a crackle of debris at the end
function playTrashBumpSound() {
    playBumpThunk(180, 0.22, 0.4);
    playCrackle(0.25, 0.08, 0.3);
}

// The bucket's third and final crack: a heavier thunk, a noise burst, and
// a longer crackle of flying debris
function playExplosionSound() {
    playBumpThunk(110, 0.3, 0.5);
    playWaterNoise(0.3, 'lowpass', 1200, 100, 0.4);
    playCrackle(0.4, 0.05, 0.4);
}

function playFilterPingSound() {
    playBubble(760, 0.14);
}

function playLevelUpSound() {
    playWaterDrop(700, 1000, 0.12);
    setTimeout(function () {
        playWaterDrop(900, 1300, 0.14);
    }, 90);
    setTimeout(function () {
        playBubble(1500, 0.16);
    }, 180);
}

function playBucketCompleteSound() {
    playWaterNoise(0.4, 'bandpass', 1800, 400, 0.22);
    setTimeout(function () {
        playWaterDrop(700, 1100, 0.14);
    }, 60);
    setTimeout(function () {
        playWaterDrop(850, 1300, 0.14);
    }, 160);
    setTimeout(function () {
        playWaterDrop(1000, 1600, 0.18);
    }, 260);
}

function playGameOverSound() {
    playWaterNoise(0.9, 'lowpass', 900, 80, 0.3);
    playWaterDrop(500, 150, 0.4);
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
        playWaterDrop(900, 1300, 0.09);
    }
});

updateSoundButton();

// --- Bucket movement ----------------------------------------------------

// The bucket can roam the full width and height of the play area
function getBucketBounds() {
    const areaWidth = gameArea.clientWidth;
    const areaHeight = gameArea.clientHeight;
    const bucketWidth = bucket.offsetWidth;
    const bucketHeight = bucket.offsetHeight;

    return {
        minX: 0,
        maxX: areaWidth - bucketWidth,
        minY: 0,
        maxY: areaHeight - bucketHeight - 6
    };
}

function moveBucketTo(targetX, targetY) {
    if (!gameRunning || bucketJammed || gamePaused || bucketTransitioning) {
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

// Where the finger sits relative to the bucket: about half a fingertip's
// width above the top of the handle, so the finger never hides the bucket
const TOUCH_GAP_ABOVE_HANDLE = 32;

// Touch dragging: the bucket hangs just below the finger, on both axes
gameArea.addEventListener('touchmove', function (event) {
    event.preventDefault();
    const touch = event.touches[0];
    const areaRect = gameArea.getBoundingClientRect();
    const targetX = touch.clientX - areaRect.left - (bucket.offsetWidth / 2);
    const targetY = touch.clientY - areaRect.top + TOUCH_GAP_ABOVE_HANDLE;
    moveBucketTo(targetX, targetY);
}, { passive: false });

// --- Drops ----------------------------------------------------------------

// Create one falling drop or obstacle
function spawnDrop() {
    const drop = document.createElement('div');
    drop.classList.add('drop');

    const roll = Math.random();
    let dropType = 'clean';

    // Trash starts at 10% of drops and gains 1.2 points each level, capped
    // at 24%. The extra comes out of the clean share; dirty stays at 25%.
    const extraTrash = Math.min(0.14, (level - 1) * 0.012);

    if (roll < 0.65 - extraTrash) {
        dropType = 'clean';
        cleanDropsSpawned = cleanDropsSpawned + 1;
    } else if (roll < 0.9 - extraTrash) {
        dropType = 'dirty';
    } else {
        dropType = 'obstacle';
    }

    drop.classList.add(dropType);

    if (dropType === 'obstacle') {
        const variant = obstacleVariants[Math.floor(Math.random() * obstacleVariants.length)];
        drop.classList.add(variant);
        // Each piece of trash tumbles at its own random (but unhurried)
        // speed instead of a uniform rate
        drop.style.animationDuration = `${(2.6 + (Math.random() * 2.2)).toFixed(2)}s`;
    } else {
        // Each water drop wiggles at its own slightly different speed
        const wiggleDuration = 1.2 + (Math.random() * 1.2);

        // A rare bonus dirty drop: filtering it (not catching it) spawns
        // extra clean drops. It needs its own fixed-speed pulse animation
        // alongside the randomized wiggle, so both durations are listed.
        if (dropType === 'dirty' && Math.random() < 0.08) {
            drop.classList.add('dirty-bonus');
            drop.style.animationDuration = `${wiggleDuration.toFixed(2)}s, 0.9s`;
        } else {
            drop.style.animationDuration = `${wiggleDuration.toFixed(2)}s`;
        }
    }

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
    const wasBonus = dropInfo.element.classList.contains('dirty-bonus');

    dropInfo.type = 'clean';
    dropInfo.element.classList.remove('dirty', 'dirty-bonus');
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

    if (wasBonus) {
        spawnBonusCleanDrops(dropInfo.element);
    }
}

// A filtered bonus drop turns into clean water right where it was, plus
// two more clean drops nearby and above it (never below or far to the
// side), as a little reward
function spawnBonusCleanDrops(originElement) {
    const originLeft = parseFloat(originElement.style.left);
    const originTop = parseFloat(originElement.style.top);
    const areaWidth = gameArea.clientWidth;

    for (let i = 0; i < 2; i++) {
        const offsetX = (Math.random() * 60) - 30;
        const offsetY = -(20 + (Math.random() * 40));
        const newLeft = Math.max(0, Math.min(areaWidth - 28, originLeft + offsetX));
        const newTop = originTop + offsetY;

        const drop = document.createElement('div');
        drop.classList.add('drop', 'clean');
        drop.style.left = `${newLeft}px`;
        drop.style.top = `${newTop}px`;
        drop.style.animationDuration = `${(1.2 + (Math.random() * 1.2)).toFixed(2)}s`;

        gameArea.appendChild(drop);
        activeDrops.push({ element: drop, type: 'clean' });
        cleanDropsSpawned = cleanDropsSpawned + 1;
    }

    launchConfetti(10);
}

// --- Filter physics ---------------------------------------------------

// Moves the filter each tick: gravity pulls it down slowly, friction slows
// it down over time, and it bounces gently off the walls of the game area.
function updateFilterPhysics() {
    if (filterBroken) {
        return;
    }

    filterVY = filterVY + 0.11;

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
        // A stronger kick off the floor, with a bigger minimum bounce so it
        // springs back up higher instead of just settling near the bottom
        filterVY = (-Math.abs(filterVY) * 0.8) - 2.6;
    }

    filterElement.style.left = `${filterX}px`;
    filterElement.style.top = `${filterY}px`;
}

// If the bucket bumps the filter, shove the filter along the bucket's
// direction of travel, plus a little push straight away from the bucket.
function checkBucketFilterCollision() {
    if (bucketTransitioning || filterBroken) {
        return;
    }

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

    const now = Date.now();
    if (now - lastFilterBumpSoundTime > 150) {
        lastFilterBumpSoundTime = now;
        playFilterBumpSound();
    }
}

function updateBucketVelocity() {
    const currentX = bucket.offsetLeft;
    const currentY = bucket.offsetTop;
    bucketVX = currentX - lastBucketX;
    bucketVY = currentY - lastBucketY;
    lastBucketX = currentX;
    lastBucketY = currentY;
}

// Swings the bucket like a pendulum hung from its handle: a spring pulls
// it toward a target tilt based on how fast it's moving sideways, with
// damping so it settles instead of oscillating forever. A jam shake rides
// along on the same transform. Skipped during exit/enter choreography so
// it doesn't fight those CSS animations.
function updateBucketSwing() {
    if (bucketTransitioning) {
        return;
    }

    const targetTilt = Math.max(-18, Math.min(18, bucketVX * 2.2));
    const tiltSpring = (targetTilt - bucketTilt) * 0.18;
    bucketTiltVelocity = (bucketTiltVelocity + tiltSpring) * 0.78;
    bucketTilt = bucketTilt + bucketTiltVelocity;

    let shakeX = 0;
    if (Date.now() < bucketShakeUntil) {
        shakeX = Math.sin(Date.now() * 0.08) * 4;
    }

    bucket.style.transform = `translateX(${shakeX.toFixed(2)}px) rotate(${bucketTilt.toFixed(2)}deg)`;
}

// Fast side-to-side movement sloshes a bit of water out, scaled to speed
function maybeSloshSplash() {
    if (bucketTransitioning || bucketFill <= 0) {
        return;
    }

    const speed = Math.abs(bucketVX);
    if (speed < 3) {
        return;
    }

    const now = Date.now();
    if (now - lastSloshSplashTime < 120) {
        return;
    }
    lastSloshSplashTime = now;

    const count = Math.min(4, Math.floor(speed / 2));
    if (count <= 0) {
        return;
    }

    const bucketCenterX = bucket.offsetLeft + (bucket.offsetWidth / 2);
    const bucketTopY = bucket.offsetTop + 6;
    launchSplash(bucketCenterX, bucketTopY, 'clean-splash', count);
}

// --- Bucket jamming (from hitting trash) --------------------------------

function jamBucket() {
    bucketJammed = true;
    bucket.classList.add('jammed');
    bucketShakeUntil = Date.now() + 300;

    setTimeout(function () {
        bucketJammed = false;
        bucket.classList.remove('jammed');
    }, 1000);
}

// Gives the whole play area a sharp, violent wobble whenever the bucket
// takes damage
function triggerAreaWobble() {
    gameArea.classList.remove('damaged');
    void gameArea.offsetWidth; // force a reflow so the animation restarts
    gameArea.classList.add('damaged');

    setTimeout(function () {
        gameArea.classList.remove('damaged');
    }, 500);
}

// --- Filter damage ---------------------------------------------------------

// Trash that touches the filter cracks it, same as trash hitting the bucket
function hitFilterWithTrash(dropInfo, dropIndex) {
    const dropX = dropInfo.element.offsetLeft + (dropInfo.element.offsetWidth / 2);
    const dropY = dropInfo.element.offsetTop + (dropInfo.element.offsetHeight / 2);
    dropInfo.element.remove();
    activeDrops.splice(dropIndex, 1);

    // The impact knocks the filter downward and a little sideways
    filterVY = filterVY + 1.2;
    filterVX = filterVX + ((Math.random() * 3) - 1.5);

    launchSplash(dropX, dropY, 'debris-splash', 9);
    playTrashBumpSound();
    crackFilter();
}

// One hit from trash: add a crack, and blow up on the third
function crackFilter() {
    filterCracks = filterCracks + 1;
    addCrackVisual(filterCracks, filterCracksSvg, true);

    filterElement.classList.add('bumped');
    setTimeout(function () {
        filterElement.classList.remove('bumped');
    }, 200);

    if (filterCracks >= 3) {
        explodeFilter();
    }
}

// The third hit: a big flash and shockwave, a burst of debris, a hard
// shake of the whole board, and the filter is gone until a bucket is filled
function explodeFilter() {
    filterBroken = true;

    const filterCenterX = filterX + (filterElement.offsetWidth / 2);
    const filterCenterY = filterY + (filterElement.offsetHeight / 2);
    launchSplash(filterCenterX, filterCenterY, 'debris-splash', 36);
    launchSplash(filterCenterX, filterCenterY, 'clean-splash', 14);
    playExplosionSound();
    triggerAreaWobble();
    filterElement.classList.add('exploding');

    clearTimeout(filterExplodeTimeoutId);
    filterExplodeTimeoutId = setTimeout(function () {
        filterElement.classList.remove('exploding');
        filterElement.classList.add('gone');
    }, 450);
}

// Back to a pristine filter, used when a whole new game starts
function resetFilterState() {
    clearTimeout(filterExplodeTimeoutId);
    filterBroken = false;
    filterCracks = 0;
    filterCracksSvg.innerHTML = '';
    filterElement.classList.remove('gone', 'exploding', 'entering', 'shining');
}

// Filling a bucket repairs the filter: cracks are wiped with a shine, and
// a destroyed filter falls back in like a new bucket does
function restoreFilterAfterBucket() {
    const wasBroken = filterBroken;
    const wasCracked = filterCracks > 0;

    if (!wasBroken && !wasCracked) {
        return;
    }

    clearTimeout(filterExplodeTimeoutId);
    filterCracks = 0;
    filterCracksSvg.innerHTML = '';
    filterElement.classList.remove('exploding');

    if (wasBroken) {
        filterBroken = false;
        filterX = (gameArea.clientWidth - filterElement.offsetWidth) / 2;
        filterY = gameArea.clientHeight * 0.25;
        filterVX = 0;
        filterVY = 0;
        filterElement.style.left = `${filterX}px`;
        filterElement.style.top = `${filterY}px`;
        filterElement.classList.remove('gone');
        filterElement.classList.add('entering');
        setTimeout(function () {
            filterElement.classList.remove('entering');
        }, 750);
    }

    filterElement.classList.add('shining');
    setTimeout(function () {
        filterElement.classList.remove('shining');
    }, 1300);
}

// --- Cracking, exploding, and swapping buckets --------------------------

// Recursively builds a jagged, branching crack line starting at (x, y)
// heading in `angle` degrees, like a simplified lightning-bolt fractal.
// Each segment is pushed onto `segments` as its own SVG path "d" string.
function buildCrackBranch(x, y, angle, length, depth, segments) {
    if (depth <= 0 || length < 4) {
        return;
    }

    const jitter = (Math.random() * 40) - 20;
    const nextAngle = angle + jitter;
    const radians = (nextAngle * Math.PI) / 180;
    const nextX = x + (Math.cos(radians) * length);
    const nextY = y + (Math.sin(radians) * length);

    segments.push(`M ${x.toFixed(1)} ${y.toFixed(1)} L ${nextX.toFixed(1)} ${nextY.toFixed(1)}`);

    // Keep the main crack going in roughly the same direction
    buildCrackBranch(nextX, nextY, nextAngle, length * 0.8, depth - 1, segments);

    // Sometimes spin off a smaller side branch, so it reads as fractal
    // rather than a single straight line
    if (Math.random() < 0.6) {
        const branchAngle = nextAngle + ((Math.random() < 0.5 ? 1 : -1) * (30 + (Math.random() * 30)));
        buildCrackBranch(nextX, nextY, branchAngle, length * 0.55, depth - 2, segments);
    }
}

// Adds one more procedural crack, starting from a random point on either
// side of the bucket (where trash would bump it) and branching inward.
// Deeper crackLevel means more branching, so the third crack looks like
// the bucket is about to fall apart.
function addCrackVisual(crackLevel, targetSvg, isRound) {
    if (!targetSvg) {
        return;
    }

    let startX;
    let startY;
    let initialAngle;
    let firstLength = 20;

    if (isRound) {
        // The filter is a circle: start on a random point of its rim and
        // head back in toward the middle
        const rimAngle = Math.random() * 360;
        const rimRadians = (rimAngle * Math.PI) / 180;
        startX = 50 + (Math.cos(rimRadians) * 46);
        startY = 50 + (Math.sin(rimRadians) * 46);
        initialAngle = rimAngle + 180 + ((Math.random() * 50) - 25);
        firstLength = 22;
    } else {
        const fromLeftSide = Math.random() < 0.5;
        startX = fromLeftSide ? 3 : 97;
        startY = 10 + (Math.random() * 75);
        initialAngle = fromLeftSide
            ? (Math.random() * 60) - 30
            : 180 + ((Math.random() * 60) - 30);
    }

    const depth = 1 + crackLevel;
    const segments = [];

    buildCrackBranch(startX, startY, initialAngle, firstLength, depth, segments);

    segments.forEach(function (d, i) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', isRound ? 'crack-line filter-crack-line' : 'crack-line');
        targetSvg.appendChild(path);

        const segmentLength = path.getTotalLength();
        path.style.strokeDasharray = `${segmentLength}`;
        path.style.strokeDashoffset = `${segmentLength}`;

        setTimeout(function () {
            path.style.transition = 'stroke-dashoffset 220ms ease-out';
            path.style.strokeDashoffset = '0';
        }, i * 25);
    });
}

// Clears every crack, used whenever the bucket resets clean
function clearCrackVisuals() {
    bucketCracks = 0;
    if (bucketCracksSvg) {
        bucketCracksSvg.innerHTML = '';
    }
}

// One hit from trash: add a crack, and explode once there are too many
function crackBucket() {
    bucketCracks = bucketCracks + 1;
    addCrackVisual(bucketCracks, bucketCracksSvg, false);

    if (bucketCracks >= 3) {
        // A life is only lost once the bucket is actually gone, same as
        // a contaminated bucket losing a life right away. The first two
        // cracks just damage it.
        explodeBucket();
        loseLife();
    }
}

// Brings in a fresh bucket: resets its fill and cracks, then plays the
// woosh-up-from-offscreen entrance
function enterNewBucket() {
    clearCrackVisuals();
    bucketFill = 0;
    bucketFillElement.style.height = '0%';

    // Start the new bucket's swing from neutral, and clear the inline
    // transform so nothing stale shows once the entering animation ends
    bucketTilt = 0;
    bucketTiltVelocity = 0;
    bucketShakeUntil = 0;
    bucket.style.transform = '';

    bucket.classList.remove('exiting-success', 'exiting-contaminated', 'exploding');
    bucket.classList.add('entering');

    setTimeout(function () {
        bucket.classList.remove('entering');
        bucketTransitioning = false;
    }, 750);
}

// A full bucket shrinks up and away toward the bucket counter, then a
// fresh one wooshes in
function exitBucketSuccess() {
    bucketTransitioning = true;
    bucket.classList.add('exiting-success');

    setTimeout(function () {
        bucket.classList.remove('exiting-success');
        enterNewBucket();
    }, 420);
}

// A contaminated bucket winds up and flings off to a random side, then a
// fresh one wooshes in
function exitBucketContaminated() {
    bucketTransitioning = true;
    const flingDirection = Math.random() < 0.5 ? -1 : 1;

    // Enough distance to clear the play area completely no matter where
    // the bucket currently is or which way it's flung
    const flingDistance = gameArea.clientWidth + bucket.offsetWidth + 100;

    bucket.style.setProperty('--fling-dir', flingDirection);
    bucket.style.setProperty('--fling-distance', `${flingDistance}px`);
    bucket.classList.add('exiting-contaminated');

    setTimeout(function () {
        bucket.classList.remove('exiting-contaminated');
        enterNewBucket();
    }, 550);
}

// Three cracks is one too many: a burst of debris, then a fresh bucket
function explodeBucket() {
    bucketTransitioning = true;

    const bucketCenterX = bucket.offsetLeft + (bucket.offsetWidth / 2);
    const bucketCenterY = bucket.offsetTop + (bucket.offsetHeight / 2);
    launchSplash(bucketCenterX, bucketCenterY, 'debris-splash', 24);
    playExplosionSound();
    bucket.classList.add('exploding');

    setTimeout(function () {
        bucket.classList.remove('exploding');
        enterNewBucket();
    }, 260);
}

// --- Score, lives, level, and the bucket-filling mechanic ---------------

// Briefly pops a stat number to draw the eye to it when it changes
function popStat(element) {
    element.classList.add('stat-pop');
    setTimeout(function () {
        element.classList.remove('stat-pop');
    }, 150);
}

// Tracks each panel's pending fade-out timeout, so a show call can cancel
// it if the panel gets re-shown before the fade finishes
const pendingFadeTimeouts = new WeakMap();

// Fades a panel out instead of snapping it straight to display:none
function hideWithFade(element) {
    const existingTimeout = pendingFadeTimeouts.get(element);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    element.classList.add('fading-out');
    const timeoutId = setTimeout(function () {
        element.classList.remove('fading-out');
        element.classList.add('hidden');
        pendingFadeTimeouts.delete(element);
    }, 260);

    pendingFadeTimeouts.set(element, timeoutId);
}

// Shows a panel right away, cancelling any fade-out still in flight so it
// can't sneak in and hide the panel again a moment later
function showInstantly(element) {
    const existingTimeout = pendingFadeTimeouts.get(element);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingFadeTimeouts.delete(element);
    }

    element.classList.remove('hidden', 'fading-out');
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
    restoreFilterAfterBucket();
    exitBucketSuccess();
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
        triggerAreaWobble();
        launchSplash(dropX, dropY, 'dirty-splash', 7);
        exitBucketContaminated();
        playCatchDirtySound();
    } else if (dropInfo.type === 'obstacle') {
        spillBucket();
        jamBucket();
        triggerAreaWobble();
        crackBucket();
        launchSplash(dropX, dropY, 'dirty-splash', 9);
        playTrashBumpSound();
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
        item.textContent = `${entry.name} — ${entry.bpm.toFixed(1)}/min (${entry.buckets} in ${formatTime(entry.timeSeconds * 1000)})`;
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
    updateBucketSwing();
    maybeSloshSplash();
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

        if (!filterBroken && dropInfo.type === 'obstacle' && isColliding(dropRect, filterRect)) {
            hitFilterWithTrash(dropInfo, i);
            continue;
        }

        if (!filterBroken && dropInfo.type === 'dirty' && isColliding(dropRect, filterRect)) {
            filterDrop(dropInfo);
        }

        if (!bucketTransitioning && isColliding(dropRect, bucketRect)) {
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
    bucket.classList.remove('jammed', 'entering', 'exiting-success', 'exiting-contaminated', 'exploding');
    bucketTransitioning = false;
    clearCrackVisuals();
    gameArea.classList.add('playing');
    document.body.classList.add('playing');
    hideWithFade(startScreen);
    hideWithFade(gameOverScreen);
    hideWithFade(pauseScreen);
    hideWithFade(nameEntry);
    nameInput.value = '';

    // Place the bucket at the bottom-center of its allowed range
    const bounds = getBucketBounds();
    const startX = (gameArea.clientWidth - bucket.offsetWidth) / 2;
    const startY = bounds.maxY;
    bucket.style.left = `${startX}px`;
    bucket.style.top = `${startY}px`;
    bucket.style.transform = '';
    lastBucketX = startX;
    lastBucketY = startY;
    bucketVX = 0;
    bucketVY = 0;
    bucketTilt = 0;
    bucketTiltVelocity = 0;
    bucketShakeUntil = 0;

    resetFilterState();

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
    document.body.classList.remove('playing');
    startTitleWave(level >= 10);
    startGameOverTitleWave();

    const bpm = computeBucketsPerMinute();

    finalRateText.textContent = `${bpm.toFixed(1)} buckets/min`;

    const collectionRate = cleanDropsSpawned > 0
        ? Math.round((cleanDropsCaught / cleanDropsSpawned) * 100)
        : 0;
    finalDetailsText.textContent = `${bucketsCompleted} buckets · ${formatTime(elapsedMs)} · ${collectionRate}% clean water`;

    renderLeaderboard(gameOverLeaderboardList, loadLeaderboard());

    if (qualifiesForLeaderboard(bpm)) {
        showInstantly(nameEntry);
        launchConfetti(40);
    } else {
        nameEntry.classList.add('hidden');
    }

    playGameOverSound();
    showInstantly(gameOverScreen);
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
    bucketTransitioning = false;
    bucket.classList.remove('entering', 'exiting-success', 'exiting-contaminated', 'exploding');
    clearCrackVisuals();
    resetFilterState();
    livesDisplay.textContent = '💧💧💧';
    levelDisplay.textContent = level;
    bucketsDisplay.textContent = bucketsCompleted;
    timerDisplay.textContent = '0:00';
    bucketFillElement.style.height = '0%';

    gameArea.classList.remove('playing');
    document.body.classList.remove('playing');
    startTitleWave(false);
    hideWithFade(gameOverScreen);
    hideWithFade(pauseScreen);
    showInstantly(startScreen);
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
    document.body.classList.remove('playing');
    startTitleWave(false);
    showInstantly(pauseScreen);
}

// Picks back up right where the game left off
function resumeGame() {
    if (!gameRunning || !gamePaused) {
        return;
    }

    gamePaused = false;
    gameArea.classList.add('playing');
    document.body.classList.add('playing');
    hideWithFade(pauseScreen);
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
    const name = nameInput.value.trim().slice(0, 7) || 'Guest';
    const bpm = computeBucketsPerMinute();
    const updatedEntries = addLeaderboardEntry(name, bpm);

    renderLeaderboard(gameOverLeaderboardList, updatedEntries);
    hideWithFade(nameEntry);
});

// Show whatever scoreboard already exists as soon as the page loads
renderLeaderboard(startLeaderboardList, loadLeaderboard());

// Give every button an elastic click-wobble, no matter where it's added
document.addEventListener('click', function (event) {
    const clickedButton = event.target.closest('button');
    if (!clickedButton) {
        return;
    }

    clickedButton.classList.remove('click-wobble');
    void clickedButton.offsetWidth; // restart the animation even on rapid clicks
    clickedButton.classList.add('click-wobble');

    setTimeout(function () {
        clickedButton.classList.remove('click-wobble');
    }, 1400);
});

// How far the "classic" wave's wavelength has drifted from its original
// 1.8s. It only ever nudges a little each time, never jumps.
let classicWavelengthDrift = 0;

// Rebuilds `element`'s text into per-letter spans. useChaoticVariant picks
// which wave personality plays: the louder per-letter wobble, or the
// gradual even stagger that's the norm the rest of the time, whose
// wavelength drifts a touch further each time instead of resetting to
// exactly 1.8s.
function splitIntoWaveLetters(element, useChaoticVariant) {
    if (!element) {
        return;
    }

    const text = element.textContent;
    element.textContent = '';

    if (!useChaoticVariant) {
        const driftStep = (Math.random() * 0.06) - 0.03;
        classicWavelengthDrift = Math.max(-0.15, Math.min(0.15, classicWavelengthDrift + driftStep));
    }

    for (let i = 0; i < text.length; i++) {
        const letter = text[i];
        const span = document.createElement('span');
        span.className = 'title-letter';
        span.textContent = letter === ' ' ? ' ' : letter;

        if (useChaoticVariant) {
            const baseDelay = i * 0.08;
            const randomJitter = (Math.random() * 0.36) - 0.18;
            const duration = 1.5 + (Math.random() * 1.0);
            const bobHeight = 5 + (Math.random() * 7);

            span.style.animationDelay = `${(baseDelay + randomJitter).toFixed(2)}s`;
            span.style.animationDuration = `${duration.toFixed(2)}s`;
            span.style.setProperty('--bob-height', `${bobHeight.toFixed(1)}px`);
        } else {
            const baseDelay = i * 0.08;
            const smallJitter = (Math.random() * 0.12) - 0.06;
            const duration = 1.8 + classicWavelengthDrift;

            span.style.animationDelay = `${(baseDelay + smallJitter).toFixed(2)}s`;
            span.style.animationDuration = `${duration.toFixed(2)}s`;
            span.style.setProperty('--bob-height', '6px');
        }

        element.appendChild(span);
    }
}

// The header title: useChaoticVariant picks between the louder wobble
// (only used when the player dies on level 10+) and the gradual norm
function startTitleWave(useChaoticVariant) {
    splitIntoWaveLetters(document.getElementById('title'), useChaoticVariant);
}

// The "Game Over" heading always gets the louder, more violent wobble,
// same letters/gradient styling as the header title
function startGameOverTitleWave() {
    splitIntoWaveLetters(document.getElementById('game-over-title'), true);
}

startTitleWave(false);

// Gives each stat its own randomized delay, speed, and bob height so the
// wave across Buckets/Time/Lives/Level reads as organic, not mechanical
function randomizeStatWave() {
    const stats = document.querySelectorAll('#stats-bar .stat');

    for (let i = 0; i < stats.length; i++) {
        const baseDelay = i * 0.15;
        const randomJitter = (Math.random() * 0.3) - 0.15;
        const duration = 1.2 + (Math.random() * 0.8);
        const bobHeight = 7 + (Math.random() * 8);

        stats[i].style.animationDelay = `${(baseDelay + randomJitter).toFixed(2)}s`;
        stats[i].style.animationDuration = `${duration.toFixed(2)}s`;
        stats[i].style.setProperty('--bob-height', `${bobHeight.toFixed(1)}px`);
    }
}

randomizeStatWave();
