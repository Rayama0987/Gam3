// --- ゲーム設定 (定数) ---
const CANVAS = document.getElementById('game-canvas');
const CTX = CANVAS.getContext('2d');
const GAME_WIDTH = CANVAS.width;
const GAME_HEIGHT = CANVAS.height;

const BASE_SCORE_TO_UPGRADE = 10; 
const ENEMY_HEALTH = 10;
const ENEMY_VALUE = 3;
const PLAYER_SPEED_SCALE = 5; // プレイヤーの基本移動速度

// --- グローバル状態 ---
let gameRunning = false;
let isUpgrading = false;
let isMultiplayer = false; 
let lastTime = 0; 
let localPlayerId = 0; 

// ★ゲーム状態全体を管理する単一オブジェクト
let gameState = {
    players: [],
    enemies: [],
    enemiesKilled: 0
};

// --- プレイヤーと操作キー ---
const PLAYER_COLORS = ['lime', 'cyan', 'red', 'yellow']; 
let keys = {}; // 現在押されているキー

// ★追加: タッチ操作用の状態
let touchInput = {
    x: null, // タッチされたX座標
    isDown: false,
    shoot: false // スペースキーの代わりに画面をタッチしたら射撃
};


// プレイヤーの基本構造 
function createPlayer(id, color) {
    const baseCost = BASE_SCORE_TO_UPGRADE;
    return {
        id: id,
        color: color,
        x: GAME_WIDTH / (PLAYER_COLORS.length + 1) * (id + 1), 
        y: GAME_HEIGHT - 50,
        size: 20,
        speed: PLAYER_SPEED_SCALE,
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
        // 入力状態と、クライアント予測用の状態を分離
        input: { left: false, right: false, shoot: false },
        predictedX: GAME_WIDTH / (PLAYER_COLORS.length + 1) * (id + 1) // ★自己予測用
    };
}


// --- イベントリスナー (キー入力) ---
document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') {
        e.preventDefault(); 
    }
});
document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

// --- ★修正・追加: タッチイベントリスナー ---
CANVAS.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = CANVAS.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    
    // 画面タッチで射撃を開始
    touchInput.shoot = true; 
    touchInput.isDown = true;
    touchInput.x = touchX * (GAME_WIDTH / rect.width); // 座標をCanvasサイズに正規化
}, { passive: false });

CANVAS.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touchInput.isDown) {
        const rect = CANVAS.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        touchInput.x = touchX * (GAME_WIDTH / rect.width); // 座標をCanvasサイズに正規化
    }
}, { passive: false });

CANVAS.addEventListener('touchend', (e) => {
    touchInput.isDown = false;
    touchInput.shoot = false; // 射撃を停止
    touchInput.x = null;
});

// --- ユーティリティ関数 ---
function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * ゲーム状態をlocalStorageに保存 (シングルプレイ専用)
 */
function saveGame() {
    if (isMultiplayer) return false; 
    const player = gameState.players[0];
    if (!player) return false;

    const saveData = {
        x: player.x,
        y: player.y,
        health: player.health,
        score: player.score,
        totalScoreEarned: player.totalScoreEarned,
        upgrades: player.upgrades
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
 * localStorageからゲーム状態をロード (シングルプレイ専用)
 */
function loadGame() {
    const savedData = localStorage.getItem('shooterGameSave');
    if (!savedData) return false;

    try {
        const data = JSON.parse(savedData);
        const player = gameState.players[0];
        
        // 読み込んだデータをプレイヤーに適用
        player.x = data.x || player.x;
        player.y = data.y || player.y;
        player.predictedX = player.x;
        player.health = data.health || player.health;
        player.score = data.score || player.score;
        player.totalScoreEarned = data.totalScoreEarned || player.totalScoreEarned;
        
        // アップグレードレベルを適用
        Object.keys(player.upgrades).forEach(key => {
             if (data.upgrades[key]) {
                 player.upgrades[key].level = data.upgrades[key].level;
             }
        });
        
        console.log("ゲーム状態をロードしました。");
        return true;
    } catch (e) {
        console.error("ゲームのロードに失敗しました。", e);
        return false;
    }
}


// --- ネットワーク層のシミュレーション ---
const Networking = {
    isConnected: false,
    isHost: false,
    latency: 100, // 模擬的な遅延 (ms)
    inputQueue: [], 
    
    connect: function(isHost) {
        this.isConnected = true;
        this.isHost = isHost;
        console.log(`[NETWORKING] ${isHost ? 'ホスト' : 'クライアント'}として接続をシミュレート...`);
    },

    sendInput: function(input) {
        if (!this.isConnected) return;
        
        setTimeout(() => {
            this.inputQueue.push({ playerId: localPlayerId, input: input });
        }, this.latency / 2); 
    },

    receiveState: function(state) {
        if (!this.isConnected) return;
        
        setTimeout(() => {
            // ★修正: クライアントが初めて状態を受け取ったとき、自身のIDとプレイヤーリストを同期する
            if (gameState.players.length === 0 || gameState.players.length !== state.players.length) {
                // クライアント側でプレイヤーリストをホストの状態に合わせる
                gameState.players = state.players.map(p => {
                    const localP = gameState.players.find(lp => lp.id === p.id);
                    // プレイヤーの基本構造を維持しつつ、サーバーの状態を反映
                    return localP ? Object.assign(localP, p) : createPlayer(p.id, p.color);
                });
            }

            state.players.forEach(serverPlayer => {
                const localPlayer = gameState.players.find(p => p.id === serverPlayer.id);
                if (localPlayer) {
                    if (localPlayer.id !== localPlayerId) {
                        localPlayer.x = serverPlayer.x;
                    } else {
                        // 自己予測の誤差修正 (Reconciliation)
                        const error = localPlayer.predictedX - serverPlayer.x;
                        if (Math.abs(error) > 5) {
                            localPlayer.x = serverPlayer.x; 
                        } else {
                            localPlayer.x = localPlayer.x - error * 0.1;
                        }
                        localPlayer.predictedX = serverPlayer.x;
                    }
                    
                    localPlayer.health = serverPlayer.health;
                    localPlayer.score = serverPlayer.score;
                    localPlayer.bullets = serverPlayer.bullets;
                    Object.assign(localPlayer.upgrades, serverPlayer.upgrades);
                }
            });
            
            gameState.enemies = state.enemies;
            
            const player = gameState.players.find(p => p.id === localPlayerId);
            if(player){
                if (!isUpgrading && player.health > 0 && player.score >= BASE_SCORE_TO_UPGRADE) {
                    enterUpgradeScreen(player.id);
                }
            }
        }, this.latency / 2); 
    },

    simulateServerTick: function(deltaTime) {
        if (!this.isHost || !gameRunning || isUpgrading) return;
        
        // 1. 全プレイヤーの入力を適用
        this.inputQueue.forEach(packet => {
            const player = gameState.players.find(p => p.id === packet.playerId);
            if (player) {
                // 入力パケットをそのまま適用
                player.input = packet.input;
                
                // 強化イベントも処理
                if (packet.input.upgraded) {
                    serverApplyUpgrade(player, packet.input.type);
                }
            }
        });
        this.inputQueue = []; 

        // 2. サーバー側でのロジック更新 (移動、発射)
        const activePlayers = gameState.players.filter(p => p.health > 0);
        
        activePlayers.forEach(player => {
            // 移動 (サーバー側で処理)
            if (player.input.left && player.x > player.size / 2) {
                player.x -= player.speed * (deltaTime / 16);
            }
            if (player.input.right && player.x < GAME_WIDTH - player.size / 2) {
                player.x += player.speed * (deltaTime / 16);
            }
            player.x = Math.max(player.size / 2, Math.min(GAME_WIDTH - player.size / 2, player.x)); // 範囲制限

            // 発射 (サーバー側で処理)
            const now = Date.now();
            const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
            
            if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
                serverShoot(player);
                player.lastShotTime = now;
            }

            // 弾丸の移動
            player.bullets = player.bullets.filter(bullet => {
                if (bullet.isAim) {
                    serverAutoAim(player, bullet, deltaTime);
                }
                
                if (!bullet.isBounce) {
                    bullet.y -= bullet.speed * (deltaTime / 16); 
                } else {
                    bullet.x += bullet.velX * (deltaTime / 16);
                    bullet.y += bullet.velY * (deltaTime / 16);
                    serverCheckBulletBounds(bullet); 
                }
                
                return bullet.y > 0 && bullet.x > 0 && bullet.x < GAME_WIDTH && bullet.y < GAME_HEIGHT; 
            });
        });
        
        // 敵の出現ロジック
        if (gameState.enemies.length === 0) {
            serverSpawnEnemy(0);
        }
        
        // 敵の移動
        gameState.enemies.forEach(enemy => {
            enemy.y += enemy.speed * (deltaTime / 16);
        });
        
        // 衝突判定、ダメージ処理、スコア計算
        serverCheckCollisions();

        // 敵が画面外に出たときの処理
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

        // 3. 状態を全クライアントにブロードキャスト（シミュレーション）
        // 状態をコピーして送信
        const stateToSend = {
             players: gameState.players.map(p => ({
                 id: p.id, x: p.x, health: p.health, score: p.score, 
                 bullets: p.bullets, upgrades: p.upgrades
             })),
             enemies: gameState.enemies
        };
        Networking.receiveState(JSON.parse(JSON.stringify(stateToSend)));
    }
};

// --- ホスト/サーバー側のゲームロジック (省略) ---
function serverAutoAim(player, bullet, deltaTime) { 
    // ... 既存のロジック ...
}
function serverCheckBulletBounds(bullet) { 
    // ... 既存のロジック ...
}
function serverShoot(player) { 
    // ... 既存のロジック ...
    const { upgrades } = player;
    const count = upgrades.bulletCount.level;
    const currentSpeed = upgrades.speed.baseSpeed * upgrades.speed.level;
    const currentDamage = upgrades.damage.baseDamage * upgrades.damage.level;
    const currentRadius = upgrades.radius.baseRadius * upgrades.radius.level;
    const bounceChance = upgrades.bounce.baseChance * upgrades.bounce.level;
    const isAutoAim = upgrades.autoAim.level > 0;
    
    for (let i = 0; i < count; i++) {
        const isBounce = Math.random() < bounceChance;
        
        player.bullets.push({
            x: player.x,
            y: player.y,
            radius: currentRadius,
            speed: currentSpeed,
            damage: currentDamage,
            velX: 0, 
            velY: -currentSpeed, 
            isBounce: isBounce,
            isAim: isAutoAim,
            ownerId: player.id // 誰の弾丸か記録
        });
    }
}
function serverCheckCollisions() { 
    // ... 既存のロジック ...
    const finalEnemyValue = ENEMY_VALUE; 

    gameState.enemies.forEach(enemy => {
        gameState.players.forEach(player => {
            player.bullets.forEach(bullet => {
                if (distance(bullet.x, bullet.y, enemy.x, enemy.y) < enemy.size / 2 + bullet.radius) {
                    enemy.health -= bullet.damage;
                    bullet.hit = true;
                    enemy.lastHitBulletOwnerId = player.id; // 最後にヒットさせたプレイヤーを記録
                }
            });
        });
    });

    gameState.enemies = gameState.enemies.filter(enemy => {
        if (enemy.health <= 0) {
            const killerId = enemy.lastHitBulletOwnerId;
            if (killerId !== undefined) {
                gameState.players.forEach(p => {
                    let scoreMultiplier = (p.id === killerId) ? 1.0 : 0.5; // 協力スコア配分
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
    
    // 衝突した弾丸を削除
    gameState.players.forEach(player => {
        player.bullets = player.bullets.filter(bullet => !bullet.hit);
    });
}
function serverSpawnEnemy(yOffset = 0) { 
    // ... 既存のロジック ...
    gameState.enemies.push({
        x: Math.random() * (GAME_WIDTH - 40) + 20,
        y: -15 - yOffset, 
        size: 30, 
        speed: 1.5, 
        health: ENEMY_HEALTH,
        lastHitBulletOwnerId: undefined 
    });
}
function serverApplyUpgrade(player, type) { 
    // ... 既存のロジック ...
    if (player.score < BASE_SCORE_TO_UPGRADE) return;
    player.score -= BASE_SCORE_TO_UPGRADE; 

    if (type === 'healthRecover') {
        const maxHealth = 5; 
        const targetPlayer = gameState.players.filter(p => p.health > 0 && p.health < maxHealth)
            .reduce((minP, currentP) => 
                (currentP.health < minP.health) ? currentP : minP
            , { health: maxHealth, id: undefined }); 

        if (targetPlayer.id !== undefined) {
             gameState.players.find(p => p.id === targetPlayer.id).health++;
        }
    } else {
        const upgrade = player.upgrades[type];
        if (upgrade) {
            upgrade.level++;
        }
    }
}

// --- クライアント側の処理 ---

function draw() { 
    // ... 既存のロジック ...
    CTX.fillStyle = '#000';
    CTX.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // プレイヤーの描画 (ローカル予測位置またはサーバー位置を使用)
    gameState.players.forEach(player => {
        if (player.health <= 0) return;
        
        CTX.fillStyle = player.color;
        // 描画には、プレイヤーの現在のx座標 (予測/補間された値) を使用
        CTX.fillRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size);
    });

    // 弾丸の描画
    gameState.players.forEach(player => {
        player.bullets.forEach(bullet => {
            CTX.fillStyle = player.color; // 弾丸の色をプレイヤーに合わせる
            CTX.beginPath();
            CTX.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
            CTX.fill();
        });
    });

    // 敵の描画
    gameState.enemies.forEach(enemy => {
        CTX.fillStyle = 'red';
        CTX.fillRect(enemy.x - enemy.size / 2, enemy.y - enemy.size / 2, enemy.size, enemy.size);
        const healthRatio = enemy.health / ENEMY_HEALTH;
        CTX.fillStyle = 'green';
        CTX.fillRect(enemy.x - enemy.size / 2, enemy.y - enemy.size / 2 - 10, enemy.size * healthRatio, 5);
    });

    updateHUD();
}

/**
 * クライアント側でローカルプレイヤーの移動を予測する
 */
function localUpdateMovement(deltaTime) {
    if (!gameRunning || isUpgrading) return;
    
    const player = gameState.players.find(p => p.id === localPlayerId);
    if (!player || player.health <= 0) return;
    
    const inputState = collectInputState(); 
    
    // キーボード入力による移動
    let movingLeft = inputState.left;
    let movingRight = inputState.right;

    // タッチ入力による移動 (タッチX座標とプレイヤーX座標を比較)
    if (touchInput.isDown && touchInput.x !== null) {
        if (touchInput.x < player.predictedX - player.size * 2) {
            movingLeft = true;
            movingRight = false;
        } else if (touchInput.x > player.predictedX + player.size * 2) {
            movingRight = true;
            movingLeft = false;
        } else {
             // 中央付近では停止
             movingLeft = false;
             movingRight = false;
        }
    }


    // 移動処理をローカルで即座に実行 (Predicted Movement)
    if (movingLeft) {
        player.predictedX -= player.speed * (deltaTime / 16);
    }
    if (movingRight) {
        player.predictedX += player.speed * (deltaTime / 16);
    }
    
    player.predictedX = Math.max(player.size / 2, Math.min(GAME_WIDTH - player.size / 2, player.predictedX));
    
    // 予測位置を現在の描画位置として一時的に利用 (見た目のラグを隠す)
    player.x = player.predictedX; 
}


function collectInputState() {
    // 矢印キーとA/Dキーの両方に対応
    // ★修正: shootフラグにタッチ入力も統合
    return {
        left: keys['KeyA'] || keys['ArrowLeft'] || false,
        right: keys['KeyD'] || keys['ArrowRight'] || false,
        shoot: keys['Space'] || touchInput.shoot || false
    };
}

function collectAndSendInput() {
    if (!gameRunning || isUpgrading || localPlayerId === undefined) return;
    
    const inputState = collectInputState(); 

    if (isMultiplayer) {
         Networking.sendInput(inputState);
    } else {
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

    player.x = player.predictedX;

    // 2. 発射 (ローカルで処理)
    const now = Date.now();
    const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
    
    if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
        serverShoot(player); // サーバー側のロジックを使用
        player.lastShotTime = now;
    }

    // 3. 弾丸の移動
    player.bullets = player.bullets.filter(bullet => {
        if (bullet.isAim) {
            serverAutoAim(player, bullet, deltaTime);
        }
        
        if (!bullet.isBounce) {
            bullet.y -= bullet.speed * (deltaTime / 16); 
        } else {
            bullet.x += bullet.velX * (deltaTime / 16);
            bullet.y += bullet.velY * (deltaTime / 16);
            serverCheckBulletBounds(bullet); 
        }
        return bullet.y > 0 && bullet.x > 0 && bullet.x < GAME_WIDTH && bullet.y < GAME_HEIGHT; 
    });

    // 4. 敵の出現、移動、衝突、ダメージ、スコア
    Networking.simulateServerTick(deltaTime); 

    // 5. 強化画面のトリガー
    if (!isUpgrading && player.score >= BASE_SCORE_TO_UPGRADE) {
        enterUpgradeScreen(player.id);
    }
}


// --- ゲームオーバー処理と強化画面 ---

function updateHUD() { /* ... 既存のロジック ... */
    const container = document.getElementById('player-stats-container');
    container.innerHTML = '';
    
    gameState.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-info';
        let statusColor = player.health <= 0 ? 'gray' : player.color;
        const playerLabel = isMultiplayer ? `P${player.id + 1} (${player.color})${player.id === localPlayerId ? ' (YOU)' : ''}` : `プレイヤー`;

        playerDiv.innerHTML = `
            <span style="color: ${statusColor}; font-weight: bold;">${playerLabel}</span>
            <span style="color: ${statusColor};">スコア: ${Math.floor(player.score)}</span>
            <span style="color: ${statusColor};">体力: ${player.health}</span>
        `;
        container.appendChild(playerDiv);
    });
    
    const lobbyMessageElement = document.getElementById('lobby-message');
    if (lobbyMessageElement) {
        if (isMultiplayer) {
             if (Networking.isHost && !gameRunning) {
                 lobbyMessageElement.textContent = "あなたはホストです。ゲーム開始ボタンを押してください。";
             } else if (!gameRunning) {
                 lobbyMessageElement.textContent = "ホストがゲームを開始するのを待っています...";
             } else {
                 lobbyMessageElement.textContent = "";
             }
        }
    }
    
    const localPlayer = gameState.players.find(p => p.id === localPlayerId);
    if(localPlayer){
         document.getElementById('upgrade-score').textContent = Math.floor(localPlayer.score);
    }
}

function gameOver() { /* ... 既存のロジック ... */
    gameRunning = false;
    
    if (!isMultiplayer) {
        saveGame();
    }

    const finalScore = gameState.players.reduce((maxScore, p) => 
        Math.max(maxScore, Math.floor(p.totalScoreEarned)) 
    , 0);
    
    document.getElementById('final-score').textContent = finalScore; 
    document.getElementById('game-over-screen').style.display = 'flex';
}

let currentUpgradePlayerId = 0;

function enterUpgradeScreen(playerId) { /* ... 既存のロジック ... */ 
    if (isUpgrading) return; 

    isUpgrading = true;
    currentUpgradePlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);

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

window.applyUpgrade = function(type) { /* ... 既存のロジック ... */
    const playerId = currentUpgradePlayerId;
    const player = gameState.players.find(p => p.id === playerId);
    
    if (isUpgrading) {
        if (player.score < BASE_SCORE_TO_UPGRADE) {
            document.getElementById('upgrade-message').textContent = 'スコアが不足しています。（必要: 10）';
            return;
        }

        player.score -= BASE_SCORE_TO_UPGRADE; 

        if (isMultiplayer) {
            Networking.sendInput({ upgraded: true, type: type, playerId: playerId });
            
            if (player.score < BASE_SCORE_TO_UPGRADE) {
                isUpgrading = false;
                document.getElementById('upgrade-screen').style.display = 'none';
            } else {
                 enterUpgradeScreen(playerId); 
            }
        } else {
            serverApplyUpgrade(player, type);
            if (player.score < BASE_SCORE_TO_UPGRADE || type === 'healthRecover') {
                isUpgrading = false;
                document.getElementById('upgrade-screen').style.display = 'none';
            } else {
                 enterUpgradeScreen(playerId);
            }
        }
        
        document.getElementById('upgrade-score').textContent = Math.floor(player.score);
        updateHUD();
    }
};


// --- ロビー/モード管理関数 ---

window.startSinglePlayer = function(load = false) { 
    isMultiplayer = false;
    Networking.isConnected = false; 
    Networking.isHost = true; 
    
    localPlayerId = 0; 
    gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
    
    if (load) {
        if (!loadGame()) {
            console.log("保存データが見つからないため、新規ゲームを開始します。");
        }
    }
    
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    
    startGame(load); 
};

window.exitGame = function() { 
    // ... 既存のロジック ...
    if (!gameRunning) {
        window.showLobby();
        return;
    }
    
    const confirmExit = confirm(`ゲームを終了してロビーに戻りますか？\n（シングルプレイ時: 現在の進行状況は自動保存されます）\n（マルチプレイ時: 保存されません）`);
    
    if (confirmExit) {
        if (!isMultiplayer) {
            saveGame(); 
        }
        gameRunning = false;
        isUpgrading = false;
        window.showLobby(); 
    }
}

window.showLobby = function() { 
    gameRunning = false;
    isUpgrading = false;
    
    isMultiplayer = false;
    Networking.isConnected = false;
    Networking.isHost = false; 

    gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
    
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('upgrade-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'none';

    const hasSaveData = localStorage.getItem('shooterGameSave') !== null;
    document.getElementById('load-game-button').style.display = hasSaveData ? 'inline-block' : 'none';

    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('start-multi-game-button').style.display = 'none';
    document.getElementById('lobby-message').textContent = 'モードを選択するか、パーティルームを作成してください。';
};

/**
 * ★修正: マルチプレイのルーム作成/参加ロジックを修正
 */
window.createOrJoinRoom = function(isHost) {
    const roomName = document.getElementById('room-name').value;
    if (!roomName) return;

    Networking.connect(isHost); 
    isMultiplayer = true;
    
    // 既存のプレイヤーリストをリセットし、ホストがP1として始まる
    gameState.players = []; 

    if (isHost) {
        localPlayerId = 0;
        gameState.players.push(createPlayer(0, PLAYER_COLORS[0]));
        
        document.getElementById('start-multi-game-button').style.display = 'block';
        document.getElementById('lobby-message').textContent = `「${roomName}」を作成しました。あなたはホスト(P1)です。`;

    } else {
        // ★修正: クライアント参加のシミュレーション
        // サーバーがまだプレイヤーリストをブロードキャストしていないため、ここでは仮にP2として参加し、
        // 最初の状態パケット(receiveState)でIDを確定させる。
        // シミュレーションなので、ここではP2として初期化する
        localPlayerId = 1; 
        
        // 実際のマルチプレイでは、この時点でホストにIDを要求する
        // シミュレーションのため、ホスト側にもこのクライアントの参加をシミュレーションで伝える
        
        // シミュレーションの遅延後に、クライアントの参加をホスト側で認識させる
        setTimeout(() => {
            if (Networking.isHost) { // このチェックは理論上不要だが、安全性のため
                const currentMaxId = gameState.players.reduce((max, p) => Math.max(max, p.id), -1);
                const newPlayerId = currentMaxId + 1;

                if (newPlayerId < 4) { // 最大4人まで
                    const newPlayer = createPlayer(newPlayerId, PLAYER_COLORS[newPlayerId]);
                    gameState.players.push(newPlayer); 
                    
                    // ホストが全てのクライアントに新しいリストをブロードキャスト（receiveStateをトリガー）
                    Networking.receiveState(JSON.parse(JSON.stringify({ players: gameState.players, enemies: [] })));
                    
                    console.log(`[HOST] クライアント P${newPlayerId + 1} が参加しました。`);
                } else {
                    document.getElementById('lobby-message').textContent = '満員です。最大4人までです。';
                    Networking.isConnected = false;
                }
            }
        }, Networking.latency); 

        // クライアント側のUI更新
        document.getElementById('start-multi-game-button').style.display = 'none'; 
        document.getElementById('lobby-message').textContent = 
            `「${roomName}」に参加を試みています。ホストの応答を待っています...`;
    }
    
    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('hud').style.display = 'flex';
    updateHUD();
};

window.startGame = function(isLoad = false) { 
    // ... 既存のロジック ...
    if (isMultiplayer && !Networking.isHost) return; 

    gameState.enemies = [];
    gameState.enemiesKilled = 0;
    
    gameState.players.forEach((p, index) => {
        if (!isLoad) { 
            p.health = 5;
            p.score = 0;
            p.totalScoreEarned = 0;
            p.bullets = [];
        }
        p.x = GAME_WIDTH / (gameState.players.length + 1) * (index + 1);
        p.predictedX = p.x; 
    });

    gameRunning = true;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'none';
    
    if ((Networking.isHost || !isMultiplayer) && gameState.enemies.length === 0) { 
        serverSpawnEnemy(0); 
    }
};


// --- メインゲームループ ---
function gameLoop(currentTime) { 
    // ... 既存のロジック ...
    if (lastTime === 0) {
        lastTime = currentTime;
    }
    
    let deltaTime = currentTime - lastTime;
    if (deltaTime > 250) {
        deltaTime = 250; 
    }
    lastTime = currentTime;

    if (gameRunning) {
        localUpdateMovement(deltaTime);
        collectAndSendInput();
        
        if (Networking.isHost) {
            Networking.simulateServerTick(deltaTime);
        } else if (!isMultiplayer) {
            localGameTick(deltaTime);
        }

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
