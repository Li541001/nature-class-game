const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// 題目資料庫 (加入 category 屬性)
const questionDB = [
    { category: "地球奇觀區", id: 0, text: "根據圖(一)，深海熱泉生態系的能量來源主要為何？", options: { A: "太陽能", B: "地熱化學能", C: "洋流衝擊" }, answer: "B" },
    { category: "地球奇觀區", id: 1, text: "溫室效應的主要氣體中，哪一種與人類工業活動最相關？", options: { A: "水氣", B: "二氧化碳", C: "臭氧" }, answer: "B" },
    { category: "地球奇觀區", id: 2, text: "根據圖(二)，高山凍原的植物型態主要是為了適應什麼？", options: { A: "強風與低溫", B: "缺乏光照", C: "過度潮濕" }, answer: "A" },
    { category: "未來環境區", id: 3, text: "登陸月球南極的主要目標是尋找何種重要資源？", options: { A: "黃金礦脈", B: "水冰資源", C: "稀土金屬" }, answer: "B" }
];

let gameState = {
    activeQuestionId: null, 
    revealedQuestions: [],  
    players: {}
};

io.on('connection', (socket) => {
    
    // 初始化連線
    socket.emit('init_game', { questions: questionDB, state: gameState });

    socket.on('join_game', (data) => {
        const { uuid, name } = data;
        if (!gameState.players[uuid]) {
            gameState.players[uuid] = { 
                name, chips: 1000, 
                bets: {}, 
                locked: {} 
            };
        }
        socket.emit('sync_state', gameState);
    });

    // 玩家下注並鎖定
    socket.on('lock_bet', (data) => {
        const { uuid, qId, bets } = data;
        let player = gameState.players[uuid];
        
        if (player && gameState.activeQuestionId === qId && !player.locked[qId]) {
            player.bets[qId] = bets;
            let totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
            
            player.chips -= totalBet;
            player.locked[qId] = true;
            
            socket.emit('sync_state', gameState); 
        }
    });

    // ====== 裁判功能 ======
    socket.on('referee_open_question', (qId) => {
        gameState.activeQuestionId = parseInt(qId);
        io.emit('sync_state', gameState);
    });

    socket.on('referee_reveal_question', () => {
        let qId = gameState.activeQuestionId;
        if (qId === null) return;

        let question = questionDB.find(q => q.id === qId);
        let correctAnswer = question.answer;

        for (let key in gameState.players) {
            let player = gameState.players[key];
            if (player.locked[qId]) {
                let winAmount = player.bets[qId][correctAnswer] || 0;
                if (winAmount > 0) {
                    player.chips += (winAmount * 2); 
                }
            }
        }

        gameState.revealedQuestions.push(qId);
        gameState.activeQuestionId = null; 

        io.emit('sync_state', gameState);
    });
});

server.listen(3000, () => {
    console.log('🌳 遊樂園伺服器啟動：http://localhost:3000');
});