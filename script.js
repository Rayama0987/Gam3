// --- ゲーム設定 (定数) ---
const CANVAS = document.getElementById('game-canvas');
const CTX = CANVAS.getContext('2d');
const GAME_WIDTH = CANVAS.width;
const GAME_HEIGHT = CANVAS.height;

const BASE_SCORE_TO_UPGRADE = 10; 
const ENEMY_HEALTH = 10;
const ENEMY_VALUE = 3;
const PLAYER_SPEED_SCALE = 5; 

// --- グローバル状態 (シングルプレイ用) ---
let gameRunning = false;
let isUpgrading = false;
let lastTime = 0; 

let score = 0; 
let totalScoreEarned = 0;
let playerHealth = 5;

// --- プレイヤーと弾丸の設定 ---
const PLAYER = {
    x: GAME_WIDTH / 2,
    y: GAME_HEIGHT - 50,
    size: 20,
    speed: PLAYER_SPEED_SCALE,
    lastShotTime: 0,
    predictedX: GAME_WIDTH / 2, // クライアント予測用
};
let bullets = [];
let enemies = [];
let enemySpawnTimer = 0;

// --- 強化レベル管理 ---
const UPGRADES = {
    fireRate: { level: 1, baseInterval: 400, cost: BASE_SCORE_TO_UPGRADE, label: "連射速度" }, 
    bulletCount: { level: 1, baseCount: 1, cost: BASE_SCORE_TO_UPGRADE, label: "同時弾数" },
    bounce: { level: 0, baseChance: 0.1, cost: BASE_SCORE_TO_UPGRADE, label: "バウンド弾" }, 
    damage: { level: 1, baseDamage: 1, cost: BASE_SCORE_TO_UPGRADE, label: "ダメージアップ" },        
    speed: { level: 1, baseSpeed: 10, cost: BASE_SCORE_TO_UPGRADE, label: "弾丸速度" },             
    radius: { level: 1, baseRadius: 4, cost: BASE_SCORE_TO_UPGRADE, label: "当たり判定拡大" },
    autoAim: { level: 0, baseAimStrength: 0.005, cost: BASE_SCORE_TO_UPGRADE, label: "オートエイム" }
};


// --- 入力状態 ---
let keys = {}; 
let touchInput = { x: null, isDown: false, shoot: false };
let inputState = { left: false, right: false, shoot: false };


// --- YouTube Music Player 関連 ---
let ytPlayer;
let currentVideoId = null;

// YouTube IFrame APIがロードされたときに呼び出される関数
window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('youtube-player', {
        height: '1',
        width: '1',
        videoId: '',
        playerVars: {
            'playsinline': 1,
            'autoplay': 0, 
            'controls': 0, 
            'disablekb': 1, 
            'fs': 0,
            'iv_load_policy': 3,
            'modestbranding': 1,
            'loop': 1, // ループを有効にする
            'playlist': '' // ループのために必要 (onloadで設定)
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerReady(event) {
    console.log("YouTube Player is ready.");
    const statusElement = document.getElementById('music-status');
    if (currentVideoId) {
        // ループ再生のためにplaylistを設定
        event.target.cueVideoById({
             videoId: currentVideoId,
             playlist: currentVideoId
        });
        statusElement.textContent = 'ステータス: ロード完了。ゲーム開始で再生されます。';
    } else {
        statusElement.textContent = 'ステータス: 準備完了。URLを入力してください。';
    }
}

function onPlayerStateChange(event) {
    const statusElement = document.getElementById('music-status');
    if (!statusElement) return;

    switch (event.data) {
        case YT.PlayerState.PLAYING:
            statusElement.textContent = 'ステータス: 再生中 🔊';
            break;
        case YT.PlayerState.PAUSED:
            statusElement.textContent = 'ステータス: 一時停止';
            break;
        case YT.PlayerState.ENDED:
            // API側でループ設定済みのため、ここでは何もしない
            break;
        case YT.PlayerState.BUFFERING:
            statusElement.textContent = 'ステータス: ロード中...';
            break;
        case YT.PlayerState.CUED:
            statusElement.textContent = 'ステータス: ロード完了。';
            break;
    }
}

/**
 * YouTube URL または Video ID から ID を抽出
 */
function extractVideoId(url) {
    if (!url) return null;
    
    if (url.length === 11 && !url.includes('/')) {
        return url;
    }
    
    let match = url.match(/(?:\?v=|\/embed\/|\/v\/|youtu\.be\/|\/shorts\/)([^"&?\/\s]{11})/);
    if (match) {
        return match[1];
    }
    return null;
}

/**
 * 音楽をロードする (UIボタンから呼び出される)
 */
window.loadAndPlayMusic = function() {
    const url = document.getElementById('youtube-url').value;
    const videoId = extractVideoId(url);
    const statusElement = document.getElementById('music-status');

    if (!videoId) {
        statusElement.textContent = 'ステータス: 無効なURLまたはIDです。';
        currentVideoId = null;
        return;
    }
    
    currentVideoId = videoId;
    statusElement.textContent = 'ステータス: ロード中...';

    if (ytPlayer && ytPlayer.loadVideoById) {
        // ロードと同時にループ再生設定
        ytPlayer.loadVideoById({
             videoId: videoId,
             playlist: videoId // ループのために必要
        });
    } else {
        statusElement.textContent = 'ステータス: プレイヤーAPIがまだ準備できていません。';
    }
}


// --- イベントリスナー (入力) ---
document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') {
        e.preventDefault(); 
    }
});
document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

CANVAS.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
        const rect = CANVAS.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        
        touchInput.shoot = true; 
        touchInput.isDown = true;
        touchInput.x = touchX * (GAME_WIDTH / rect.width); 
    }
}, { passive: false });

CANVAS.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touchInput.isDown && e.touches.length > 0) {
        const rect = CANVAS.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        touchInput.x = touchX * (GAME_WIDTH / rect.width); 
    }
}, { passive: false });

CANVAS.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
        touchInput.isDown = false;
        touchInput.shoot = false; 
        touchInput.x = null;
    }
});

// --- ユーティリティ関数 ---
function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * ゲーム状態をlocalStorageに保存
 */
function saveGame() {
    const saveData = {
        x: PLAYER.x,
        health: playerHealth,
        score: score,
        totalScoreEarned: totalScoreEarned,
        upgrades: UPGRADES
    };

    try {
        localStorage.setItem('shooterGameSave', JSON.stringify(saveData));
        console.log("ゲーム状態を保存しました。");
        return true;
    } catch (e) {
        console.error("ゲームの保存に失敗しました。", e);
        return false;
    }
}

/**
 * localStorageからゲーム状態をロード
 */
function loadGame() {
    const savedData = localStorage.getItem('shooterGameSave');
    if (!savedData) return false;

    try {
        const data = JSON.parse(savedData);
        
        PLAYER.x = data.x || PLAYER.x;
        PLAYER.predictedX = PLAYER.x;
        playerHealth = data.health || playerHealth;
        score = data.score || score;
        totalScoreEarned = data.totalScoreEarned || totalScoreEarned;
        
        Object.keys(UPGRADES).forEach(key => {
             if (data.upgrades[key]) {
                 UPGRADES[key].level = data.upgrades[key].level;
             }
        });
        
        console.log("ゲーム状態をロードしました。");
        return true;
    } catch (e) {
        console.error("ゲームのロードに失敗しました。", e);
        return false;
    }
}

// --- ゲームロジック (サーバー側の役割も果たす) ---

function spawnEnemy(yOffset = 0) { 
    enemies.push({
        x: Math.random() * (GAME_WIDTH - 40) + 20,
        y: -15 - yOffset, 
        size: 30, 
        speed: 1.5, 
        health: ENEMY_HEALTH,
    });
}

function shoot() {
    const bulletCount = UPGRADES.bulletCount.level;
    const bulletSpeed = UPGRADES.speed.baseSpeed * UPGRADES.speed.level;
    const bulletRadius = UPGRADES.radius.baseRadius;
    const bulletDamage = UPGRADES.damage.baseDamage * UPGRADES.damage.level;
    const isAutoAim = UPGRADES.autoAim.level > 0;
    const isBounce = UPGRADES.bounce.level > 0 && Math.random() < UPGRADES.bounce.baseChance * UPGRADES.bounce.level;

    for (let i = 0; i < bulletCount; i++) {
        const offset = (i - (bulletCount - 1) / 2) * 5; 
        
        bullets.push({
            x: PLAYER.x + offset, 
            y: PLAYER.y - PLAYER.size / 2, 
            radius: bulletRadius, 
            speed: bulletSpeed,
            damage: bulletDamage,
            isAim: isAutoAim,
            isBounce: isBounce,
            velX: 0, velY: -bulletSpeed // バウンド弾用の初期速度
        });
    }
}

function checkCollisions() {
    // 敵と弾丸の衝突判定
    enemies.forEach(enemy => {
        bullets = bullets.filter(bullet => {
            if (distance(enemy.x, enemy.y, bullet.x, bullet.y) < enemy.size / 2 + bullet.radius) {
                enemy.health -= bullet.damage;
                return false; // 弾丸を削除
            }
            return true; 
        });

        if (enemy.health <= 0) {
            score += ENEMY_VALUE;
            totalScoreEarned += ENEMY_VALUE;
        }
    });

    enemies = enemies.filter(enemy => enemy.health > 0);
}

function applyUpgrade(type) {
    const upgrade = UPGRADES[type];
    if (upgrade) {
        upgrade.level++;
    }
}

function updateGame(deltaTime) {
    if (!gameRunning || isUpgrading) return;

    // プレイヤーの移動
    if (inputState.left && PLAYER.x > PLAYER.size / 2) {
        PLAYER.predictedX -= PLAYER.speed * (deltaTime / 16);
    }
    if (inputState.right && PLAYER.x < GAME_WIDTH - PLAYER.size / 2) {
        PLAYER.predictedX += PLAYER.speed * (deltaTime / 16);
    }
    PLAYER.predictedX = Math.max(PLAYER.size / 2, Math.min(GAME_WIDTH - PLAYER.size / 2, PLAYER.predictedX));
    PLAYER.x = PLAYER.predictedX;

    // プレイヤーの発射
    const now = Date.now();
    const fireInterval = UPGRADES.fireRate.baseInterval / UPGRADES.fireRate.level; 
    
    if (inputState.shoot && (now - PLAYER.lastShotTime > fireInterval)) {
        shoot();
        PLAYER.lastShotTime = now;
    }

    // 弾丸の更新
    bullets = bullets.filter(bullet => {
        // バウンド弾のロジックは省略（必要であれば実装）
        // if (bullet.isAim) { autoAim(bullet); }
        // if (bullet.isBounce) { updateBounce(bullet); } else { ... }
        
        bullet.y -= bullet.speed * (deltaTime / 16); 
        
        return bullet.y > 0 && bullet.x > 0 && bullet.x < GAME_WIDTH && bullet.y < GAME_HEIGHT; 
    });

    // 敵の出現
    enemySpawnTimer += deltaTime;
    if (enemySpawnTimer > 1000 && enemies.length < 10) { 
        spawnEnemy();
        enemySpawnTimer = 0;
    }
    
    // 敵の移動
    enemies.forEach(enemy => {
        enemy.y += enemy.speed * (deltaTime / 16);
    });
    
    // 衝突判定
    checkCollisions();

    // 画面下端に達した敵の処理
    enemies = enemies.filter(enemy => {
        if (enemy.y < GAME_HEIGHT + enemy.size / 2) {
            return true;
        } else {
            playerHealth--;
            return false;
        }
    });
    
    // ゲームオーバー判定
    if (playerHealth <= 0) {
        gameOver();
        return;
    }
    
    // 強化画面判定
    if (!isUpgrading && playerHealth > 0 && score >= BASE_SCORE_TO_UPGRADE) {
        enterUpgradeScreen();
    }
}


// --- 描画処理 ---
function draw() { 
    CTX.fillStyle = '#000';
    CTX.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // プレイヤーの描画
    CTX.fillStyle = 'lime';
    CTX.fillRect(PLAYER.x - PLAYER.size / 2, PLAYER.y - PLAYER.size / 2, PLAYER.size, PLAYER.size);
    
    // 弾丸の描画
    bullets.forEach(bullet => {
        CTX.fillStyle = 'lime'; 
        CTX.beginPath();
        CTX.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        CTX.fill();
    });

    // 敵の描画
    enemies.forEach(enemy => {
        CTX.fillStyle = 'red';
        CTX.fillRect(enemy.x - enemy.size / 2, enemy.y - enemy.size / 2, enemy.size, enemy.size);
        const healthRatio = enemy.health / ENEMY_HEALTH;
        CTX.fillStyle = 'green';
        CTX.fillRect(enemy.x - enemy.size / 2, enemy.y - enemy.size / 2 - 10, enemy.size * healthRatio, 5);
    });

    updateHUD();
}

function collectInputState() {
    inputState.left = keys['KeyA'] || keys['ArrowLeft'] || false;
    inputState.right = keys['KeyD'] || keys['ArrowRight'] || false;
    inputState.shoot = keys['Space'] || touchInput.shoot || false;
    
    // タッチ入力による移動
    if (touchInput.isDown && touchInput.x !== null) {
        if (touchInput.x < PLAYER.predictedX - PLAYER.size * 2) {
            inputState.left = true;
            inputState.right = false;
        } else if (touchInput.x > PLAYER.predictedX + PLAYER.size * 2) {
            inputState.right = true;
            inputState.left = false;
        } else {
             inputState.left = false;
             inputState.right = false;
        }
    }
}


// --- 画面/UI管理関数 ---

function updateHUD() {
    document.getElementById('health-display').textContent = playerHealth;
    document.getElementById('score-display').textContent = Math.floor(score);
    document.getElementById('upgrade-score').textContent = Math.floor(score);
    
    // 強化レベルの更新
    document.getElementById('lv-fireRate').textContent = UPGRADES.fireRate.level;
    document.getElementById('lv-bulletCount').textContent = UPGRADES.bulletCount.level;
    document.getElementById('lv-bounce').textContent = UPGRADES.bounce.level;
    document.getElementById('lv-damage').textContent = UPGRADES.damage.level;
    document.getElementById('lv-speed').textContent = UPGRADES.speed.level;
    document.getElementById('lv-radius').textContent = UPGRADES.radius.level;
    document.getElementById('lv-autoAim').textContent = UPGRADES.autoAim.level; 
    
    const hasSaveData = localStorage.getItem('shooterGameSave') !== null;
    document.getElementById('load-game-button').style.display = hasSaveData ? 'inline-block' : 'none';
}

function gameOver() {
    gameRunning = false;
    saveGame();
    
    // 音楽を停止
    if (ytPlayer && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }

    document.getElementById('final-score').textContent = Math.floor(totalScoreEarned); 
    document.getElementById('game-over-screen').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
}

function enterUpgradeScreen() {
    if (isUpgrading) return; 

    isUpgrading = true;
    
    document.getElementById('upgrade-screen').style.display = 'flex';
    document.getElementById('upgrade-message').textContent = `強化中... (強化コスト: ${BASE_SCORE_TO_UPGRADE})`;
}

window.applyUpgrade = function(type) {
    if (isUpgrading) {
        if (score < BASE_SCORE_TO_UPGRADE) {
            document.getElementById('upgrade-message').textContent = 'スコアが不足しています。（必要: 10）';
            return;
        }

        score -= BASE_SCORE_TO_UPGRADE; 
        applyUpgrade(type);
        
        if (score < BASE_SCORE_TO_UPGRADE) {
            isUpgrading = false;
            document.getElementById('upgrade-screen').style.display = 'none';
        } else {
             enterUpgradeScreen();
        }
        
        updateHUD();
    }
};

window.startGame = function(load = false) { 
    // 音楽の再生
    if (ytPlayer && currentVideoId) {
        // 再生が開始されない場合は、一度停止してから再生を試みる
        if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
             ytPlayer.setVolume(20); 
             ytPlayer.playVideo();
        }
    }
    
    if (!load) {
        score = 0;
        playerHealth = 5;
        totalScoreEarned = 0;
        bullets = [];
        enemies = [];
        PLAYER.x = GAME_WIDTH / 2;
        PLAYER.predictedX = PLAYER.x;
        PLAYER.lastShotTime = 0;
        
        // 強化レベルをリセット
        Object.keys(UPGRADES).forEach(key => {
            UPGRADES[key].level = key === 'bounce' || key === 'autoAim' ? 0 : 1;
        });
    } else {
        loadGame();
    }
    
    gameRunning = true;
    isUpgrading = false;
    
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('upgrade-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    
    if (enemies.length === 0) { 
        spawnEnemy(0); 
    }
};

window.exitGame = function() { 
    if (!gameRunning) {
        window.showLobby();
        return;
    }
    
    const confirmExit = confirm(`ゲームを終了してロビーに戻りますか？\n（現在の進行状況は自動保存されます）`);
    
    if (confirmExit) {
        saveGame(); 
        gameRunning = false;
        isUpgrading = false;
        window.showLobby(); 
    }
}

window.showLobby = function() { 
    gameRunning = false;
    isUpgrading = false;
    
    // 音楽を停止
    if (ytPlayer && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }

    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('upgrade-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'none';

    updateHUD(); // ロードボタンの表示を更新
};


// --- メインゲームループ ---
function gameLoop(currentTime) { 
    if (lastTime === 0) {
        lastTime = currentTime;
    }
    
    let deltaTime = currentTime - lastTime;
    if (deltaTime > 250) {
        deltaTime = 250; 
    }
    lastTime = currentTime;

    if (gameRunning) {
        collectInputState();
        updateGame(deltaTime);
        draw();
    } else {
        updateHUD(); 
    }

    requestAnimationFrame(gameLoop);
}

// --- 初期化処理 ---
window.onload = function() {
    window.showLobby();
    requestAnimationFrame(gameLoop); 
};
