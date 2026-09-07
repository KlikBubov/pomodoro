// --- Global Error Handler ---
window.onerror = function(message, source, lineno, colno, error) {
    const errorData = {
        message: message,
        stack: error && error.stack ? error.stack : `${source}:${lineno}:${colno}`
    };
    fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorData),
        credentials: 'same-origin'
    }).catch(() => {});
    return false;
};

// --- i18n Logic ---
let currentLang = localStorage.getItem('pomodoro_lang') || 'en';

function applyTranslations() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[currentLang] && translations[currentLang][key]) {
            el.textContent = translations[currentLang][key];
        }
    });
    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[currentLang] && translations[currentLang][key]) {
            el.placeholder = translations[currentLang][key];
        }
    });

    if (isRunning) {
        $startBtn.textContent = translations[currentLang].pause;
    } else if (timeLeft < MODES[currentMode].duration && timeLeft > 0) {
        $startBtn.textContent = translations[currentLang].resume;
    } else {
        $startBtn.textContent = translations[currentLang].start;
    }

    if (authMode === 'login') {
        $authSubmitBtn.textContent = translations[currentLang].login;
    } else {
        $authSubmitBtn.textContent = translations[currentLang].register;
    }

    updateTimerStatus();
}

// --- Settings Logic ---
const savedSettings = localStorage.getItem('pomodoro_settings');
if (savedSettings) {
    try {
        const parsed = JSON.parse(savedSettings);
        if (parsed.work) SETTINGS.work = parsed.work;
        if (parsed.short_break) SETTINGS.short_break = parsed.short_break;
        if (parsed.long_break) SETTINGS.long_break = parsed.long_break;
    } catch (e) {
        localStorage.removeItem('pomodoro_settings');
    }
}

const MODES = {
    work:  { duration: SETTINGS.work * 60,        statusKey: 'time_to_focus', tabKey: 'focus', color: '#e07a5f', tint: '#fdf4f0' },
    short: { duration: SETTINGS.short_break * 60, statusKey: 'short_break_status', tabKey: 'short_break', color: '#81b29a', tint: '#f4f9f6' },
    long:  { duration: SETTINGS.long_break * 60,  statusKey: 'long_break_status', tabKey: 'long_break', color: '#a294c9', tint: '#f7f5fb' },
};

const LONG_BREAK_INTERVAL = SETTINGS.long_break_interval;

let currentMode = 'work';
let timeLeft = MODES.work.duration;
let totalTime = MODES.work.duration;
let isRunning = false;
let intervalId = null;
let completedSessions = 0;
let endTime = null;

// --- Task State ---
let tasks = JSON.parse(localStorage.getItem('pomodoro_tasks')) || [];

// --- DOM References ---
const $time      = document.querySelector('.time');
const $status    = document.querySelector('.status');
const $startBtn  = document.querySelector('.btn-start');
const $resetBtn  = document.querySelector('.btn-reset');
const $tabs      = document.querySelectorAll('.mode-tab');
const $ring      = document.querySelector('.progress-ring-fill');
const $dots      = document.querySelectorAll('.dot');
const $sessionNum= document.querySelector('.session-num');
const $body      = document.body;

const $settingsBtn   = document.querySelector('.btn-settings');
const $settingsPanel = document.querySelector('.settings-panel');
const $applyBtn      = document.querySelector('.btn-apply');
const $inputWork     = document.getElementById('input-work');
const $inputShort    = document.getElementById('input-short');
const $inputLong     = document.getElementById('input-long');

const $taskInput = document.getElementById('task-input');
const $addTaskBtn = document.getElementById('add-task-btn');
const $taskList = document.getElementById('task-list');
const $tasksToggleBtn = document.querySelector('.btn-tasks');
const $appContainer = document.querySelector('.app-container');
const $langSelector = document.getElementById('lang-selector');

// Auth DOM
const $authModal = document.getElementById('auth-modal');
const $profileBtn = document.getElementById('profile-btn');
const $authClose = document.getElementById('auth-close');
const $tabLogin = document.getElementById('tab-login');
const $tabRegister = document.getElementById('tab-register');
const $authForm = document.getElementById('auth-form');
const $authProfile = document.getElementById('auth-profile');
const $authError = document.getElementById('auth-error');
const $logoutBtn = document.getElementById('logout-btn');
const $authSubmitBtn = document.querySelector('.btn-auth-submit');
const $authTabs = document.getElementById('auth-tabs');
const $authContent = document.querySelector('.auth-modal-content');

// Webhooks DOM
const $webhookList = document.getElementById('webhook-list');
const $webhookUrl = document.getElementById('webhook-url');
const $addWebhookBtn = document.getElementById('add-webhook-btn');

// --- State Init ---
 $inputWork.value = SETTINGS.work;
 $inputShort.value = SETTINGS.short_break;
 $inputLong.value = SETTINGS.long_break;

if (localStorage.getItem('pomodoro_tasks_visible') === 'true') {
    $appContainer.classList.add('tasks-visible');
}

let authMode = 'login';
let isLoggedIn = false;

// --- Timer Functions ---
const RADIUS = $ring.r.baseVal.value;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
 $ring.style.strokeDasharray = CIRCUMFERENCE;
 $ring.style.strokeDashoffset = CIRCUMFERENCE;

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateDisplay() {
    $time.textContent = formatTime(timeLeft);
    const progress = (totalTime - timeLeft) / totalTime;
    $ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    const modeLabel = translations[currentLang][MODES[currentMode].tabKey];
    document.title = `${formatTime(timeLeft)} · ${modeLabel}`;
}

function updateTimerStatus() {
    if (currentMode !== 'work') {
        $status.textContent = translations[currentLang][MODES[currentMode].statusKey];
        return;
    }
    const activeTask = tasks.find(t => t.active);
    if (activeTask) {
        $status.textContent = activeTask.text;
    } else {
        $status.textContent = translations[currentLang][MODES.work.statusKey];
    }
}

function setMode(mode) {
    currentMode = mode;
    timeLeft = MODES[mode].duration;
    totalTime = MODES[mode].duration;
    isRunning = false;
    clearInterval(intervalId);

    $tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));

    document.documentElement.style.setProperty('--accent', MODES[mode].color);
    document.documentElement.style.setProperty('--accent-tint', MODES[mode].tint);

    $startBtn.textContent = translations[currentLang].start;
    $body.classList.remove('running');

    updateDisplay();
    updateTimerStatus();
}

function notifyExternalServices(eventType) {
    if (!isLoggedIn) return;
    const activeTask = tasks.find(t => t.active);
    fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventType, task: activeTask ? activeTask.text : null }),
        credentials: 'same-origin'
    }).catch(() => {});
}

function startTimer() {
    if (isRunning) {
        pauseTimer();
        return;
    }

    isRunning = true;
    $startBtn.textContent = translations[currentLang].pause;
    $body.classList.add('running');

    $settingsPanel.classList.remove('active');
    $settingsPanel.classList.add('disabled');
    $settingsBtn.classList.add('disabled');

    endTime = Date.now() + (timeLeft * 1000);

    // Notify Webhooks
    const eventType = currentMode === 'work' ? 'focus_started' : 'break_started';
    notifyExternalServices(eventType);

    intervalId = setInterval(() => {
        const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
        timeLeft = remaining;
        updateDisplay();

        if (timeLeft <= 0) {
            clearInterval(intervalId);
            isRunning = false;
            $body.classList.remove('running');
            handleComplete();
        }
    }, 1000);
}

function pauseTimer() {
    isRunning = false;
    clearInterval(intervalId);
    $startBtn.textContent = translations[currentLang].resume;
    $body.classList.remove('running');

    $settingsPanel.classList.remove('disabled');
    $settingsBtn.classList.remove('disabled');
}

function resetTimer() {
    pauseTimer();
    $startBtn.textContent = translations[currentLang].start;
    timeLeft = MODES[currentMode].duration;
    updateDisplay();
}

function handleComplete() {
    playChime();
    notify(currentMode === 'work' ? translations[currentLang].focus_complete : translations[currentLang].break_complete);

    const completedMode = currentMode; // Store before changing

    if (completedMode === 'work') {
        completedSessions++;
        updateDots();
        $sessionNum.textContent = Math.floor(completedSessions / LONG_BREAK_INTERVAL) + 1;

        const activeTask = tasks.find(t => t.active);
        if (activeTask) {
            activeTask.pomodoros++;
            renderTasks();

            if (UMAMI_ENABLED && window.umami) {
                umami.track('pomodoro_complete', { task: activeTask.text });
            }
        }

        fetch('/api/log-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'work', task: activeTask ? activeTask.text : null }),
            credentials: 'same-origin'
        }).then(() => {
            // Update profile UI live if the modal is open
            if (isLoggedIn && $authModal.classList.contains('active')) {
                fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' })
                    .then(res => res.json())
                    .then(data => updateProfileUI(data));
            }
        }).catch(() => {});

        const nextMode = (completedSessions % LONG_BREAK_INTERVAL === 0) ? 'long' : 'short';
        setMode(nextMode);
    } else {
        setMode('work');
    }

    // Notify Webhooks
    const eventType = completedMode === 'work' ? 'focus_completed' : 'break_completed';
    notifyExternalServices(eventType);

    $settingsPanel.classList.remove('disabled');
    $settingsBtn.classList.remove('disabled');
}

function updateDots() {
    const cycle = completedSessions % LONG_BREAK_INTERVAL || LONG_BREAK_INTERVAL;
    $dots.forEach((dot, i) => dot.classList.toggle('completed', i < cycle));
}

// --- Task Functions ---
function saveTasks() {
    localStorage.setItem('pomodoro_tasks', JSON.stringify(tasks));
}

function renderTasks() {
    $taskList.innerHTML = '';
    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = `task-item ${task.active ? 'active' : ''}`;
        li.dataset.id = task.id;

        li.innerHTML = `
            <div class="task-content">
                <span class="task-text">${task.text}</span>
                <span class="task-pomodoros">${task.pomodoros} 🍅</span>
            </div>
            <button class="task-delete" aria-label="Delete task">×</button>
        `;
        $taskList.appendChild(li);
    });
}

function addTask() {
    const text = $taskInput.value.trim();
    if (!text) return;

    const newTask = {
        id: Date.now(),
        text: text,
        pomodoros: 0,
        active: tasks.length === 0
    };

    tasks.push(newTask);
    $taskInput.value = '';
    saveTasks();
    renderTasks();
    updateTimerStatus();
}

// --- Sound ---
let audioCtx = null;
function playChime() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        [659.25, 880.00].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;

            const t = now + i * 0.1;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.2, t + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);

            osc.start(t);
            osc.stop(t + 1.6);
        });
    } catch (e) {
        console.warn("Audio playback failed:", e);
    }
}

function notify(message) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        new Notification('Pomodoro', { body: message });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification('Pomodoro', { body: message });
        });
    }
}

// --- Auth Logic ---
async function checkAuthStatus() {
    try {
        const res = await fetch('/api/auth/status', {
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const data = await res.json();
        if (data.logged_in) {
            isLoggedIn = true;
            localStorage.setItem('pomodoro_settings', JSON.stringify(data.settings));
            SETTINGS.work = data.settings.work;
            SETTINGS.short_break = data.settings.short_break;
            SETTINGS.long_break = data.settings.long_break;

            $inputWork.value = SETTINGS.work;
            $inputShort.value = SETTINGS.short_break;
            $inputLong.value = SETTINGS.long_break;

            MODES.work.duration = SETTINGS.work * 60;
            MODES.short.duration = SETTINGS.short_break * 60;
            MODES.long.duration = SETTINGS.long_break * 60;
            resetTimer();
        }
    } catch (e) {
        console.error("Auth check failed", e);
    }
}

function updateProfileUI(data) {
    if (data.logged_in) {
        isLoggedIn = true;
        document.getElementById('auth-user-email').textContent = data.email;

        const pomodoros = data.total_sessions || 0;
        document.getElementById('stat-pomodoros').textContent = pomodoros;

        const workMin = data.settings?.work || 25;
        const totalMinutes = pomodoros * workMin;
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        document.getElementById('stat-time').textContent = `${hours}h ${mins}m`;

        $authForm.style.display = 'none';
        $authProfile.style.display = 'block';
        $authTabs.style.display = 'none';
        $authContent.classList.add('logged-in');

        fetchWebhooks();
    } else {
        isLoggedIn = false;
        $authProfile.style.display = 'none';
        $authForm.style.display = 'block';
        $authTabs.style.display = 'flex';
        $authContent.classList.remove('logged-in');
    }
}

// --- Webhooks Logic ---
async function fetchWebhooks() {
    try {
        const res = await fetch('/api/webhooks', { credentials: 'same-origin' });
        const hooks = await res.json();
        renderWebhooks(hooks);
    } catch (e) {
        console.error("Failed to fetch webhooks", e);
    }
}

function renderWebhooks(hooks) {
    $webhookList.innerHTML = '';
    if (hooks.length === 0) {
        $webhookList.innerHTML = '<div style="text-align:center; color:var(--text-secondary); font-size:12px;">No webhooks added.</div>';
        return;
    }
    hooks.forEach(hook => {
        const item = document.createElement('div');
        item.className = 'webhook-item';
        item.innerHTML = `
            <span class="webhook-url">${hook.url}</span>
            <button class="webhook-delete" data-id="${hook.id}">×</button>
        `;
        $webhookList.appendChild(item);
    });
}

 $addWebhookBtn.addEventListener('click', async () => {
    const url = $webhookUrl.value.trim();
    const events = Array.from(document.querySelectorAll('.webhook-events input:checked')).map(cb => cb.value);

    if (!url || events.length === 0) return;

    try {
        const res = await fetch('/api/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, events }),
            credentials: 'same-origin'
        });
        if (res.ok) {
            $webhookUrl.value = '';
            document.querySelectorAll('.webhook-events input:checked').forEach(cb => cb.checked = false);
            fetchWebhooks();
        }
    } catch (e) {
        console.error("Failed to add webhook", e);
    }
});

 $webhookList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('webhook-delete')) {
        const id = e.target.dataset.id;
        try {
            await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE', credentials: 'same-origin' });
            fetchWebhooks();
        } catch (err) {
            console.error("Failed to delete webhook", err);
        }
    }
});

// --- Event Listeners ---
 $tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
 $startBtn.addEventListener('click', startTimer);
 $resetBtn.addEventListener('click', resetTimer);

 $settingsBtn.addEventListener('click', () => {
    $settingsPanel.classList.toggle('active');
});

 $applyBtn.addEventListener('click', async () => {
    const newWork = parseInt($inputWork.value) || 25;
    const newShort = parseInt($inputShort.value) || 5;
    const newLong = parseInt($inputLong.value) || 15;

    SETTINGS.work = newWork;
    SETTINGS.short_break = newShort;
    SETTINGS.long_break = newLong;

    localStorage.setItem('pomodoro_settings', JSON.stringify({
        work: newWork,
        short_break: newShort,
        long_break: newLong
    }));

    MODES.work.duration = newWork * 60;
    MODES.short.duration = newShort * 60;
    MODES.long.duration = newLong * 60;

    resetTimer();
    $settingsPanel.classList.remove('active');

    if (isLoggedIn) {
        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work: newWork, short_break: newShort, long_break: newLong }),
            credentials: 'same-origin'
        });
    }
});

 $taskList.addEventListener('click', (e) => {
    const item = e.target.closest('.task-item');
    if (!item) return;

    const id = parseInt(item.dataset.id);

    if (e.target.classList.contains('task-delete')) {
        tasks = tasks.filter(t => t.id !== id);
        if (tasks.length > 0 && !tasks.some(t => t.active)) {
            tasks[0].active = true;
        }
        saveTasks();
        renderTasks();
        updateTimerStatus();
    } else {
        tasks = tasks.map(t => ({ ...t, active: t.id === id }));
        saveTasks();
        renderTasks();
        updateTimerStatus();
    }
});

 $addTaskBtn.addEventListener('click', addTask);
 $taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
});

 $tasksToggleBtn.addEventListener('click', () => {
    const isVisible = $appContainer.classList.toggle('tasks-visible');
    localStorage.setItem('pomodoro_tasks_visible', isVisible);
});

if ($langSelector) {
    $langSelector.value = currentLang;
    $langSelector.addEventListener('change', (e) => {
        currentLang = e.target.value;
        localStorage.setItem('pomodoro_lang', currentLang);
        applyTranslations();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); startTimer(); }
    if (e.code === 'KeyR')  { resetTimer(); }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isRunning && endTime) {
        const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
        timeLeft = remaining;
        updateDisplay();

        if (timeLeft <= 0) {
            clearInterval(intervalId);
            isRunning = false;
            $body.classList.remove('running');
            handleComplete();
        }
    }
});

// --- Feedback Widget Logic ---
const $feedbackToggle = document.getElementById('feedback-toggle');
const $feedbackForm = document.getElementById('feedback-form');
const $submitFeedbackBtn = document.getElementById('submit-feedback');
const $feedbackText = document.getElementById('feedback-text');

if ($feedbackToggle) {
    $feedbackToggle.addEventListener('click', () => {
        $feedbackForm.classList.toggle('active');
    });

    $submitFeedbackBtn.addEventListener('click', async () => {
        const message = $feedbackText.value.trim();
        if (!message) return;

        $submitFeedbackBtn.textContent = '...';
        $submitFeedbackBtn.disabled = true;

        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
                credentials: 'same-origin'
            });

            if (response.ok) {
                $feedbackText.value = '';
                $feedbackForm.classList.remove('active');
                $feedbackToggle.textContent = '✓';
                setTimeout(() => {
                    $feedbackToggle.textContent = translations[currentLang].feedback;
                }, 3000);
            } else {
                const data = await response.json();
                alert(data.message || translations[currentLang].failed_to_send);
            }
        } catch (err) {
            alert(translations[currentLang].network_error);
        } finally {
            $submitFeedbackBtn.textContent = translations[currentLang].send;
            $submitFeedbackBtn.disabled = false;
        }
    });
}

// --- Auth Event Listeners ---
 $profileBtn.addEventListener('click', async () => {
    $authError.textContent = '';
    try {
        const res = await fetch('/api/auth/status', {
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const data = await res.json();
        updateProfileUI(data);
    } catch (e) {
        updateProfileUI({ logged_in: false });
    }
    $authModal.classList.add('active');
});

 $authClose.addEventListener('click', () => $authModal.classList.remove('active'));
window.addEventListener('click', (e) => { if (e.target === $authModal) $authModal.classList.remove('active'); });

 $tabLogin.addEventListener('click', () => {
    authMode = 'login'; $tabLogin.classList.add('active'); $tabRegister.classList.remove('active');
    $authSubmitBtn.textContent = translations[currentLang].login;
});

 $tabRegister.addEventListener('click', () => {
    authMode = 'register'; $tabRegister.classList.add('active'); $tabLogin.classList.remove('active');
    $authSubmitBtn.textContent = translations[currentLang].register;
});

 $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $authError.textContent = '';
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    $authSubmitBtn.textContent = '...';
    $authSubmitBtn.disabled = true;

    try {
        const res = await fetch(`/api/auth/${authMode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'same-origin'
        });
        const data = await res.json();

        if (res.ok) {
            const statusRes = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
            const statusData = await statusRes.json();

            if (statusData.logged_in) {
                localStorage.setItem('pomodoro_settings', JSON.stringify(statusData.settings));
                SETTINGS.work = statusData.settings.work;
                SETTINGS.short_break = statusData.settings.short_break;
                SETTINGS.long_break = statusData.settings.long_break;

                $inputWork.value = SETTINGS.work;
                $inputShort.value = SETTINGS.short_break;
                $inputLong.value = SETTINGS.long_break;

                MODES.work.duration = SETTINGS.work * 60;
                MODES.short.duration = SETTINGS.short_break * 60;
                MODES.long.duration = SETTINGS.long_break * 60;
                resetTimer();

                updateProfileUI(statusData);
                isLoggedIn = true;
            } else {
                $authError.textContent = "Session error";
            }
        } else {
            $authError.textContent = data.message || 'Error';
        }
    } catch (err) {
        $authError.textContent = translations[currentLang].network_error;
    } finally {
        $authSubmitBtn.disabled = false;
        $authSubmitBtn.textContent = translations[currentLang][authMode];
    }
});

 $logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    updateProfileUI({ logged_in: false });
    isLoggedIn = false;
});

// --- Initialization ---
applyTranslations();
renderTasks();
updateDisplay();
updateTimerStatus();
checkAuthStatus();