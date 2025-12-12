// ... (現在の script.js の内容)

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
            'playlist': '' 
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
        event.target.cueVideoById({
             videoId: currentVideoId,
             playlist: currentVideoId
        });
        statusElement.textContent = 'ステータス: ロード完了。ゲーム開始で再生されます。';
    } else if (statusElement) {
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
        ytPlayer.loadVideoById({
             videoId: videoId,
             playlist: videoId 
        });
    } else {
        statusElement.textContent = 'ステータス: プレイヤーAPIがまだ準備できていません。';
    }
}

// ... (現在の script.js の内容)
// ... (次に、ロビー画面が必要なため、以下の関数定義を追加/修正します)

// --- ロビー/ゲーム開始/終了の制御関数 ---

// ★追加: ロビー画面を表示する関数
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

    // (必要であれば) ロードボタンの表示を更新するロジックをここに
};

// ★修正: ゲーム開始時に音楽を再生
window.startGame = function(load = false) { 
    // ... (既存の初期化/ロードロジック) ...
    
    // 音楽の再生ロジック
    if (ytPlayer && currentVideoId) {
        if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
             ytPlayer.setVolume(20); 
             ytPlayer.playVideo();
        }
    }
    
    // ... (既存の画面表示/非表示ロジック) ...
};

// ★修正: ゲームオーバー時に音楽を停止
function gameOver() {
    gameRunning = false;
    
    // 音楽を停止
    if (ytPlayer && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }

    document.getElementById('final-score').textContent = Math.floor(score); 
    document.getElementById('game-over-screen').style.display = 'flex';
}

// ★追加: 終了ボタン用
window.exitGame = function() { 
    if (confirm(`ゲームを終了してロビーに戻りますか？`)) {
        gameRunning = false;
        isUpgrading = false;
        window.showLobby(); 
    }
}

// ★修正: 初期化処理でロビーを表示
// (現在の gameLoop(0) の呼び出しの代わりに、以下を追加/修正)
window.onload = function() {
    window.showLobby();
    requestAnimationFrame(gameLoop); 
};
