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
    { category: "月球登陸計畫", id: 3, text: "下列何者是今天提到月世界出現的動物？", options: { A: "老鷹", B: "蟒蛇", C: "穿山甲" }, answer: "C" },
    { category: "月球登陸計畫", id: 4, text: "月世界的形成的過程？", options: { A: "經由雨水與河水強烈侵蝕", B: "山撥地水土流失與走山", C: "泥沙、泥岩混和經過風化與沉積作用" }, answer: ["A", "C"] },
    { category: "淺入藍碳金庫", id: 5, text: "請問高美濕地有全台最大的...", options: { A: "彰化莞草區", B: "雲林莞草區", C: "嘉義莞草區" }, answer: "B" },
    { category: "淺入藍碳金庫", id: 6, text: "請問高美濕地屬於...", options: { A: "內陸濕地", B: "潮間帶濕地", C: "人工溼地" }, answer: "B" },
    { category: "淺入藍碳金庫", id: 7, text: "下列何者為濕地的功能？", options: { A: "大自然的水力發電廠", B: "大自然的快速排水通道", C: "大自然的濾水系統" }, answer: "C" },
    { category: "千年呼吸之旅", id: 8, text: "市場上昂貴的扁柏是？", options: { A: "黃檜", B: "黑檜", C: "紅檜" }, answer: "A" },
    { category: "彩虹水幕秀", id: 9, text: "瀑布的什麼物質對人體有什麼幫助？", options: { A: "活氧", B: "多巴胺", C: "腦內啡", D: "芬多精" }, answer: ["A", "D"] },
    { category: "彩虹水幕秀", id: 10, text: "這部分的主講者是誰？", options: { A: "陳楷崴", B: "張楷崴", C: "林楷崴" }, answer: "C" },
    { category: "花之星光森林", id: 11, text: "請問螢火蟲幼蟲是什麼食性？", options: { A: "肉食性", B: "草食性", C: "雜食性" }, answer: "A" },
    { category: "花之星光森林", id: 12, text: "油桐花是什麼時期引入台灣的？", options: { A: "日治時期", B: "清朝時期", C: "民國初期" }, answer: "A" },
    { category: "花之星光森林", id: 13, text: "螢火蟲不喜歡以下哪個環境？", options: { A: "無光害", B: "水質乾淨", C: "開闊草地" }, answer: "C" },
    { category: "生態諾亞方舟", id: 14, text: "下列何者不是今天簡報上方舟溫室群的瀕危植物？", options: { A: "艷紅鹿子百合", B: "桃園石龍尾", C: "長葉茅膏菜" }, answer: "B" },
    { category: "生態諾亞方舟", id: 15, text: "植物園的主要功能是什麼？", options: { A: "用於研究、保育與教育的場所", B: "提供民眾休憩之公園", C: "研發與改良食用農作物產量的農業基地" }, answer: "A" },
    { category: "生態諾亞方舟", id: 16, text: "植物園大約有多少種植物？", options: { A: "4000種", B: "2000種", C: "1000種" }, answer: "C" },
    { category: "黃金稻浪畫布", id: 17, text: "請問忘憂谷的綠肥作物有什麼？", options: { A: "油菜花", B: "波斯菊", C: "大花咸豐草" }, answer: ["A", "B"] },
    { category: "黃金稻浪畫布", id: 18, text: "請問忘憂谷的有機米叫什麼？", options: { A: "湖底米", B: "湖中米", C: "逢萊米" }, answer: "A" },
    { category: "黃金稻浪畫布", id: 19, text: "請問什麼樣的耕作方式更適合自然？", options: { A: "順應節氣，不過度使用", B: "一年間不間斷種植", C: "開心時就種，累了就閒置" }, answer: "A" },
    { category: "茶香秘境探險", id: 20, text: "請問穿梭在茶園間的小動物是誰？", options: { A: "台北樹蛙", B: "可達鴨", C: "翡翠樹蛙" }, answer: "A" },
    { category: "茶香秘境探險", id: 21, text: "坪林茶園茶園不施農藥與化肥是否正確？", options: { A: "O", B: "X", C: "擎天崗" }, answer: "A" },
    { category: "茶香秘境探險", id: 22, text: "快到尾聲了，請問到目前為止，哪個不是我們有介紹到的地方？", options: { A: "滿月圓", B: "桐花公園", C: "桃源谷" }, answer: "C" },
    { category: "尋找石虎嬌客", id: 23, text: "中寮蕉園是私人土地，不能隨意參觀知道嗎？ ", options: { A: "知道", B: "不知道" }, answer: "A" },
    { category: "尋找石虎嬌客", id: 24, text: "在蕉園裡面捕捉到可愛的身影，請問牠是？", options: { A: "貓咪", B: "石虎", C: "火斑喵" }, answer: "B" },
    { category: "尋找石虎嬌客", id: 25, text: "可以如何支持種植有機作物的農夫們？", options: { A: "到蕉園裡與農夫們聊天", B: "購買有友善石虎農作標章的產品", C: "隨意丟垃圾" }, answer: "B" }
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
});

const PORT = process.env.PORT || 3000;
// 啟動前先載入一次資料庫資料
syncPlayersFromDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🌳 伺服器啟動：http://localhost:${PORT}`);
    });
});