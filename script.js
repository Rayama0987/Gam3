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

// --- ユーティリティ関数 ---
function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
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

    // クライアント -> ホストへ入力送信
    sendInput: function(input) {
        if (!this.isConnected) return;
        
        // 実際はWebRTCやWebSocketで送る
        setTimeout(() => {
            // 強化イベントも入力として送信される
            this.inputQueue.push({ playerId: localPlayerId, input: input });
        }, this.latency / 2); // 半分のレイテンシでホストのキューに到達
    },

    // ホスト -> クライアントへ状態送信
    receiveState: function(state) {
        if (!this.isConnected) return;
        
        setTimeout(() => {
            // クライアント側で新しい状態を適用
            state.players.forEach(serverPlayer => {
                const localPlayer = gameState.players.find(p => p.id === serverPlayer.id);
                if (localPlayer) {
                    if (localPlayer.id !== localPlayerId) {
                        // 他のプレイヤーの状態はそのまま受け入れる
                        localPlayer.x = serverPlayer.x;
                    } else {
                        // ★自己予測の誤差修正 (Reconciliation)
                        const error = localPlayer.predictedX - serverPlayer.x;
                        if (Math.abs(error) > 5) {
                            localPlayer.x = serverPlayer.x; // 大きな誤差は強制修正
                        } else {
                            // 小さな誤差はスムーズに補間
                            localPlayer.x = localPlayer.x - error * 0.1;
                        }
                        
                        // 予測位置をサーバーからの位置でリセット
                        localPlayer.predictedX = serverPlayer.x;
                    }
                    
                    // プレイヤー以外の状態を更新
                    localPlayer.health = serverPlayer.health;
                    localPlayer.score = serverPlayer.score;
                    localPlayer.bullets = serverPlayer.bullets;
                    Object.assign(localPlayer.upgrades, serverPlayer.upgrades);
                }
            });
            
            // 敵の状態を更新
            gameState.enemies = state.enemies;
            
            // 強化画面のトリガーチェック (ローカルプレイヤーのみ)
            const player = gameState.players.find(p => p.id === localPlayerId);
            if(player){
                if (!isUpgrading && player.health > 0 && player.score >= BASE_SCORE_TO_UPGRADE) {
                    enterUpgradeScreen(player.id);
                }
            }
        }, this.latency / 2); // 残りの半分のレイテンシでクライアントに到達
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
        
        // ★修正箇所: 敵の出現ロジックを修正
        // 画面に敵がいない場合、新しい敵をスポーン
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
                    // 最も体力の低いプレイヤーにダメージ
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
        gameState.players.forEach((p) => {
             // 実際には全接続クライアントに送る
             Networking.receiveState(JSON.parse(JSON.stringify(gameState)));
        });
    }
};

// --- ホスト/サーバー側のゲームロジック (シングルプレイでも使用) ---
function serverAutoAim(player, bullet, deltaTime) {
    // ... (前バージョンのロジックを流用) ...
    const aimStrength = player.upgrades.autoAim.baseAimStrength * player.upgrades.autoAim.level;
    const nearestEnemy = gameState.enemies.reduce((nearest, enemy) => {
        const d = distance(player.x, player.y, enemy.x, enemy.y);
        if (!nearest || d < nearest.distance) {
            return { enemy: enemy, distance: d };
        }
        return nearest;
    }, null);

    if (nearestEnemy && nearestEnemy.distance < 300) {
        const dx = nearestEnemy.enemy.x - bullet.x;
        const dy = nearestEnemy.enemy.y - bullet.y;
        const angleToTarget = Math.atan2(dy, dx);
        
        const currentAngle = Math.atan2(bullet.velY, bullet.velX);
        const angleDiff = angleToTarget - currentAngle;
        
        // 角度差を -PI から PI の範囲に正規化
        let normalizedDiff = angleDiff;
        if (normalizedDiff > Math.PI) normalizedDiff -= 2 * Math.PI;
        if (normalizedDiff < -Math.PI) normalizedDiff += 2 * Math.PI;

        const newAngle = currentAngle + normalizedDiff * aimStrength * (deltaTime / 16);
        
        const speed = Math.sqrt(bullet.velX ** 2 + bullet.velY ** 2);
        
        bullet.velX = Math.cos(newAngle) * speed;
        bullet.velY = Math.sin(newAngle) * speed;
    }
}

function serverCheckBulletBounds(bullet) {
    // 左右のバウンド
    if (bullet.x < bullet.radius || bullet.x > GAME_WIDTH - bullet.radius) {
        bullet.velX *= -1;
        bullet.x = Math.max(bullet.radius, Math.min(GAME_WIDTH - bullet.radius, bullet.x));
    }
}

function serverShoot(player) {
    // ... (前バージョンのロジックを流用) ...
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
    
    // 入力を収集
    const inputState = collectInputState(); 

    // 移動処理をローカルで即座に実行 (Predicted Movement)
    if (inputState.left) {
        player.predictedX -= player.speed * (deltaTime / 16);
    }
    if (inputState.right) {
        player.predictedX += player.speed * (deltaTime / 16);
    }
    
    player.predictedX = Math.max(player.size / 2, Math.min(GAME_WIDTH - player.size / 2, player.predictedX));
    
    // 予測位置を現在の描画位置として一時的に利用 (見た目のラグを隠す)
    player.x = player.predictedX; 
}


function collectInputState() {
    // 矢印キーとA/Dキーの両方に対応
    return {
        left: keys['KeyA'] || keys['ArrowLeft'] || false,
        right: keys['KeyD'] || keys['ArrowRight'] || false,
        shoot: keys['Space'] || false
    };
}

function collectAndSendInput() {
    if (!gameRunning || isUpgrading || localPlayerId === undefined) return;
    
    const inputState = collectInputState(); 

    if (isMultiplayer) {
         // マルチプレイ時: ホストへ入力のみを送信
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

    // シングルプレイでは、localUpdateMovementで予測した位置をそのまま利用
    player.x = player.predictedX;

    // 2. 発射 (ローカルで処理)
    const now = Date.now();
    const fireInterval = player.upgrades.fireRate.baseInterval / player.upgrades.fireRate.level; 
    
    if (player.input.shoot && (now - player.lastShotTime > fireInterval)) {
        serverShoot(player); // サーバー側のロジックを使用
        player.lastShotTime = now;
    }

    // 3. 弾丸の移動 (サーバーロジックと同様)
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
    // シングルプレイではホストと同じロジックを直接実行
    Networking.simulateServerTick(deltaTime); 

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
        const playerLabel = isMultiplayer ? `P${player.id + 1} (${player.color})${player.id === localPlayerId ? ' (YOU)' : ''}` : `プレイヤー`;

        playerDiv.innerHTML = `
            <span style="color: ${statusColor}; font-weight: bold;">${playerLabel}</span>
            <span style="color: ${statusColor};">スコア: ${Math.floor(player.score)}</span>
            <span style="color: ${statusColor};">体力: ${player.health}</span>
        `;
        container.appendChild(playerDiv);
    });
    // ホスト情報も表示
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

    // アップグレードボタンの表示更新
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
    
    // マルチプレイ専用の体力回復ボタン
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

        // クライアント側でスコアを一時的に減らす（応答待ちの間に強化画面から抜けられないように）
        player.score -= BASE_SCORE_TO_UPGRADE; 

        if (isMultiplayer) {
            // マルチプレイ時: 入力パケットとして強化要求をホストへ送信
            Networking.sendInput({ upgraded: true, type: type, playerId: playerId });
            
            // 強化画面を閉じるのはホストからの状態更新を待ってから行うのが理想だが、ここでは簡略化
            if (player.score < BASE_SCORE_TO_UPGRADE) {
                isUpgrading = false;
                document.getElementById('upgrade-screen').style.display = 'none';
            } else {
                 // スコアがまだある場合は、ボタンの状態を更新するために画面を再描画
                 enterUpgradeScreen(playerId); 
            }
        } else {
            // シングルプレイ時: 即座に適用し、画面を閉じるか更新
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

window.startSinglePlayer = function() {
    isMultiplayer = false;
    Networking.isConnected = false; 
    Networking.isHost = true; // シングルプレイは常にホスト(サーバーロジック)を実行
    
    localPlayerId = 0; 
    gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
    
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    
    startGame();
};

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

    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('start-multi-game-button').style.display = 'none';
    document.getElementById('lobby-message').textContent = 'モードを選択するか、パーティルームを作成してください。';
};

window.createOrJoinRoom = function(isHost) {
    const roomName = document.getElementById('room-name').value;
    if (!roomName) return;

    // 接続のシミュレーション
    Networking.connect(isHost); 
    isMultiplayer = true;
    
    if (isHost) {
        localPlayerId = 0;
        gameState.players = [createPlayer(0, PLAYER_COLORS[0])];
        
        document.getElementById('start-multi-game-button').style.display = 'block';
        document.getElementById('lobby-message').textContent = `「${roomName}」を作成しました。あなたはホスト(P1)です。`;
    } else {
        // クライアント参加のシミュレーション（ここでは参加を許可する）
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
        
        document.getElementById('start-multi-game-button').style.display = 'none'; 
        document.getElementById('lobby-message').textContent = 
            `「${roomName}」に参加しました。ホストがゲームを開始するのを待っています...`;
    }
    
    document.getElementById('lobby-player-count').textContent = gameState.players.length;
    document.getElementById('hud').style.display = 'flex';
    updateHUD();
};

window.startGame = function() {
    // ホストのみが開始できる
    if (isMultiplayer && !Networking.isHost) return; 

    gameState.enemies = [];
    gameState.enemiesKilled = 0;
    
    gameState.players.forEach((p, index) => {
        p.health = 5;
        p.score = 0;
        p.totalScoreEarned = 0;
        p.bullets = [];
        // 初期位置を再設定
        p.x = GAME_WIDTH / (gameState.players.length + 1) * (index + 1);
        p.predictedX = p.x; 
    });

    gameRunning = true;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'none';
    
    // ホストまたはシングルプレイの場合に敵をスポーン
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
        // 1. クライアント側での移動予測 (マルチプレイでのラグ隠し)
        localUpdateMovement(deltaTime);
        
        // 2. 入力収集と送信 (マルチプレイ時のみホストへ送信)
        collectAndSendInput();
        
        if (Networking.isHost) {
            // 3A. ホスト: サーバーロジックを実行し、状態をクライアントに送信
            Networking.simulateServerTick(deltaTime);
        } else if (!isMultiplayer) {
             // 3B. シングルプレイ: ホストロジックをローカルで実行
            localGameTick(deltaTime);
        }
        // クライアントはホストからの状態受信を待つのみ

        // 4. 描画
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
