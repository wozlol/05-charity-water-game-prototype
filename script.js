// Bucket Master: catch clean water drops, avoid dirty drops and oil slicks.

// Grab the elements we need to update while the game runs
const gameArea = document.getElementById('game-area');
const bucket = document.getElementById('bucket');
const scoreDisplay = document.getElementById('score-display');
const livesDisplay = document.getElementById('lives-display');
const levelDisplay = document.getElementById('level-display');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreText = document.getElementById('final-score');
const collectionRateText = document.getElementById('collection-rate');
const highScoreMessage = document.getElementById('high-score-message');
const startBtn = document.getElementById('start-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const resetBtn = document.getElementById('reset-btn');
const leftBtn = document.getElementById('left-btn');
const rightBtn = document.getElementById('right-btn');
const confettiLayer = document.getElementById('confetti-layer');

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

let spawnTimerId = null;
let gameLoopId = null;

// Move the bucket left or right by a number of pixels, staying inside the game area
function moveBucket(deltaX) {
    if (bucketJammed) {
        return;
    }

    const areaWidth = gameArea.clientWidth;
    const bucketWidth = bucket.offsetWidth;
    const currentLeft = bucket.offsetLeft;
    let newLeft = currentLeft + deltaX;

    // Clamp the bucket so it never moves outside the game area
    if (newLeft < 0 || newLeft > areaWidth - bucketWidth) {
        newLeft = Math.max(0, Math.min(newLeft, areaWidth - bucketWidth));
    }

    bucket.style.left = `${newLeft}px`;
    bucket.style.transform = 'none';
}

// Keyboard controls
document.addEventListener('keydown', function (event) {
    if (!gameRunning) {
        return;
    }

    if (event.key === 'ArrowLeft') {
        moveBucket(-20);
    } else if (event.key === 'ArrowRight') {
        moveBucket(20);
    }
});

// On-screen buttons, handy for mouse clicks or tapping on mobile
leftBtn.addEventListener('click', function () {
    moveBucket(-30);
});

rightBtn.addEventListener('click', function () {
    moveBucket(30);
});

// Touch dragging: the bucket follows the finger directly
gameArea.addEventListener('touchmove', function (event) {
    if (!gameRunning || bucketJammed) {
        return;
    }

    event.preventDefault();
    const touch = event.touches[0];
    const areaRect = gameArea.getBoundingClientRect();
    const bucketWidth = bucket.offsetWidth;
    let newLeft = touch.clientX - areaRect.left - (bucketWidth / 2);
    newLeft = Math.max(0, Math.min(newLeft, areaRect.width - bucketWidth));

    bucket.style.left = `${newLeft}px`;
    bucket.style.transform = 'none';
});

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

// Briefly jam the bucket after it hits an obstacle
function jamBucket() {
    bucketJammed = true;
    bucket.classList.add('jammed');

    setTimeout(function () {
        bucketJammed = false;
        bucket.classList.remove('jammed');
    }, 1000);
}

// Update the score and level, speeding up the game as the player improves
function addScore(points) {
    score = score + points;
    scoreDisplay.textContent = score;

    if (score >= nextLevelScore) {
        level = level + 1;
        levelDisplay.textContent = level;
        nextLevelScore = nextLevelScore + 10;
        dropSpeed = dropSpeed + 0.5;
        spawnDelay = Math.max(500, spawnDelay - 80);
        restartSpawnTimer();
        launchConfetti(18);
    }
}

// Lose a life, and end the game if none are left
function loseLife() {
    lives = lives - 1;
    livesDisplay.textContent = '💧'.repeat(Math.max(lives, 0));

    if (lives <= 0) {
        endGame();
    }
}

// Move every active drop down, and check for catches or misses
function gameLoop() {
    const bucketRect = bucket.getBoundingClientRect();

    for (let i = activeDrops.length - 1; i >= 0; i--) {
        const dropInfo = activeDrops[i];
        const dropElement = dropInfo.element;
        const currentTop = parseFloat(dropElement.style.top);
        dropElement.style.top = `${currentTop + dropSpeed}px`;

        const dropRect = dropElement.getBoundingClientRect();

        if (isColliding(dropRect, bucketRect)) {
            handleCatch(dropInfo);
            activeDrops.splice(i, 1);
        } else if (dropRect.top > gameArea.getBoundingClientRect().bottom) {
            // The drop fell past the bucket without being caught
            dropElement.remove();
            activeDrops.splice(i, 1);
        }
    }
}

// Decide what happens when the bucket touches a drop
function handleCatch(dropInfo) {
    dropInfo.element.remove();

    if (dropInfo.type === 'clean') {
        cleanDropsCaught = cleanDropsCaught + 1;
        addScore(1);
    } else if (dropInfo.type === 'dirty') {
        loseLife();
    } else if (dropInfo.type === 'obstacle') {
        loseLife();
        jamBucket();
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

// Start a brand new game
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

    scoreDisplay.textContent = score;
    livesDisplay.textContent = '💧💧💧';
    levelDisplay.textContent = level;

    clearDrops();
    bucket.classList.remove('jammed');
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    restartSpawnTimer();
    gameLoopId = setInterval(gameLoop, 20);
}

// Stop the game and show the final stats
function endGame() {
    gameRunning = false;
    clearInterval(spawnTimerId);
    clearInterval(gameLoopId);
    clearDrops();

    finalScoreText.textContent = `Final score: ${score}`;

    const collectionRate = cleanDropsSpawned > 0
        ? Math.round((cleanDropsCaught / cleanDropsSpawned) * 100)
        : 0;
    collectionRateText.textContent = `Clean water collected: ${collectionRate}%`;

    const storedHighScore = Number(localStorage.getItem('bucketMasterHighScore')) || 0;

    if (score > storedHighScore) {
        localStorage.setItem('bucketMasterHighScore', score);
        highScoreMessage.textContent = 'New high score!';
        launchConfetti(40);
    } else {
        highScoreMessage.textContent = `High score: ${storedHighScore}`;
    }

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
    scoreDisplay.textContent = score;
    livesDisplay.textContent = '💧💧💧';
    levelDisplay.textContent = level;

    gameOverScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
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
