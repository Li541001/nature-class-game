const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// 題目資料庫
const questionDB = [
    { id: 0, text: "根據圖(一)，深海熱泉生態系的能量來源主要為何？", options: { A: "太陽能", B: "地熱化學能", C: "洋流衝擊" }, answer: "B" },
    { id: 1, text: "溫室效應的主要氣體中，哪一種與人類工業活動最相關？", options: { A: "水氣", B: "二氧化碳", C: "臭氧" }, answer: "B" },
    { id: 2, text: "根據圖(二)，高山凍原的植物型態主要是為了適應什麼？", options: { A: "強風與低溫", B: "缺乏光照", C: "過度潮濕" }, answer: "A" }
];

let gameState = {
    activeQuestionId: null, // 目前開放下注的題目 ID
    revealedQuestions: [],  // 已結算的題目 ID 陣列
    players: {}
};

io.on('connection', (socket) => {
    
    // 初始化連線，發送所有題目給前端渲染
    socket.emit('init_game', { questions: questionDB, state: gameState });

    socket.on('join_game', (data) => {
        const { uuid, name } = data;
        if (!gameState.players[uuid]) {
            gameState.players[uuid] = { 
                name, chips: 1000, 
                bets: {}, // 紀錄每一題的下注：{ qId: { A:50, B:0... } }
                locked: {} // 紀錄每一題是否已確認：{ qId: true/false }
            };
        }
        socket.emit('sync_state', gameState);
    });

    // 玩家送出下注並鎖定
    socket.on('lock_bet', (data) => {
        const { uuid, qId, bets } = data;
        let player = gameState.players[uuid];
        
        // 只有該題開放中，且尚未鎖定才能下注
        if (player && gameState.activeQuestionId === qId && !player.locked[qId]) {
            player.bets[qId] = bets;
            let totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
            
            // 伺服器端在此刻才真正扣除籌碼
            player.chips -= totalBet;
            player.locked[qId] = true;
            
            socket.emit('sync_state', gameState); // 更新自己
        }
    });

    // ====== 裁判功能 ======
    socket.on('referee_open_question', (qId) => {
        gameState.activeQuestionId = parseInt(qId);
        // 如果重新開放，不清除已鎖定的玩家，讓還沒下注的人可以下注
        io.emit('sync_state', gameState);
    });

    socket.on('referee_reveal_question', () => {
        let qId = gameState.activeQuestionId;
        if (qId === null) return;

        let question = questionDB.find(q => q.id === qId);
        let correctAnswer = question.answer;

        // 結算分數
        for (let key in gameState.players) {
            let player = gameState.players[key];
            
            // 重要邏輯：如果玩家「沒有按確認鎖定」，就當作沒作答。
            // 因為伺服器是在 lock_bet 時才扣籌碼，所以只要他沒 lock，籌碼根本沒扣！
            // 我們只需確保不發獎金給他即可，籌碼自然就等於退還了。
            if (player.locked[qId]) {
                let winAmount = player.bets[qId][correctAnswer] || 0;
                if (winAmount > 0) {
                    player.chips += (winAmount * 2); // 拿回本金並獲得一倍獎金
                }
            }
        }

        gameState.revealedQuestions.push(qId);
        gameState.activeQuestionId = null; // 關閉目前題目

        io.emit('sync_state', gameState);
    });
});

server.listen(3000, () => {
    console.log('🌳 遊樂園伺服器啟動：http://localhost:3000');
});