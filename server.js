const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ==========================================
// 1. 伺服器初始化
// ==========================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ==========================================
// 2. 資料庫與全域狀態 (State Management)
// ==========================================
const questionDB = [
    { category: "地球奇觀區", id: 0, text: "根據圖(一)，深海熱泉生態系的能量來源主要為何？", options: { A: "太陽能", B: "地熱化學能", C: "洋流衝擊" }, answer: "B" },
    { category: "地球奇觀區", id: 1, text: "溫室效應的主要氣體中，哪一種與人類工業活動最相關？", options: { A: "水氣", B: "二氧化碳", C: "臭氧" }, answer: "B" },
    { category: "地球奇觀區", id: 2, text: "根據圖(二)，高山凍原的植物型態主要是為了適應什麼？", options: { A: "強風與低溫", B: "缺乏光照", C: "過度潮濕" }, answer: "A" },
    { category: "未來環境區", id: 3, text: "登陸月球南極的主要目標是尋找何種重要資源？", options: { A: "黃金礦脈", B: "水冰資源", C: "稀土金屬" }, answer: "B" }
];

const gameState = {
    activeQuestionId: null, 
    revealedQuestions: [],  
    players: {}
};

// ==========================================
// 3. Socket.io 事件監聽與處理
// ==========================================
io.on('connection', (socket) => {
    
    // [連線初始化] 傳送初始題目與狀態給新玩家
    socket.emit('init_game', { questions: questionDB, state: gameState });

    // [玩家加入] 註冊玩家資訊
    socket.on('join_game', (data) => {
        const { uuid, name } = data;
        
        // 若為新玩家則初始化資料結構
        if (!gameState.players[uuid]) {
            gameState.players[uuid] = { 
                name: name, 
                chips: 1000, 
                bets: {}, 
                locked: {} 
            };
        }
        socket.emit('sync_state', gameState);
    });

    // [玩家下注] 驗證並鎖定玩家的下注
    socket.on('lock_bet', (data) => {
        const { uuid, qId, bets } = data;
        const player = gameState.players[uuid];
        
        // 安全驗證：確保玩家存在、題目開放中，且尚未鎖定
        if (player && gameState.activeQuestionId === qId && !player.locked[qId]) {
            player.bets[qId] = bets;
            const totalBet = Object.values(bets).reduce((sum, bet) => sum + bet, 0);
            
            player.chips -= totalBet;
            player.locked[qId] = true;
            
            socket.emit('sync_state', gameState); 
        }
    });

    // ==========================================
    // 4. 裁判專用功能 (Admin Controls)
    // ==========================================
    
    // [裁判] 開放特定題目作答
    socket.on('referee_open_question', (qId) => {
        gameState.activeQuestionId = parseInt(qId, 10);
        io.emit('sync_state', gameState);
    });

    // [裁判] 結束作答並全域結算
    socket.on('referee_reveal_question', () => {
        const qId = gameState.activeQuestionId;
        if (qId === null) return;

        const question = questionDB.find(q => q.id === qId);
        if (!question) return;

        const correctAnswer = question.answer;

        // 遍歷所有玩家進行結算
        for (let uuid in gameState.players) {
            let player = gameState.players[uuid];
            
            // 只有確實按下「確認下注」的玩家才給予獎勵計算
            if (player.locked[qId]) {
                let winAmount = player.bets[qId][correctAnswer] || 0;
                if (winAmount > 0) {
                    player.chips += (winAmount * 2); // 歸還本金 + 1倍獎金
                }
            }
        }

        // 狀態更新：加入已結算清單並關閉當前題目
        gameState.revealedQuestions.push(qId);
        gameState.activeQuestionId = null; 

        // 廣播給所有客戶端更新畫面
        io.emit('sync_state', gameState);
    });
});

// ==========================================
// 5. 啟動伺服器
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌳 伺服器啟動：http://localhost:${PORT}`);
});