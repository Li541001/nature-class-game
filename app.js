const socket = io();

// ==========================================
// 1. 全域狀態管理 (State Management)
// ==========================================
const AppState = {
    uuid: sessionStorage.getItem('nature_park_uuid'),
    isReferee: new URLSearchParams(window.location.search).get('role') === 'referee',
    localChips: 0,
    localBets: {},
    questionDB: [],
    serverState: null,
    localZeroBetError: {},
    leaderboardShown: false
};

// ==========================================
// 2. 初始化流程 (Initialization)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initUUID();
    initAutoLogin();
    initInputListeners();
    initUIEffects(); // 將原本 HTML 裡的 UI 特效搬來這裡集中管理
    initScrambleEffect();
});

function initUUID() {
    if (!AppState.uuid) {
        AppState.uuid = 'uuid_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('nature_park_uuid', AppState.uuid);
    }
}

function initAutoLogin() {
    let myName = sessionStorage.getItem('nature_park_name');
    if (myName && !AppState.isReferee) {
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('playerInfo').style.display = 'block';
        socket.emit('join_game', { uuid: AppState.uuid, name: myName });
    }
}

function initInputListeners() {
    const loginInput = document.getElementById('loginInput');
    if (loginInput) {
        loginInput.addEventListener('input', function() {
            this.style.borderColor = 'var(--gold)';
            this.style.boxShadow = '0 0 20px rgba(215, 179, 93, 0.2), inset 0 2px 10px rgba(0,0,0,0.5)';
            this.placeholder = '輸入暱稱';
        });
    }
}

// ==========================================
// 3. UI 互動特效 (UI Effects & Animations)
// ==========================================
function initUIEffects() {
    // 捲動顯示進場特效 (Reveal on Scroll)
    const revealElements = document.querySelectorAll('.reveal-up, .reveal-left, .reveal-right');
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    revealElements.forEach(el => revealObserver.observe(el));

    // 捲動樹進度條 (Scroll Tree Progress)
    const treeFg = document.getElementById('scrollTreeFg');
    window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        const docHeight = document.body.scrollHeight - window.innerHeight;
        let scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        if(treeFg) treeFg.style.clipPath = `inset(${100 - scrollPercent}% 0 0 0)`;
    });
    window.dispatchEvent(new Event('scroll'));
}

function initScrambleEffect() {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#%&?!<>";
    setInterval(() => {
        document.querySelectorAll('.scramble-target').forEach(el => {
            if (el.dataset.scrambling === "true") {
                const original = el.dataset.original;
                let scrambled = "";
                for(let i = 0; i < original.length; i++) {
                    if('，？。'.includes(original[i])) {
                        scrambled += original[i];
                    } else {
                        scrambled += characters.charAt(Math.floor(Math.random() * characters.length));
                    }
                }
                el.innerText = scrambled;
            }
        });
    }, 60);
}

// ==========================================
// 4. 使用者操作邏輯 (User Actions)
// ==========================================
window.joinGame = function() {
    const inputEl = document.getElementById('loginInput');
    const input = inputEl.value.trim();

    // 防呆：未輸入暱稱
    if (!input) {
        inputEl.style.borderColor = 'var(--danger)';
        inputEl.style.boxShadow = '0 0 15px rgba(255, 102, 102, 0.6), inset 0 2px 10px rgba(0,0,0,0.5)';
        inputEl.placeholder = '請務必輸入暱稱';
        inputEl.classList.add('shake');
        setTimeout(() => inputEl.classList.remove('shake'), 400);
        return;
    }

    // 裁判登入通道
    if (input === '931006') { 
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('refPanel').style.display = 'flex';
        return;
    }

    sessionStorage.setItem('nature_park_name', input);
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('playerInfo').style.display = 'block';
    socket.emit('join_game', { uuid: AppState.uuid, name: input });
}

window.changeBet = function(qId, option, amount) {
    // 狀態驗證：是否允許修改
    if (AppState.serverState && AppState.serverState.revealedQuestions.includes(qId)) return;
    let myData = AppState.serverState ? AppState.serverState.players[AppState.uuid] : null;
    if (myData && myData.locked[qId]) return;

    // 清除0籌碼警告狀態
    AppState.localZeroBetError[qId] = false;
    resetQuestionStatusUI(qId);

    if (!AppState.localBets[qId]) AppState.localBets[qId] = { A:0, B:0, C:0, D:0 };
    
    let currentTotalBet = Object.values(AppState.localBets[qId]).reduce((a, b) => a + b, 0);
    let newBet = AppState.localBets[qId][option] + amount;
    
    if (newBet < 0) return;
    
    if (amount > 0 && currentTotalBet + amount > AppState.localChips) {
        showQuestionErrorUI(qId, "⚠️ 籌碼不足");
        return;
    } else {
        resetQuestionStatusUI(qId);
    }

    // 更新數據與畫面
    AppState.localBets[qId][option] = newBet;
    document.getElementById(`bet-${qId}-${option}`).innerText = newBet;
    
    let previewChips = AppState.localChips - (currentTotalBet + amount);
    document.getElementById('playerChips').innerText = previewChips;
}

window.lockBet = function(qId) {
    if (!AppState.localBets[qId]) AppState.localBets[qId] = { A:0, B:0, C:0, D:0 };
    let totalBet = Object.values(AppState.localBets[qId]).reduce((a, b) => a + b, 0);
    
    // 防呆：籌碼為0
    if (totalBet === 0) {
        AppState.localZeroBetError[qId] = true;
        showQuestionErrorUI(qId, "⚠️ 請輸入籌碼");
        
        const card = document.getElementById(`q-card-${qId}`);
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 400);
        return;
    }

    socket.emit('lock_bet', { uuid: AppState.uuid, qId: qId, bets: AppState.localBets[qId] });
}

// ==========================================
// 5. 畫面渲染與更新 (UI Rendering)
// ==========================================
function renderQuestions() {
    const container = document.getElementById('questions-container');
    const refSelect = document.getElementById('refQSelect');
    
    container.innerHTML = '';
    refSelect.innerHTML = '';

    const grouped = {};
    AppState.questionDB.forEach(q => {
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
}

function updateGameStateUI() {
    let myData = AppState.serverState.players[AppState.uuid];
    
    // 更新個人數值
    if (myData) {
        document.getElementById('playerName').innerText = myData.name;
        AppState.localChips = myData.chips;
        document.getElementById('playerChips').innerText = AppState.localChips;
        
        const sortedPlayers = Object.entries(AppState.serverState.players).sort((a, b) => b[1].chips - a[1].chips);
        const myRank = sortedPlayers.findIndex(entry => entry[0] === AppState.uuid) + 1;
        const rankEl = document.getElementById('playerRank');
        if (rankEl) rankEl.innerText = myRank;
    }

    // 依序更新每個題目的狀態
    AppState.questionDB.forEach(q => {
        const card = document.getElementById(`q-card-${q.id}`);
        const status = document.getElementById(`q-status-${q.id}`);
        const lockBtn = document.getElementById(`btn-lock-${q.id}`);
        const textEl = document.getElementById(`q-text-${q.id}`);
        const resultEl = document.getElementById(`q-result-${q.id}`);
        const betBtns = document.querySelectorAll(`.bet-btn-${q.id}`); 
        
        let isLocked = myData ? myData.locked[q.id] : false;
        let serverBets = myData ? myData.bets[q.id] : null;

        // 狀態 1：結算公佈
        if (AppState.serverState.revealedQuestions.includes(q.id)) {
            card.className = "question-card revealed";
            status.innerText = "已結算";
            status.style.cssText = ""; // 清除內聯樣式
            lockBtn.style.display = "none";
            textEl.dataset.scrambling = "false";
            textEl.innerText = textEl.dataset.original; 
            
            toggleBetButtons(betBtns, false);
            document.getElementById(`opt-row-${q.id}-${q.answer}`).classList.add('correct');
            
            for (let key in q.options) {
                let finalBet = (serverBets && serverBets[key]) ? serverBets[key] : 0;
                document.getElementById(`bet-${q.id}-${key}`).innerText = finalBet;
                if (key !== q.answer) {
                    document.getElementById(`opt-row-${q.id}-${key}`).classList.add('wrong');
                }
            }

            // 計算盈虧
            resultEl.style.display = "block";
            if (!isLocked && AppState.localBets[q.id] && Object.values(AppState.localBets[q.id]).reduce((a,b)=>a+b,0) > 0) {
                setElementStyle(status, "未確認，已退還", "rgba(255,102,102,0.2)", "var(--danger)");
                setElementStyle(resultEl, "➖ 未確認下注，籌碼已退還 (±0)", "rgba(255, 255, 255, 0.1)", "#fff");
                AppState.localBets[q.id] = null; 
            } else if (isLocked && serverBets) {
                let netChips = (serverBets[q.answer] || 0) * 2 - Object.values(serverBets).reduce((a,b)=>a+b, 0); 
                if (netChips > 0) {
                    setElementStyle(resultEl, `✅ 本題結算：+${netChips} 籌碼`, "rgba(107, 209, 124, 0.15)", "var(--ok)");
                } else if (netChips < 0) {
                    setElementStyle(resultEl, `❌ 本題結算：${netChips} 籌碼`, "rgba(255, 102, 102, 0.15)", "var(--danger)");
                } else {
                    setElementStyle(resultEl, `➖ 本題結算：±0 籌碼`, "rgba(255, 255, 255, 0.1)", "#fff");
                }
            }
        } 
        // 狀態 2：開放作答中
        else if (AppState.serverState.activeQuestionId === q.id) {
            textEl.dataset.scrambling = "false";
            textEl.innerText = textEl.dataset.original; 
            resultEl.style.display = "none"; 

            if (isLocked) {
                card.className = "question-card active locked-bet";
                setElementStyle(status, "⚠️ 已確認下注", "rgba(215, 179, 93, 0.2)", "var(--gold)");
                lockBtn.disabled = true;
                lockBtn.innerText = "下注完成";
                toggleBetButtons(betBtns, false);
            } else {
                if (AppState.localZeroBetError[q.id]) {
                    showQuestionErrorUI(q.id, "⚠️ 請輸入籌碼");
                } else {
                    resetQuestionStatusUI(q.id);
                }
                lockBtn.disabled = false;
                lockBtn.innerText = "確認下注";
                toggleBetButtons(betBtns, true);
            }
        } 
        // 狀態 3：未開放
        else {
            card.className = "question-card disabled";
            status.innerText = "等待開放";
            status.style.cssText = "";
            textEl.dataset.scrambling = "true"; 
            resultEl.style.display = "none";
            toggleBetButtons(betBtns, false);
        }
    });

    // 檢查是否所有題目都已結算，觸發排行榜
    if (AppState.questionDB.length > 0 && AppState.serverState.revealedQuestions.length === AppState.questionDB.length) {
        document.getElementById('btn-leaderboard').style.display = 'inline-block';
        if (!AppState.leaderboardShown) {
            renderLeaderboard(AppState.serverState.players);
            AppState.leaderboardShown = true;
        }
    } else {
        document.getElementById('btn-leaderboard').style.display = 'none';
    }
}

// 輔助函式：切換按鈕狀態
function toggleBetButtons(btns, isEnabled) {
    btns.forEach(btn => { 
        btn.disabled = !isEnabled; 
        btn.style.opacity = isEnabled ? '1' : '0.2'; 
        btn.style.cursor = isEnabled ? 'pointer' : 'not-allowed'; 
    });
}

// 輔助函式：設定元素樣式
function setElementStyle(el, text, bgColor, color) {
    if(text) el.innerText = text;
    el.style.background = bgColor;
    el.style.color = color;
    el.style.borderColor = color;
}

// 輔助函式：顯示題目錯誤 UI
function showQuestionErrorUI(qId, msg) {
    const status = document.getElementById(`q-status-${qId}`);
    const card = document.getElementById(`q-card-${qId}`);
    setElementStyle(status, msg, "rgba(255, 102, 102, 0.15)", "var(--danger)");
    card.className = "question-card active error-bet";
}

// 輔助函式：恢復題目正常 UI
function resetQuestionStatusUI(qId) {
    const status = document.getElementById(`q-status-${qId}`);
    const card = document.getElementById(`q-card-${qId}`);
    setElementStyle(status, "🟢 開放作答中", "rgba(107, 209, 124, 0.1)", "var(--ok)");
    status.style.borderColor = "rgba(107, 209, 124, 0.4)";
    card.className = "question-card active";
}

function renderLeaderboard(playersObj) {
    const playersArray = Object.values(playersObj).sort((a, b) => b.chips - a.chips); 
    const list = document.getElementById('leaderboardList');
    list.innerHTML = '';
    
    playersArray.slice(0, 10).forEach((p, index) => {
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

// ==========================================
// 6. Socket 事件監聽器 (Socket Listeners)
// ==========================================
socket.on('init_game', (data) => {
    AppState.questionDB = data.questions;
    renderQuestions();
});

socket.on('sync_state', (state) => {
    AppState.serverState = state; 
    updateGameStateUI();
});

// ==========================================
// 7. 裁判專用函數 (Referee API)
// ==========================================
window.refOpenBet = function() {
    const qId = parseInt(document.getElementById('refQSelect').value, 10);
    if (AppState.serverState && AppState.serverState.revealedQuestions.includes(qId)) {
        alert('⚠️ 此題目已經結算完畢，無法重新開放作答！');
        return;
    }
    socket.emit('referee_open_question', qId);
    window.location.hash = `#q-card-${qId}`;
}

window.refReveal = function() {
    const qIdStr = document.getElementById('refQSelect').value;
    const qId = parseInt(qIdStr, 10);
    
    if (AppState.serverState && AppState.serverState.revealedQuestions.includes(qId)) {
        alert('⚠️ 此題目已經結算完畢，無法重新結算！');
        return;
    }
    if (AppState.serverState && AppState.serverState.activeQuestionId !== qId) {
        alert('⚠️ 此題目還未開啟作答，無法進行結算！');
        return;
    }
    socket.emit('referee_reveal_question');
}