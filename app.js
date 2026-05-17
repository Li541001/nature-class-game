const socket = io();

let myUUID = sessionStorage.getItem('nature_park_uuid');
if (!myUUID) {
    myUUID = 'uuid_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('nature_park_uuid', myUUID);
}

const isReferee = new URLSearchParams(window.location.search).get('role') === 'referee';

let localChips = 0;
let localBets = {}; 
let questionDB = [];
let currentState = null; 
let localZeroBetError = {}; 
let leaderboardShown = false; 

// ✨ 自動登入：有紀錄就直接進遊戲
document.addEventListener("DOMContentLoaded", () => {
    let myName = sessionStorage.getItem('nature_park_name');
    if (myName && !isReferee) {
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('playerInfo').style.display = 'block';
        socket.emit('join_game', { uuid: myUUID, name: myName });
    }

    const loginInput = document.getElementById('loginInput');
    if (loginInput) {
        loginInput.addEventListener('input', function() {
            this.style.borderColor = 'var(--gold)';
            this.style.boxShadow = '0 0 20px rgba(215, 179, 93, 0.2), inset 0 2px 10px rgba(0,0,0,0.5)';
            this.placeholder = '輸入暱稱';
        });
    }
});

function joinGame() {
    const inputEl = document.getElementById('loginInput');
    const input = inputEl.value.trim();

    // ✨ 暱稱防呆：紅框警告，移除了 shake 特效
    if (!input) {
        inputEl.style.borderColor = 'var(--danger)';
        inputEl.style.boxShadow = '0 0 15px rgba(255, 102, 102, 0.6), inset 0 2px 10px rgba(0,0,0,0.5)';
        inputEl.placeholder = '請務必輸入暱稱';
        return;
    }

    if (input === '931006') { 
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('refPanel').style.display = 'flex';
        return;
    }

    sessionStorage.setItem('nature_park_name', input);
    
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('playerInfo').style.display = 'block';
    
    socket.emit('join_game', { uuid: myUUID, name: input });
}

socket.on('init_game', (data) => {
    questionDB = data.questions;
    const container = document.getElementById('questions-container');
    const refSelect = document.getElementById('refQSelect');
    
    container.innerHTML = '';
    refSelect.innerHTML = '';

    const grouped = {};
    questionDB.forEach(q => {
        if(!grouped[q.category]) grouped[q.category] = [];
        grouped[q.category].push(q);
        refSelect.innerHTML += `<option value="${q.id}">[${q.category.substring(0,6)}] Q${q.id+1}...</option>`;
    });

    for(let cat in grouped) {
        container.innerHTML += `<div class="category-header"><span>✦</span> ${cat}</div>`;
        
        grouped[cat].forEach(q => {
            let optionsHTML = '';
            for (let key in q.options) {
                optionsHTML += `
                    <div class="option-row" id="opt-row-${q.id}-${key}">
                        <span>${key}. ${q.options[key]}</span>
                        <div class="bet-controls">
                            <button class="btn-circle bet-btn-${q.id}" onclick="changeBet(${q.id}, '${key}', -50)">-</button>
                            <span class="bet-val" id="bet-${q.id}-${key}">0</span>
                            <button class="btn-circle bet-btn-${q.id}" onclick="changeBet(${q.id}, '${key}', 50)">+</button>
                        </div>
                    </div>
                `;
            }

            container.innerHTML += `
                <div class="question-card disabled" id="q-card-${q.id}">
                    <div class="q-status" id="q-status-${q.id}">加密鎖定中</div>
                    <div class="q-text scramble-target" id="q-text-${q.id}" data-original="${q.id + 1}. ${q.text}" data-scrambling="true"></div>
                    ${optionsHTML}
                    
                    <div class="q-result" id="q-result-${q.id}" style="display:none; margin-top: 15px; font-size: 16px; font-weight: bold; text-align: center; padding: 12px; border-radius: 8px; letter-spacing: 1px;"></div>
                    
                    <button class="btn-submit" id="btn-lock-${q.id}" onclick="lockBet(${q.id})">確認下注</button>
                </div>
            `;
        });
    }
});

function changeBet(qId, option, amount) {
    if (currentState && currentState.revealedQuestions.includes(qId)) return;
    let myData = currentState ? currentState.players[myUUID] : null;
    if (myData && myData.locked[qId]) return;

    localZeroBetError[qId] = false;
    const status = document.getElementById(`q-status-${qId}`);
    if (status && status.innerText.includes("請輸入籌碼")) {
        status.innerText = "🟢 開放作答中";
        status.style.background = "rgba(107, 209, 124, 0.1)";
        status.style.color = "var(--ok)";
        status.style.borderColor = "rgba(107, 209, 124, 0.4)";
    }

    if (!localBets[qId]) localBets[qId] = { A:0, B:0, C:0, D:0 };
    
    const card = document.getElementById(`q-card-${qId}`);
    let currentTotalBet = Object.values(localBets[qId]).reduce((a, b) => a + b, 0);
    let newBet = localBets[qId][option] + amount;
    
    if (newBet < 0) return;
    if (amount > 0 && currentTotalBet + amount > localChips) {
        status.innerText = "⚠️ 籌碼不足";
        status.style.background = "rgba(255, 102, 102, 0.15)";
        status.style.color = "var(--danger)";
        status.style.borderColor = "var(--danger)";
        card.className = "question-card active error-bet";
        return
    }else{
        status.innerText = "🟢 開放作答中";
        status.style.background = "rgba(107, 209, 124, 0.1)";
        status.style.color = "var(--ok)";
        status.style.borderColor = "rgba(107, 209, 124, 0.4)";
        card.className = "question-card active";
    }

    localBets[qId][option] = newBet;
    document.getElementById(`bet-${qId}-${option}`).innerText = newBet;
    
    let previewChips = localChips - (currentTotalBet + amount);
    document.getElementById('playerChips').innerText = previewChips;
}

function lockBet(qId) {
    if (!localBets[qId]) localBets[qId] = { A:0, B:0, C:0, D:0 };
    let totalBet = Object.values(localBets[qId]).reduce((a, b) => a + b, 0);
    
    // ✨ 籌碼防呆：沒輸入籌碼按確認，變紅顯示「請輸入籌碼」，移除了 shake 特效
    if (totalBet === 0) {
        localZeroBetError[qId] = true;
        
        const status = document.getElementById(`q-status-${qId}`);
        const card = document.getElementById(`q-card-${qId}`);
        
        status.innerText = "⚠️ 請輸入籌碼";
        status.style.background = "rgba(255, 102, 102, 0.15)";
        status.style.color = "var(--danger)";
        status.style.borderColor = "var(--danger)";
        card.className = "question-card active error-bet";
        
        return;
    }

    socket.emit('lock_bet', { uuid: myUUID, qId: qId, bets: localBets[qId] });
}

function showLeaderboard(playersObj) {
    const playersArray = Object.values(playersObj);
    playersArray.sort((a, b) => b.chips - a.chips); 
    
    const top10 = playersArray.slice(0, 10);
    const list = document.getElementById('leaderboardList');
    list.innerHTML = '';
    
    top10.forEach((p, index) => {
        let rankClass = index === 0 ? 'rank-1' : (index === 1 ? 'rank-2' : (index === 2 ? 'rank-3' : ''));
        let medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `<span style="display:inline-block; width:24px; text-align:center; color:var(--muted);">${index+1}.</span>`));
        list.innerHTML += `
            <li class="rank-item ${rankClass}">
                <span style="font-weight: bold; color: #fff;">${medal} ${p.name}</span>
                <span style="color: var(--gold); font-weight: bold;">💰 ${p.chips}</span>
            </li>
        `;
    });
    
    document.getElementById('leaderboardModal').style.display = 'flex';
}


// 同步伺服器狀態
socket.on('sync_state', (state) => {
    currentState = state; 
    let myData = state.players[myUUID];
    
    if (myData) {
        document.getElementById('playerName').innerText = myData.name;
        localChips = myData.chips;
        document.getElementById('playerChips').innerText = localChips;
        
        // ✨ 新增：計算並即時更新畫面上方的個人名次
        const sortedPlayers = Object.entries(state.players).sort((a, b) => b[1].chips - a[1].chips);
        const myRank = sortedPlayers.findIndex(entry => entry[0] === myUUID) + 1;
        const rankEl = document.getElementById('playerRank');
        if (rankEl) rankEl.innerText = myRank;
    }

    questionDB.forEach(q => {
        const card = document.getElementById(`q-card-${q.id}`);
        const status = document.getElementById(`q-status-${q.id}`);
        const lockBtn = document.getElementById(`btn-lock-${q.id}`);
        const textEl = document.getElementById(`q-text-${q.id}`);
        const resultEl = document.getElementById(`q-result-${q.id}`);
        const betBtns = document.querySelectorAll(`.bet-btn-${q.id}`); 
        
        let isLocked = myData ? myData.locked[q.id] : false;
        let serverBets = myData ? myData.bets[q.id] : null;

        // 狀態 1：結算公佈
        if (state.revealedQuestions.includes(q.id)) {
            card.className = "question-card revealed";
            status.innerText = "已結算";
            
            status.style.background = "";
            status.style.color = "";
            status.style.borderColor = "";

            lockBtn.style.display = "none";
            textEl.dataset.scrambling = "false";
            textEl.innerText = textEl.dataset.original; 
            
            betBtns.forEach(btn => { btn.disabled = true; btn.style.opacity = '0.2'; btn.style.cursor = 'not-allowed'; });
            
            document.getElementById(`opt-row-${q.id}-${q.answer}`).classList.add('correct');
            
            for (let key in q.options) {
                let finalBet = (serverBets && serverBets[key]) ? serverBets[key] : 0;
                document.getElementById(`bet-${q.id}-${key}`).innerText = finalBet;
                
                if (key !== q.answer) {
                    document.getElementById(`opt-row-${q.id}-${key}`).classList.add('wrong');
                }
            }

            resultEl.style.display = "block";
            if (!isLocked && localBets[q.id] && Object.values(localBets[q.id]).reduce((a,b)=>a+b,0) > 0) {
                status.innerText = "未確認，已退還籌碼";
                status.style.background = "rgba(255,102,102,0.2)";
                status.style.color = "var(--danger)";
                status.style.borderColor = "var(--danger)";
                
                resultEl.style.background = "rgba(255, 255, 255, 0.1)";
                resultEl.style.color = "#fff";
                resultEl.innerText = "➖ 未確認下注，籌碼已全數退還 (±0)";
                localBets[q.id] = null; 
            } else if (isLocked && serverBets) {
                let winAmount = serverBets[q.answer] || 0;
                let totalBet = Object.values(serverBets).reduce((a,b)=>a+b, 0);
                let netChips = (winAmount * 2) - totalBet; 

                if (netChips > 0) {
                    resultEl.style.background = "rgba(107, 209, 124, 0.15)";
                    resultEl.style.color = "var(--ok)";
                    resultEl.innerText = `✅ 本題結算：+${netChips} 籌碼`;
                } else if (netChips < 0) {
                    resultEl.style.background = "rgba(255, 102, 102, 0.15)";
                    resultEl.style.color = "var(--danger)";
                    resultEl.innerText = `❌ 本題結算：${netChips} 籌碼`;
                } else {
                    resultEl.style.background = "rgba(255, 255, 255, 0.1)";
                    resultEl.style.color = "#fff";
                    resultEl.innerText = `➖ 本題結算：±0 籌碼`;
                }
            }

        } 
        // 狀態 2：開放作答中
        else if (state.activeQuestionId === q.id) {
            textEl.dataset.scrambling = "false";
            textEl.innerText = textEl.dataset.original; 
            resultEl.style.display = "none"; 

            if (isLocked) {
                card.className = "question-card active locked-bet";
                status.innerText = "⚠️ 已確認下注";
                
                status.style.background = "rgba(215, 179, 93, 0.2)";
                status.style.color = "var(--gold)";
                status.style.borderColor = "var(--gold)";

                lockBtn.disabled = true;
                lockBtn.innerText = "下注完成";
                betBtns.forEach(btn => { btn.disabled = true; btn.style.opacity = '0.2'; btn.style.cursor = 'not-allowed'; });
            } else {
                if (localZeroBetError[q.id]) {
                    card.className = "question-card active error-bet";
                    status.innerText = "⚠️ 請輸入籌碼";
                    status.style.background = "rgba(255, 102, 102, 0.15)";
                    status.style.color = "var(--danger)";
                    status.style.borderColor = "var(--danger)";
                } else {
                    card.className = "question-card active";
                    status.innerText = "🟢 開放作答中";
                    
                    status.style.background = "rgba(107, 209, 124, 0.1)";
                    status.style.color = "var(--ok)";
                    status.style.borderColor = "rgba(107, 209, 124, 0.4)";
                }

                lockBtn.disabled = false;
                lockBtn.innerText = "確認下注";
                betBtns.forEach(btn => { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; });
            }
        } 
        // 狀態 3：未開放
        else {
            card.className = "question-card disabled";
            status.innerText = "等待開放";
            status.style.background = "";
            status.style.color = "";
            status.style.borderColor = "";
            textEl.dataset.scrambling = "true"; 
            resultEl.style.display = "none";
            betBtns.forEach(btn => { btn.disabled = true; btn.style.opacity = '0.2'; btn.style.cursor = 'not-allowed'; });
        }
    });

    if (questionDB.length > 0 && state.revealedQuestions.length === questionDB.length) {
        document.getElementById('btn-leaderboard').style.display = 'inline-block';
        if (!leaderboardShown) {
            showLeaderboard(state.players);
            leaderboardShown = true;
        }
    } else {
        document.getElementById('btn-leaderboard').style.display = 'none';
    }
});

const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#%&?!<>";
setInterval(() => {
    document.querySelectorAll('.scramble-target').forEach(el => {
        if (el.dataset.scrambling === "true") {
            const original = el.dataset.original;
            let scrambled = "";
            for(let i=0; i<original.length; i++) {
                if(original[i] === ' ' || original[i] === '，' || original[i] === '？' || original[i] === '。') {
                    scrambled += original[i];
                } else {
                    scrambled += characters.charAt(Math.floor(Math.random() * characters.length));
                }
            }
            el.innerText = scrambled;
        }
    });
}, 60);

// ====== 裁判專用函數 ======
function refOpenBet() {
    const qIdStr = document.getElementById('refQSelect').value;
    const qId = parseInt(qIdStr); // 轉換成數字，避免比對錯誤
    
    // ✨ 修復：真正發揮作用的裁判防呆機制 (已結算的題目跳出 alert)
    if (currentState && currentState.revealedQuestions.includes(qId)) {
        alert('提醒：此題目已經結算完畢，無法重新開放作答！');
        return;
    }
    
    socket.emit('referee_open_question', qId);
    window.location.hash = `#q-card-${qId}`;
}

function refReveal() {
    const qIdStr = document.getElementById('refQSelect').value;
    const qId = parseInt(qIdStr); // 轉換成數字，避免比對錯誤
    console.log(currentState)
    if (currentState && currentState.revealedQuestions.includes(qId)) {
        alert('提醒：此題目已經結算完畢，無法重新結算！');
        return;
    }
    if(currentState && currentState.activeQuestionId != qIdStr){
        alert('提醒：此題目還未開啟，無法結算！');
        return;
    }
    socket.emit('referee_reveal_question');
}