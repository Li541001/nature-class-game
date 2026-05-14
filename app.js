const socket = io();

let myUUID = localStorage.getItem('nature_park_uuid');
if (!myUUID) {
    myUUID = 'uuid_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('nature_park_uuid', myUUID);
}

const isReferee = new URLSearchParams(window.location.search).get('role') === 'referee';

let localChips = 0;
let localBets = {}; // 暫存當下還沒確認的下注 { qId: { A:50, B:0 } }
let questionDB = [];

// 登入邏輯
function joinGame() {
    const input = document.getElementById('loginInput').value;
    if (!input) return alert('請輸入內容');

    if (input === '931006') { // 裁判密碼
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('refPanel').style.display = 'flex';
        return;
    }

    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('playerInfo').style.display = 'block';
    
    socket.emit('join_game', { uuid: myUUID, name: input });
}

// 初始化渲染所有題目
socket.on('init_game', (data) => {
    questionDB = data.questions;
    const container = document.getElementById('questions-container');
    const refSelect = document.getElementById('refQSelect');
    
    container.innerHTML = '';
    refSelect.innerHTML = '';

    questionDB.forEach((q, index) => {
        // 裁判選單
        refSelect.innerHTML += `<option value="${q.id}">第 ${index+1} 題：${q.text.substring(0,10)}...</option>`;
        
        // 玩家畫面
        let optionsHTML = '';
        for (let key in q.options) {
            optionsHTML += `
                <div class="option-row" id="opt-row-${q.id}-${key}">
                    <span>${key}. ${q.options[key]}</span>
                    <div class="bet-controls">
                        <button class="btn-circle" onclick="changeBet(${q.id}, '${key}', -50)">-</button>
                        <span class="bet-val" id="bet-${q.id}-${key}">0</span>
                        <button class="btn-circle" onclick="changeBet(${q.id}, '${key}', 50)">+</button>
                    </div>
                </div>
            `;
        }

        container.innerHTML += `
            <div class="question-card disabled" id="q-card-${q.id}">
                <div class="q-status" id="q-status-${q.id}">等待開放</div>
                <div class="q-text">${index + 1}. ${q.text}</div>
                ${optionsHTML}
                <button class="btn-submit" id="btn-lock-${q.id}" onclick="lockBet(${q.id})">確認下注</button>
            </div>
        `;
    });
});

// 籌碼增減 (只在本地端預覽，尚未發送)
function changeBet(qId, option, amount) {
    if (!localBets[qId]) localBets[qId] = { A:0, B:0, C:0, D:0 };
    
    let currentTotalBet = Object.values(localBets[qId]).reduce((a, b) => a + b, 0);
    let newBet = localBets[qId][option] + amount;
    
    if (newBet < 0) return;
    if (amount > 0 && currentTotalBet + amount > localChips) return alert('籌碼不足！');

    localBets[qId][option] = newBet;
    document.getElementById(`bet-${qId}-${option}`).innerText = newBet;
    
    // 即時預覽餘額
    let previewChips = localChips - (currentTotalBet + amount);
    document.getElementById('playerChips').innerText = previewChips;
}

// 鎖定並送出下注
function lockBet(qId) {
    if (!localBets[qId]) localBets[qId] = { A:0, B:0, C:0, D:0 };
    socket.emit('lock_bet', { uuid: myUUID, qId: qId, bets: localBets[qId] });
}

// 同步伺服器狀態 (核心 UI 變化)
socket.on('sync_state', (state) => {
    let myData = state.players[myUUID];
    
    if (myData) {
        document.getElementById('playerName').innerText = myData.name;
        localChips = myData.chips;
        document.getElementById('playerChips').innerText = localChips;
    }

    questionDB.forEach(q => {
        const card = document.getElementById(`q-card-${q.id}`);
        const status = document.getElementById(`q-status-${q.id}`);
        const lockBtn = document.getElementById(`btn-lock-${q.id}`);
        
        let isLocked = myData ? myData.locked[q.id] : false;
        let serverBets = myData ? myData.bets[q.id] : null;

        // 狀態 1：已結算 (Revealed)
        if (state.revealedQuestions.includes(q.id)) {
            card.className = "question-card revealed";
            status.innerText = "已結算";
            lockBtn.style.display = "none";
            
            // 標示正確答案
            document.getElementById(`opt-row-${q.id}-${q.answer}`).classList.add('correct');
            
            // 顯示玩家最終結果
            for (let key in q.options) {
                let finalBet = (serverBets && serverBets[key]) ? serverBets[key] : 0;
                document.getElementById(`bet-${q.id}-${key}`).innerText = finalBet;
                if (key !== q.answer && finalBet > 0) {
                    document.getElementById(`opt-row-${q.id}-${key}`).classList.add('wrong');
                }
            }

            // 處理「未按確認，籌碼退還」的顯示
            if (!isLocked && localBets[q.id] && Object.values(localBets[q.id]).reduce((a,b)=>a+b,0) > 0) {
                status.innerText = "未確認，已退還籌碼";
                status.style.background = "var(--danger)";
                status.style.color = "white";
                localBets[q.id] = null; // 清除暫存
            }

        } 
        // 狀態 2：目前開放中 (Active)
        else if (state.activeQuestionId === q.id) {
            card.className = "question-card active";
            if (isLocked) {
                status.innerText = "✅ 已確認下注";
                lockBtn.disabled = true;
                lockBtn.innerText = "下注完成";
            } else {
                status.innerText = "🟢 開放作答中";
                lockBtn.disabled = false;
                lockBtn.innerText = "確認下注";
            }
        } 
        // 狀態 3：未開放 (Waiting)
        else {
            card.className = "question-card disabled";
            status.innerText = "等待開放";
        }
    });
});

// ====== 裁判專用函數 ======
function refOpenBet() {
    const qId = document.getElementById('refQSelect').value;
    socket.emit('referee_open_question', qId);
    // 自動捲動到該題
    window.location.hash = `#q-card-${qId}`;
}
function refReveal() {
    socket.emit('referee_reveal_question');
}