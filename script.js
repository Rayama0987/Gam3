// --- ゲーム設定 (定数) ---
const CANVAS = document.getElementById('game-canvas');
const CTX = CANVAS.getContext('2d');
const GAME_WIDTH = CANVAS.width;
const GAME_HEIGHT = CANVAS.height;

const BASE_SCORE_TO_UPGRADE = 10; 
const ENEMY_HEALTH = 10;
const ENEMY_VALUE = 3;
const PLAYER_SPEED_SCALE = 5; 

// --- グローバル状態 ---
let gameRunning = false;
let isUpgrading = false;
let isMultiplayer = false; 
let lastTime = 0; 
let localPlayerId = 0; 

let gameState = {
    players: [],
    enemies: [],
    enemiesKilled: 0
};

// --- プレイヤーと操作キー ---
const PLAYER_COLORS = ['lime', 'cyan', 'red', 'yellow']; 
let keys = {}; 

// タッチ操作用の状態
let touchInput = {
    x: null, 
    isDown: false,
    shoot: false 
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
        input: { left: false, right: false, shoot: false },
        predictedX: GAME_WIDTH / (PLAYER_COLORS.length + 1) * (id + 1) 
    };
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
        
        player.x = data.x || player.x;
        player.y = data.y || player.y;
        player.predictedX = player.x;
        player.health = data.health || player.health;
        player.score = data.score || player.score;
        player.totalScoreEarned = data.totalScoreEarned || player.totalScoreEarned;
        
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
    latency: 100, 
    inputQueue: [], 
    
    connect: function(isHost) {
        this.isConnected = true;
        this.isHost = isHost;
        console.log(`[NETWORKING] ${isHost ? 'ホスト' : 'クライアント'}として接続をシミュレート...`);
    },

    sendInput: function(input) {
        if (!this.isConnected) return;
        
        // ホストに送るシミュレーション (ここでは inputQueue に入れる)
        setTimeout(() => {
            this.inputQueue.push({ playerId: localPlayerId, input: input });
        }, this.latency / 2); 
    },

    receiveState: function(state) {
        if (!this.isConnected) return;
        
        setTimeout(() => {
            // クライアント側でプレイヤーリストをホストの状態に合わせる
            if (gameState.players.length === 0 || gameState.players.length !== state.players.length) {
                gameState.players = state.players.map(p => {
                    const localP = gameState.players.find(lp => lp.id === p.id);
                    return localP ? Object.assign(localP, p) : createPlayer(p.id, p.color);
                });
            }

            // 状態の適用
            state.players.forEach(serverPlayer => {
                const localPlayer = gameState.players.find(p => p.id === serverPlayer.id);
                if (localPlayer) {
                    if (localPlayer.id !== localPlayerId) {
                        // 味方プレイヤーの状態をそのまま受け入れる
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
        
        // 1. 入力処理
        this.inputQueue.forEach(packet => {
            const player = gameState.players.find(p => p.id === packet.playerId);
            if (player) {
                player.input = packet.input;
                if (packet.input.upgraded) {
                    serverApplyUpgrade(player, packet.input.type);
                }
            }
        });
        this.inputQueue = []; 
        
        // 2. 状態更新 (移動、発射、弾丸の更新)
        const activePlayers = gameState.players.filter(p => p.health > 0);
        
        activePlayers.forEach(player => {
            if (player.input.left && player.x > player.size / 2) {
                player.x -= player.speed * (deltaTime / 16);
            }
            if (player.input.right && player.x < GAME_WIDTH - player.size / 2) {
                player.x += player.speed * (deltaTime / 16);
            }
            player.x = Math.max(player.size / 2, Math.min(GAME_WIDTH - player.size / 2, player.x)); 

            const now = Date.now();
            const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
            
            if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
                serverShoot(player);
                player.lastShotTime = now;
            }

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
        
        // 3. 敵の出現と移動
        if (gameState.enemies.length === 0) {
            serverSpawnEnemy(0);
        }
        
        gameState.enemies.forEach(enemy => {
            enemy.y += enemy.speed * (deltaTime / 16);
        });
        
        // 4. 衝突判定
        serverCheckCollisions();

        // 5. 敵の消失とプレイヤーへのダメージ
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
        
        // 6. ゲームオーバー判定
        if (gameState.players.filter(p => p.health > 0).length === 0) {
            gameOver();
            return;
        }

        // 7. 状態を全クライアントにブロードキャスト（シミュレーション）
        const stateToSend = {
             players: gameState.players.map(p => ({
                 id: p.id, x: p.x, health: p.health, score: p.score, 
                 bullets: p.bullets, upgrades: p.upgrades
             })),
             enemies: gameState.enemies
        };
        // 全てのプレイヤーに状態を送ることで、リストが同期される
        gameState.players.forEach((p) => {
             Networking.receiveState(JSON.parse(JSON.stringify(stateToSend)));
        });
    }
};

// ... (サーバーロジック関数は省略) ...
function serverAutoAim(player, bullet, deltaTime) { /* ... */ }
function serverCheckBulletBounds(bullet) { /* ... */ }
function serverShoot(player) { /* ... */ }
function serverCheckCollisions() { /* ... */ }
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
function serverApplyUpgrade(player, type) { /* ... */ }


// --- クライアント側の処理 ---

function draw() { 
    CTX.fillStyle = '#000';
    CTX.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // プレイヤーの描画 (味方プレイヤーと自分の両方を描画)
    gameState.players.forEach(player => {
        if (player.health <= 0) return;
        CTX.fillStyle = player.color;
        
        // ★修正点: プレイヤーの位置として、サーバーからの最新の状態(player.x)を使用する
        CTX.fillRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size);
        
        // プレイヤーIDの表示
        CTX.fillStyle = 'white';
        CTX.font = '10px Arial';
        CTX.textAlign = 'center';
        CTX.fillText(`P${player.id + 1}`, player.x, player.y + player.size + 5);
    });

    // 弾丸の描画 (全てのプレイヤーの弾丸を描画)
    gameState.players.forEach(player => {
        // ★修正点: player.bullets を直接使用し、サーバーから同期された弾丸を描画する
        player.bullets.forEach(bullet => {
            CTX.fillStyle = player.color; 
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

function localUpdateMovement(deltaTime) {
    if (!gameRunning || isUpgrading) return;
    
    const player = gameState.players.find(p => p.id === localPlayerId);
    if (!player || player.health <= 0) return;
    
    const inputState = collectInputState(); 
    
    let movingLeft = inputState.left;
    let movingRight = inputState.right;

    // タッチ入力による移動
    if (touchInput.isDown && touchInput.x !== null) {
        if (touchInput.x < player.predictedX - player.size * 2) {
            movingLeft = true;
            movingRight = false;
        } else if (touchInput.x > player.predictedX + player.size * 2) {
            movingRight = true;
            movingLeft = false;
        } else {
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
    
    player.x = player.predictedX; 
}


function collectInputState() {
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


function localGameTick(deltaTime) { 
    if (isMultiplayer || !gameRunning || isUpgrading) return;
    
    const player = gameState.players[0];
    if (!player || player.health <= 0) return;

    player.x = player.predictedX;

    const now = Date.now();
    const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
    
    if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
        serverShoot(player); 
        player.lastShotTime = now;
    }

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

    Networking.simulateServerTick(deltaTime); 

    if (!isUpgrading && player.score >= BASE_SCORE_TO_UPGRADE) {
        enterUpgradeScreen(player.id);
    }
}


// --- HUD/画面管理関数 ---

function updateHUD() {
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
    
    document.getElementById('lobby-player-count').textContent = gameState.players.length; 
    
    const localPlayer = gameState.players.find(p => p.id === localPlayerId);
    if(localPlayer){
         document.getElementById('upgrade-score').textContent = Math.floor(localPlayer.score);
    }
}

function gameOver() {
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

function enterUpgradeScreen(playerId) {
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

window.applyUpgrade = function(type) {
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

window.createOrJoinRoom = function(isHost) {
    const roomName = document.getElementById('room-name').value;
    if (!roomName) return;

    Networking.connect(isHost); 
    isMultiplayer = true;
    
    // ホストとして作成する場合
    if (isHost) {
        localPlayerId = 0;
        gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
        document.getElementById('start-multi-game-button').style.display = 'block';
        document.getElementById('lobby-message').textContent = `「${roomName}」を作成しました。あなたはホスト(P1)です。`;
    } 
    // クライアントとして参加する場合
    else {
        // クライアントが参加する際、ホスト側のプレイヤーリストの最新の状態を取得し、自分のIDを決定するシミュレーションを行う。
        const currentMaxId = gameState.players.length > 0 ? gameState.players.reduce((max, p) => Math.max(max, p.id), -1) : -1;
        const newPlayerId = currentMaxId + 1;
        
        if (newPlayerId < PLAYER_COLORS.length) {
             localPlayerId = newPlayerId;
             
             // クライアントが参加した際、ホスト側のgameState.playersに新しいプレイヤーを**直接追加**するシミュレーションを行う
             const newPlayer = createPlayer(newPlayerId, PLAYER_COLORS[newPlayerId]);
             
             // クライアント側のリストに追加
             gameState.players.push(newPlayer);
             
             // ホスト側のUIを更新するためにも、updateHUDを呼び出す
             updateHUD(); 

             document.getElementById('start-multi-game-button').style.display = 'none'; 
             document.getElementById('lobby-message').textContent = 
                 `「${roomName}」に参加しました。あなたはクライアント(P${localPlayerId + 1})です。ホストのゲーム開始を待っています...`;
        } else {
             localPlayerId = -1; // Invalid ID
             Networking.isConnected = false;
             document.getElementById('lobby-message').textContent = '満員です。最大4人までです。';
             return;
        }
    }
    
    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('hud').style.display = 'flex';
    updateHUD();
};

window.startGame = function(isLoad = false) { 
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
