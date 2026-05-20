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
    { category: "引言", id: 0, text: "請問哪位自然環保與人文思維課程老師？", options: { A: "蔡昱宇", B: "蔡煜宇", C: "蔡昱雨 " }, answer: "A" },
    { category: "引言", id: 1, text: "請問以下哪些是這次報告的區域？", options: { A: "季節限定區", B: "生態庇護所", C: "氣候調節區" }, answer: ["B", "C"] },
    { category: "月球登陸計畫", id: 2, text: "月世界的地貌是什麼？", options: { A: "惡地地貌 ", B: "喀斯特地貌", C: "火山地貌" }, answer: "A" },
    { category: "月球登陸計畫", id: 3, text: "月世界的形成的過程？", options: { A: "經由雨水與河水強烈侵蝕", B: "山撥地水土流失與走山", C: "泥沙、泥岩混和經過風化與沉積作用" }, answer: ["A", "C"] },
    { category: "淺入藍碳金庫", id: 4, text: "請問高美濕地有全台最大的...", options: { A: "彰化莞草區", B: "雲林莞草區", C: "嘉義莞草區" }, answer: "B" },
    { category: "淺入藍碳金庫", id: 5, text: "請問高美濕地屬於...", options: { A: "內陸濕地", B: "潮間帶濕地", C: "人工溼地" }, answer: "B" },
    { category: "千年呼吸之旅", id: 6, text: "市場上昂貴的扁柏是？", options: { A: "黃檜", B: "黑檜", C: "紅檜" }, answer: "A" },
    { category: "彩虹水幕秀", id: 7, text: "瀑布的什麼物質對人體有什麼幫助？", options: { A: "活氧", B: "多巴胺", C: "腦內啡", D: "芬多精" }, answer: ["A", "D"] },
    { category: "彩虹水幕秀", id: 8, text: "這部分的主講者是誰？", options: { A: "陳楷崴", B: "張楷崴", C: "林楷崴" }, answer: "C" },
    { category: "花之星光森林", id: 9, text: "請問螢火蟲幼蟲是什麼食性？", options: { A: "肉食性", B: "草食性", C: "雜食性" }, answer: "A" },
    { category: "花之星光森林", id: 10, text: "油桐花是什麼時期引入台灣的？", options: { A: "日治時期", B: "清朝時期", C: "民國初期" }, answer: "B" },
    { category: "生態諾亞方舟", id: 11, text: "植物園的主要功能是什麼？", options: { A: "用於研究、保育與教育的場所", B: "提供民眾休憩之公園", C: "研發與改良食用農作物產量的農業基地" }, answer: "A" },
    { category: "生態諾亞方舟", id: 12, text: "植物園大約有多少種植物？", options: { A: "4000種", B: "2000種", C: "1000種" }, answer: "B" },
    { category: "黃金稻浪畫布", id: 13, text: "請問忘憂谷的綠肥作物有什麼？", options: { A: "油菜花", B: "波斯菊", C: "大花咸豐草" }, answer: ["A", "B"] },
    { category: "黃金稻浪畫布", id: 14, text: "請問什麼樣的耕作方式更適合自然？", options: { A: "順應節氣，不過度使用", B: "一年間不間斷種植", C: "開心時就種，累了就閒置" }, answer: "A" },
    { category: "茶香秘境探險", id: 15, text: "請問穿梭在茶園間的小動物是誰？", options: { A: "台北樹蛙", B: "可達鴨", C: "翡翠樹蛙" }, answer: "C" },
    { category: "茶香秘境探險", id: 16, text: "快到尾聲了，請問到目前為止，哪個不是我們有介紹到的地方？", options: { A: "滿月圓", B: "桐花公園", C: "桃源谷" }, answer: "C" },
    { category: "尋找石虎嬌客", id: 17, text: "在蕉園裡面捕捉到可愛的身影，請問牠是？", options: { A: "貓咪", B: "石虎", C: "火斑喵" }, answer: "B" },
    { category: "尋找石虎嬌客", id: 18, text: "可以如何支持種植有機作物的農夫們？", options: { A: "到蕉園裡與農夫們聊天", B: "購買有友善石虎農作標章的產品", C: "隨意丟垃圾" }, answer: "B" }
];

// 為了保持遊戲極速體驗，依然在記憶體維持一份當前狀態，但數據來源改為 DB
const gameState = {
    activeQuestionId: null, 
    revealedQuestions: [],  
    players: {}, // 將從 MongoDB 載入
    reconnectMode: false // 裁判開啟後，玩家可用相同名稱接回原本資料
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

function normalizeName(name) {
    return String(name || '').trim();
}

// ==========================================
// 3. Socket.io 事件監聽與處理
// ==========================================
io.on('connection', (socket) => {
    
    socket.emit('init_game', { questions: questionDB, state: gameState });

    // [玩家加入] 
    socket.on('join_game', async (data) => {
    const uuid = data?.uuid;
    const name = normalizeName(data?.name);

    if (!uuid || !name) {
        socket.emit('join_error', '請輸入有效暱稱。');
        return;
    }

    // 1) 原本瀏覽器還保有 UUID：直接接回自己的資料
    let player = await Player.findOne({ uuid });
    if (player) {
        // 如果玩家想改成別人的名稱，要阻擋，避免撞名
        const duplicatedName = await Player.findOne({
            name,
            uuid: { $ne: uuid }
        });

        if (duplicatedName) {
            socket.emit('join_error', '此暱稱已被使用');
            return;
        }

        if (player.name !== name) {
            player.name = name;
            await player.save();
        }

        socket.emit('join_success', { uuid: player.uuid, name: player.name });
        await syncPlayersFromDB();
        return;
    }

    // 2) 沒有 UUID，但輸入了已存在名稱：只有裁判開啟重連模式時才允許接回
    const existingNamePlayer = await Player.findOne({ name });
    if (existingNamePlayer) {
        if (!gameState.reconnectMode) {
            socket.emit('join_error', '此暱稱已被使用');
            return;
        }

        socket.emit('join_success', { uuid: existingNamePlayer.uuid, name: existingNamePlayer.name });
        await syncPlayersFromDB();
        return;
    }

    // 3) 新暱稱：建立新玩家
    player = await Player.create({ uuid, name, chips: 1000 });
    socket.emit('join_success', { uuid: player.uuid, name: player.name });
    await syncPlayersFromDB();
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

        // ✨ 1. 將單選或多選統一轉換為陣列格式
        const correctAnswers = Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer];

        const players = await Player.find({});
        const bulkUpdates = [];
        players.forEach(player => {
            if (player.locked && player.locked[qId]) {
                
                // ✨ 2. 將押在「所有正確選項」上的籌碼加總起來
                let winAmount = 0;
                correctAnswers.forEach(ans => {
                    winAmount += player.bets[qId][ans] || 0;
                });
                
                if (winAmount > 0) {
                    bulkUpdates.push({
                        updateOne: {
                            filter: { uuid: player.uuid },
                            update: { $inc: { chips: winAmount * 2 } } 
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
    socket.on('referee_toggle_reconnect', (isEnabled) => {
    gameState.reconnectMode = Boolean(isEnabled);
    io.emit('sync_state', gameState);
});
});

const PORT = process.env.PORT || 3000;
// 啟動前先載入一次資料庫資料
syncPlayersFromDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🌳 伺服器啟動：http://localhost:${PORT}`);
    });
});