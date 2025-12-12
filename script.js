// --- ゲーム設定 (定数) ---
const CANVAS = document.getElementById('game-canvas');
const CTX = CANVAS.getContext('2d');
const GAME_WIDTH = CANVAS.width;
const GAME_HEIGHT = CANVAS.height;

const BASE_SCORE_TO_UPGRADE = 10; 
const ENEMY_HEALTH = 10;
const ENEMY_VALUE = 3;
const BASE_ENEMY_SIZE = 30;
const MOBILE_ENEMY_SCALE = 1.5;

// --- グローバル状態 ---
let gameRunning = false;
let isUpgrading = false;
let isMobileSession = false; 
let isMultiplayer = false; 
let lastTime = 0; 
let localPlayerId = 0; 

// ★ゲーム状態全体を管理する単一オブジェクト
let gameState = {
    players: [],
    enemies: [],
    enemiesKilled: 0
};

// --- プレイヤーと操作キー (1端末につき1プレイヤー) ---
const PLAYER_COLORS = ['lime', 'cyan', 'red', 'yellow']; 
const STANDARD_KEYS = { LEFT: 'KeyA', RIGHT: 'KeyD', SHOOT: 'Space' }; 

let keys = {}; // 現在押されているキー

// プレイヤーの基本構造 
function createPlayer(id, color) {
    const baseCost = BASE_SCORE_TO_UPGRADE;
    return {
        id: id,
        color: color,
        x: GAME_WIDTH / (PLAYER_COLORS.length + 1) * (id + 1), 
        y: GAME_HEIGHT - 50,
        size: 20,
        speed: 5,
        health: 5,
        score: 0, 
        totalScoreEarned: 0, 
        lastShotTime: 0,
        bullets: [],
        upgrades: {
            fireRate: { level: 1, baseInterval: 400, cost: baseCost, label: "連射速度" }, 
            bulletCount: { level: 1, baseCount: 1, cost: baseCost, label: "同時弾数" },
            bounce: { level: 0, baseChance: 0.1, cost: baseCost, label: "バウンド弾" }, 
            damage: { level: 1, baseDamage: 1, cost: baseCost, label: "ダメージアップ" },        
            speed: { level: 1, baseSpeed: 10, cost: baseCost, label: "弾丸速度" },             
            radius: { level: 1, baseRadius: 4, cost: baseCost, label: "当たり判定拡大" },
            autoAim: { level: 0, baseAimStrength: 0.005, cost: baseCost, label: "オートエイム" }
        },
        input: { left: false, right: false, shoot: false } 
    };
}


// --- イベントリスナー (キー入力、タッチ入力) ---
document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === STANDARD_KEYS.SHOOT) {
        e.preventDefault(); 
    }
});
document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

let isTouching = false; 
let touchX = GAME_WIDTH / 2; 

CANVAS.addEventListener('touchstart', (e) => {
    e.preventDefault(); 
    isMobileSession = true; 
    isTouching = true;
    if (e.touches.length > 0) {
        const rect = CANVAS.getBoundingClientRect();
        const scaleX = CANVAS.width / rect.width; 
        touchX = (e.touches[0].clientX - rect.left) * scaleX;
    }
}, { passive: false });

CANVAS.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
        const rect = CANVAS.getBoundingClientRect();
        const scaleX = CANVAS.width / rect.width;
        touchX = (e.touches[0].clientX - rect.left) * scaleX;
    }
}, { passive: false });

CANVAS.addEventListener('touchend', (e) => {
    isTouching = false;
}, { passive: false });


// --- ユーティリティ関数 ---
function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
function getTotalUpgradeLevel(player) {
    let total = 0;
    for (const key in player.upgrades) {
        total += player.upgrades[key].level || 0;
    }
    return total - 5; 
}


// --- ネットワーク層のシミュレーション ---
const Networking = {
    isConnected: false,
    isHost: false,
    latency: 50, 
    inputQueue: [], 
    serverStateQueue: [],

    connect: function(isHost) {
        this.isConnected = true;
        this.isHost = isHost;
        console.log(`[NETWORKING] ${isHost ? 'ホスト' : 'クライアント'}として接続をシミュレート...`);
    },

    sendInput: function(input) {
        if (!this.isConnected) return;
        
        if (this.isHost) {
            this.inputQueue.push({ playerId: localPlayerId, input: input });
        } else {
             // 実際のオンラインではサーバーに送る
        }
    },

    receiveState: function(state) {
        setTimeout(() => {
            gameState = state;
            
            const player = gameState.players.find(p => p.id === localPlayerId);
            if(player){
                if (!isUpgrading && player.health > 0 && player.score >= BASE_SCORE_TO_UPGRADE) {
                    enterUpgradeScreen(player.id);
                }
            }
        }, this.latency);
    },

    simulateServerTick: function(deltaTime) {
        if (!this.isHost || !gameRunning || isUpgrading) return;
        
        // 1. 全プレイヤーの入力を適用
        this.inputQueue.forEach(packet => {
            const player = gameState.players.find(p => p.id === packet.playerId);
            if (player) {
                if (packet.input.upgraded) {
                    // 強化イベント処理 (簡略化)
                } else {
                    player.input = packet.input;
                }
            }
        });
        this.inputQueue = []; 

        // 2. サーバー側でのロジック更新 (ゲーム状態を更新)
        
        const activePlayers = gameState.players.filter(p => p.health > 0);
        
        activePlayers.forEach(player => {
            // 移動 (サーバー側で処理)
            if (player.input.left && player.x > player.size / 2) {
                player.x -= player.speed * (deltaTime / 16);
            }
            if (player.input.right && player.x < GAME_WIDTH - player.size / 2) {
                player.x += player.speed * (deltaTime / 16);
            }

            // 発射 (サーバー側で処理)
            const now = Date.now();
            const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
            
            if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
                serverShoot(player);
                player.lastShotTime = now;
            }

            // 弾丸の移動
            player.bullets = player.bullets.filter(bullet => {
                if (!bullet.isBounce) {
                    bullet.y -= bullet.speed * (deltaTime / 16); 
                } else {
                    bullet.x += bullet.velX * (deltaTime / 16);
                    bullet.y += bullet.velY * (deltaTime / 16);
                }
                return bullet.y > 0 && bullet.x > 0 && bullet.x < GAME_WIDTH; 
            });
        });
        
        // 敵の出現、移動、衝突判定、ダメージ処理 (省略)
        if (gameState.enemiesKilled % 100 === 0 && gameState.enemies.length === 0) {
            serverSpawnEnemy(0);
        }
        
        gameState.enemies.forEach(enemy => {
            enemy.y += enemy.speed * (deltaTime / 16);
        });
        
        serverCheckCollisions();

        gameState.enemies = gameState.enemies.filter(enemy => {
            if (enemy.y < GAME_HEIGHT + enemy.size / 2) {
                return true;
            } else {
                const alivePlayers = gameState.players.filter(p => p.health > 0);
                if (alivePlayers.length > 0) {
                    let lowestHealthPlayer = alivePlayers.reduce((minP, currentP) => 
                        (currentP.health < minP.health) ? currentP : minP
                    );
                    lowestHealthPlayer.health--;
                }
                return false;
            }
        });
        
        if (gameState.players.filter(p => p.health > 0).length === 0) {
            gameOver();
            return;
        }

        // 3. 状態を他のクライアントにブロードキャスト（シミュレーション）
        this.serverStateQueue.forEach((id) => {
             if (id !== localPlayerId) {
                Networking.receiveState(JSON.parse(JSON.stringify(gameState)));
             }
        });

        // 4. ローカルにも状態を反映
        Networking.receiveState(gameState); 
    }
};

// --- ホスト/サーバー側のゲームロジック (シングルプレイでも使用) ---
function serverShoot(player) {
    const { upgrades } = player;
    const count = upgrades.bulletCount.level;
    const currentSpeed = upgrades.speed.baseSpeed * upgrades.speed.level;
    const currentDamage = upgrades.damage.baseDamage * upgrades.damage.level;
    const currentRadius = upgrades.radius.baseRadius * upgrades.radius.level;
    
    for (let i = 0; i < count; i++) {
        player.bullets.push({
            x: player.x,
            y: player.y,
            radius: currentRadius,
            speed: currentSpeed,
            damage: currentDamage,
            velX: 0, 
            velY: -currentSpeed, 
            isBounce: false,
            isAim: false,
            ownerId: player.id 
        });
    }
}

function serverCheckCollisions() {
    const finalEnemyValue = ENEMY_VALUE; 

    gameState.enemies.forEach(enemy => {
        gameState.players.forEach(player => {
            player.bullets.forEach(bullet => {
                if (distance(bullet.x, bullet.y, enemy.x, enemy.y) < enemy.size / 2 + bullet.radius) {
                    enemy.health -= bullet.damage;
                    bullet.hit = true;
                    enemy.lastHitBulletOwnerId = player.id; 
                }
            });
        });
    });

    gameState.enemies = gameState.enemies.filter(enemy => {
        if (enemy.health <= 0) {
            const killerId = enemy.lastHitBulletOwnerId;
            if (killerId !== undefined) {
                gameState.players.forEach(p => {
                    let scoreMultiplier = (p.id === killerId) ? 1.0 : 0.5; 
                    const earnedScore = finalEnemyValue * scoreMultiplier;
                    p.score += earnedScore;
                    p.totalScoreEarned += earnedScore; 
                });
            }
            gameState.enemiesKilled++; 
            return false;
        }
        return true;
    });
    
    gameState.players.forEach(player => {
        player.bullets = player.bullets.filter(bullet => !bullet.hit);
    });
}

function serverSpawnEnemy(yOffset = 0) {
    gameState.enemies.push({
        x: Math.random() * (GAME_WIDTH - 40) + 20,
        y: -15 - yOffset, 
        size: 30, 
        speed: 1.5, 
        health: ENEMY_HEALTH,
        lastHitBulletOwnerId: undefined 
    });
}


// --- クライアント側の描画と入力処理 ---

function draw() {
    CTX.fillStyle = '#000';
    CTX.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    gameState.players.forEach(player => {
        if (player.health <= 0) return;
        CTX.fillStyle = player.color;
        CTX.fillRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size);
    });

    gameState.players.forEach(player => {
        player.bullets.forEach(bullet => {
            CTX.fillStyle = player.color; 
            CTX.beginPath();
            CTX.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
            CTX.fill();
        });
    });

    gameState.enemies.forEach(enemy => {
        CTX.fillStyle = 'red';
        CTX.fillRect(enemy.x - enemy.size / 2, enemy.y - enemy.size / 2, enemy.size, enemy.size);
        const healthRatio = enemy.health / ENEMY_HEALTH;
        CTX.fillStyle = 'green';
        CTX.fillRect(enemy.x - enemy.size / 2, enemy.y - enemy.size / 2 - 10, enemy.size * healthRatio, 5);
    });

    updateHUD();
}

function collectAndSendInput() {
    if (!gameRunning || isUpgrading || localPlayerId === undefined) return;
    
    const playerKeys = STANDARD_KEYS; 
    
    let inputState = {
        left: keys[playerKeys.LEFT] || false,
        right: keys[playerKeys.RIGHT] || false,
        shoot: keys[playerKeys.SHOOT] || false
    };
    
    // モバイルタッチ操作
    if (isMobileSession) {
        inputState.shoot = isTouching;
        
        const player = gameState.players.find(p => p.id === localPlayerId);
        if (player && isTouching) {
            const center = player.x;
            const threshold = 10;
            if (touchX < center - threshold) {
                inputState.left = true;
                inputState.right = false;
            } else if (touchX > center + threshold) {
                inputState.left = false;
                inputState.right = true;
            } else {
                inputState.left = false;
                inputState.right = false;
            }
        }
    }

    if (isMultiplayer) {
         Networking.sendInput(inputState);
    } else {
         // シングルプレイ時: ローカルのプレイヤーに入力を直接適用
         const player = gameState.players[0];
         if (player) {
             player.input = inputState;
         }
    }
}


// --- シングルプレイ用のゲームロジック (ローカルで全て処理) ---
function localGameTick(deltaTime) {
    if (isMultiplayer || !gameRunning || isUpgrading) return;
    
    const player = gameState.players[0];
    if (!player || player.health <= 0) return;

    // 1. 移動
    if (player.input.left && player.x > player.size / 2) {
        player.x -= player.speed * (deltaTime / 16);
    }
    if (player.input.right && player.x < GAME_WIDTH - player.size / 2) {
        player.x += player.speed * (deltaTime / 16);
    }

    // 2. 発射
    const now = Date.now();
    const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
    
    if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
        serverShoot(player);
        player.lastShotTime = now;
    }

    // 3. 弾丸の移動
    player.bullets = player.bullets.filter(bullet => {
        if (!bullet.isBounce) {
            bullet.y -= bullet.speed * (deltaTime / 16); 
        } else {
            bullet.x += bullet.velX * (deltaTime / 16);
            bullet.y += bullet.velY * (deltaTime / 16);
        }
        return bullet.y > 0 && bullet.x > 0 && bullet.x < GAME_WIDTH; 
    });

    // 4. 敵の出現、移動、衝突、ダメージ、スコア
    if (gameState.enemiesKilled % 100 === 0 && gameState.enemies.length === 0) {
        serverSpawnEnemy(0);
    }
    
    gameState.enemies.forEach(enemy => {
        enemy.y += enemy.speed * (deltaTime / 16);
    });
    
    serverCheckCollisions(); 

    gameState.enemies = gameState.enemies.filter(enemy => {
        if (enemy.y < GAME_HEIGHT + enemy.size / 2) {
            return true;
        } else {
            player.health--;
            return false;
        }
    });

    if (player.health <= 0) {
        gameOver();
        return;
    }

    // 5. 強化画面のトリガー
    if (!isUpgrading && player.score >= BASE_SCORE_TO_UPGRADE) {
        enterUpgradeScreen(player.id);
    }
}


// --- ゲームオーバー処理と強化画面 ---

function updateHUD() {
    const container = document.getElementById('player-stats-container');
    container.innerHTML = '';
    
    gameState.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-info';
        let statusColor = player.health <= 0 ? 'gray' : player.color;
        const playerLabel = isMultiplayer ? `P${player.id + 1} (${player.color})` : `プレイヤー`;

        playerDiv.innerHTML = `
            <span style="color: ${statusColor}; font-weight: bold;">${playerLabel}</span>
            <span style="color: ${statusColor};">スコア: ${Math.floor(player.score)}</span>
            <span style="color: ${statusColor};">体力: ${player.health}</span>
        `;
        container.appendChild(playerDiv);
    });
}

function gameOver() {
    gameRunning = false;
    const finalScore = gameState.players.reduce((maxScore, p) => 
        Math.max(maxScore, Math.floor(p.totalScoreEarned)) 
    , 0);
    
    document.getElementById('final-score').textContent = finalScore; 
    document.getElementById('game-over-screen').style.display = 'flex';
}

let currentUpgradePlayerId = 0;

function enterUpgradeScreen(playerId) {
    if (isUpgrading) return; 

    isUpgrading = true;
    currentUpgradePlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);

    document.getElementById('upgrade-score').textContent = Math.floor(player.score);
    
    const container = document.getElementById('upgrade-buttons-container');
    container.innerHTML = ''; 

    for (const type in player.upgrades) {
        const upgrade = player.upgrades[type];
        const button = document.createElement('button');
        button.className = 'upgrade-button';
        button.setAttribute('onclick', `window.applyUpgrade('${type}')`);
        
        button.innerHTML = `${upgrade.label} (現在のLv: ${upgrade.level})`;
        container.appendChild(button);
        
        if (Object.keys(player.upgrades).indexOf(type) % 3 === 2) {
             container.appendChild(document.createElement('br'));
        }
    }
    
    if (isMultiplayer) {
        const recoverButton = document.createElement('button');
        recoverButton.className = 'upgrade-button';
        recoverButton.style.backgroundColor = '#90ee90';
        recoverButton.setAttribute('onclick', `window.applyUpgrade('healthRecover')`);
        recoverButton.innerHTML = '体力回復 (コスト: 10 / 最も低い味方を回復)';
        container.appendChild(document.createElement('br'));
        container.appendChild(recoverButton);
    }


    document.getElementById('upgrade-screen').style.display = 'flex';
    document.getElementById('upgrade-message').textContent = `P${playerId + 1} (${player.color})が強化中... (強化コスト: ${BASE_SCORE_TO_UPGRADE})`;
}

window.applyUpgrade = function(type) {
    const playerId = currentUpgradePlayerId;
    const player = gameState.players.find(p => p.id === playerId);
    
    if (isUpgrading) {
        if (player.score < BASE_SCORE_TO_UPGRADE) {
            document.getElementById('upgrade-message').textContent = 'スコアが不足しています。（必要: 10）';
            return;
        }

        player.score -= BASE_SCORE_TO_UPGRADE; 

        if (type === 'healthRecover') {
            const maxHealth = 5; 
            const targetPlayer = gameState.players.filter(p => p.health > 0 && p.health < maxHealth)
                .reduce((minP, currentP) => 
                    (currentP.health < minP.health) ? currentP : minP
                , { health: maxHealth, id: undefined }); 

            if (targetPlayer.id !== undefined) {
                 targetPlayer.health++;
            }
            
            isUpgrading = false;
            document.getElementById('upgrade-screen').style.display = 'none';

        } else {
            const upgrade = player.upgrades[type];
            upgrade.level++;
            
            enterUpgradeScreen(playerId); 
            
            if (player.score < BASE_SCORE_TO_UPGRADE) {
                isUpgrading = false;
                document.getElementById('upgrade-screen').style.display = 'none';
            }
        }
        
        if (isMultiplayer) {
            Networking.sendInput({ upgraded: true, type: type, playerId: playerId, score: player.score, level: player.upgrades[type]?.level });
        }
        
        document.getElementById('upgrade-score').textContent = Math.floor(player.score);
        updateHUD();
    }
};


// --- ロビー/モード管理関数 ---

window.startSinglePlayer = function() {
    // ★修正: マルチプレイ関連の状態をすべてリセットし、シングルプレイに設定
    isMultiplayer = false;
    Networking.isConnected = false; 
    Networking.isHost = false;
    Networking.serverStateQueue = []; 
    Networking.inputQueue = [];

    localPlayerId = 0; 
    gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
    
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    
    startGame();
};

window.showLobby = function() {
    gameRunning = false;
    isUpgrading = false;
    // ロビーに戻る際もマルチプレイ状態をリセット
    isMultiplayer = false;
    Networking.isConnected = false;
    Networking.isHost = false;
    Networking.serverStateQueue = []; 
    Networking.inputQueue = [];
    
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('upgrade-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'none';

    // ホストの初期化
    gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('start-multi-game-button').style.display = 'none';
    document.getElementById('lobby-message').textContent = 'モードを選択するか、パーティルームを作成してください。';
};

window.createOrJoinRoom = function(isHost) {
    const roomName = document.getElementById('room-name').value;
    if (!roomName) return;

    if (Networking.isConnected && gameState.players.some(p => p.id === localPlayerId)) {
         document.getElementById('lobby-message').textContent = `あなたは既に P${localPlayerId + 1} として参加しています。`;
         return;
    }

    Networking.connect(isHost); 
    isMultiplayer = true;
    
    if (isHost) {
        localPlayerId = 0;
        gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
        Networking.isHost = true;
        Networking.serverStateQueue = [0]; 
        document.getElementById('start-multi-game-button').style.display = 'block';
        document.getElementById('lobby-message').textContent = `「${roomName}」を作成しました。 (P1: ${PLAYER_COLORS[0]})`;
    } else {
        const currentMaxId = gameState.players.reduce((max, p) => Math.max(max, p.id), -1);
        const newPlayerId = currentMaxId + 1;

        if (newPlayerId >= 4) {
             document.getElementById('lobby-message').textContent = '満員です。最大4人までです。';
             Networking.isConnected = false;
             return;
        }
        
        const newPlayer = createPlayer(newPlayerId, PLAYER_COLORS[newPlayerId]);
        gameState.players.push(newPlayer); 
        localPlayerId = newPlayerId; 
        
        Networking.serverStateQueue.push(newPlayerId); 
        
        document.getElementById('start-multi-game-button').style.display = 'none'; 
        document.getElementById('lobby-message').textContent = 
            `「${roomName}」に参加しました。 (P${newPlayerId + 1}: ${PLAYER_COLORS[newPlayerId]})`;
    }
    
    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('hud').style.display = 'flex';
    updateHUD();
};

window.startGame = function() {
    gameState.enemies = [];
    gameState.enemiesKilled = 0;
    
    gameState.players.forEach((p, index) => {
        p.health = 5;
        p.score = 0;
        p.totalScoreEarned = 0;
        p.bullets = [];
        p.x = GAME_WIDTH / (gameState.players.length + 1) * (index + 1); 
    });

    gameRunning = true;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'none';
    
    // シングルプレイまたはホストの場合に敵をスポーン
    if (Networking.isHost || !isMultiplayer) { 
        serverSpawnEnemy(0); 
    }
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
        // 1. クライアントからの入力を収集
        collectAndSendInput();
        
        if (isMultiplayer) {
            // 2A. マルチプレイ: ホスト側でサーバーロジックを実行し、全員に状態を同期
            Networking.simulateServerTick(deltaTime);
        } else {
            // 2B. シングルプレイ: ローカルで全てのゲームロジックを実行
            localGameTick(deltaTime);
        }
        
        // 3. 描画
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
