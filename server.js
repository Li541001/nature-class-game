const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// ==========================================
// 1. 伺服器與資料庫初始化
// ==========================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
dotenv.config();

const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB 連線成功！'))
    .catch(err => console.error('❌ MongoDB 連線失敗：', err));

const playerSchema = new mongoose.Schema({
    uuid: { type: String, required: true, unique: true },
    name: String,
    chips: { type: Number, default: 1000 },
    bets: { type: Object, default: {} },
    locked: { type: Object, default: {} }
});
const Player = mongoose.model('Player', playerSchema);

// ==========================================
// 2. 遊戲全域狀態 (記憶體快取)
// ==========================================
const questionDB = [
    { category: "地球奇觀區", id: 0, text: "根據圖(一)，深海熱泉生態系的能量來源主要為何？", options: { A: "太陽能", B: "地熱化學能", C: "洋流衝擊" }, answer: "B" },
    { category: "地球奇觀區", id: 1, text: "溫室效應的主要氣體中，哪一種與人類工業活動最相關？", options: { A: "水氣", B: "二氧化碳", C: "臭氧" }, answer: "B" },
    { category: "地球奇觀區", id: 2, text: "根據圖(二)，高山凍原的植物型態主要是為了適應什麼？", options: { A: "強風與低溫", B: "缺乏光照", C: "過度潮濕" }, answer: "A" },
    { category: "未來環境區", id: 3, text: "登陸月球南極的主要目標是尋找何種重要資源？", options: { A: "黃金礦脈", B: "水冰資源", C: "稀土金屬" }, answer: "B" }
];

// 為了保持遊戲極速體驗，依然在記憶體維持一份當前狀態，但數據來源改為 DB
const gameState = {
    activeQuestionId: null, 
    revealedQuestions: [],  
    players: {} // 將從 MongoDB 載入
};

// 💡 輔助函數：從資料庫同步所有玩家狀態到記憶體
async function syncPlayersFromDB() {
    const players = await Player.find({});
    gameState.players = {};
    players.forEach(p => {
        gameState.players[p.uuid] = {
            name: p.name,
            chips: p.chips,
            bets: p.bets,
            locked: p.locked
        };
    });
    io.emit('sync_state', gameState);
}

// ==========================================
// 3. Socket.io 事件監聽與處理
// ==========================================
io.on('connection', (socket) => {
    
    socket.emit('init_game', { questions: questionDB, state: gameState });

    // [玩家加入] 
    socket.on('join_game', async (data) => {
        const { uuid, name } = data;
        
        // 💡 尋找玩家，若無則在 MongoDB 創建新玩家
        let player = await Player.findOne({ uuid });
        if (!player) {
            player = await Player.create({ uuid, name, chips: 1000 });
        }
        
        await syncPlayersFromDB(); // 更新畫面
    });

    // [玩家下注] 
    socket.on('lock_bet', async (data) => {
        const { uuid, qId, bets } = data;
        
        if (gameState.activeQuestionId === qId && !gameState.players[uuid]?.locked[qId]) {
            const totalBet = Object.values(bets).reduce((sum, bet) => sum + bet, 0);
            
            await Player.findOneAndUpdate(
                { uuid },
                { 
                    $inc: { chips: -totalBet }, // 扣除下注籌碼
                    $set: { 
                        [`bets.${qId}`]: bets, 
                        [`locked.${qId}`]: true 
                    }
                }
            );
            
            await syncPlayersFromDB(); // 更新畫面
        }
    });

    // ==========================================
    // 4. 裁判專用功能 (Admin Controls)
    // ==========================================
    socket.on('referee_open_question', (qId) => {
        gameState.activeQuestionId = parseInt(qId, 10);
        io.emit('sync_state', gameState);
    });

    // [裁判] 結束作答並全域結算
    socket.on('referee_reveal_question', async () => {
        const qId = gameState.activeQuestionId;
        if (qId === null) return;

        const question = questionDB.find(q => q.id === qId);
        const correctAnswer = question.answer;

        // 💡 取得所有有下注這題的玩家
        const players = await Player.find({});
        
        // 批次更新玩家的籌碼
        const bulkUpdates = [];
        players.forEach(player => {
            if (player.locked && player.locked[qId]) {
                let winAmount = player.bets[qId][correctAnswer] || 0;
                if (winAmount > 0) {
                    bulkUpdates.push({
                        updateOne: {
                            filter: { uuid: player.uuid },
                            update: { $inc: { chips: winAmount * 2 } } // 歸還本金 + 1倍獎金
                        }
                    });
                }
            }
        });

        // 💡 執行批次更新寫入資料庫
        if (bulkUpdates.length > 0) {
            await Player.bulkWrite(bulkUpdates);
        }

        gameState.revealedQuestions.push(qId);
        gameState.activeQuestionId = null; 

        await syncPlayersFromDB(); // 結算完畢，更新所有人畫面
    });
    // [裁判] 重新開始遊戲 (保留人員，但籌碼恢復1000，清空下注紀錄與題目狀態)
    socket.on('referee_reset_game', async () => {
        // 更新資料庫中所有玩家
        await Player.updateMany({}, {
            $set: { chips: 1000, bets: {}, locked: {} }
        });
        
        // 重置記憶體中的遊戲狀態
        gameState.activeQuestionId = null;
        gameState.revealedQuestions = [];
        
        await syncPlayersFromDB(); // 同步給所有人
        io.emit('game_reset'); // 廣播強制刷新指令
    });

    // [裁判] 清除所有人員 (刪除資料庫所有玩家資料)
    socket.on('referee_clear_players', async () => {
        // 清空 MongoDB 中的 Player 表
        await Player.deleteMany({});
        
        // 重置記憶體狀態
        gameState.activeQuestionId = null;
        gameState.revealedQuestions = [];
        gameState.players = {};
        
        await syncPlayersFromDB();
        io.emit('force_kick'); // 廣播踢人指令
    });
});

const PORT = process.env.PORT || 3000;
// 啟動前先載入一次資料庫資料
syncPlayersFromDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🌳 伺服器啟動：http://localhost:${PORT}`);
    });
});