// --- Global Error Handler ---
window.onerror = function(message, source, lineno, colno, error) {
    const errorData = {
        message: message,
        stack: error && error.stack ? error.stack : `${source}:${lineno}:${colno}`
    };
    fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorData)
    }).catch(() => {});
    return false;
};

// Load custom settings from localStorage
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
    work:  { duration: SETTINGS.work * 60,        label: 'Time to focus', color: '#e07a5f', tint: '#fdf4f0' },
    short: { duration: SETTINGS.short_break * 60, label: 'Short break',   color: '#81b29a', tint: '#f4f9f6' },
    long:  { duration: SETTINGS.long_break * 60,  label: 'Long break',    color: '#a294c9', tint: '#f7f5fb' },
};

const LONG_BREAK_INTERVAL = SETTINGS.long_break_interval;

let currentMode = 'work';
let timeLeft = MODES.work.duration;
let totalTime = MODES.work.duration;
let isRunning = false;
let intervalId = null;
let completedSessions = 0;
let endTime = null;

// Task State
let tasks = JSON.parse(localStorage.getItem('pomodoro_tasks')) || [];

const $time      = document.querySelector('.time');
const $status    = document.querySelector('.status');
const $startBtn  = document.querySelector('.btn-start');
const $resetBtn  = document.querySelector('.btn-reset');
const $tabs      = document.querySelectorAll('.mode-tab');
const $ring      = document.querySelector('.progress-ring-fill');
const $dots      = document.querySelectorAll('.dot');
const $sessionNum= document.querySelector('.session-num');
const $body      = document.body;

// Settings DOM
const $settingsBtn   = document.querySelector('.btn-settings');
const $settingsPanel = document.querySelector('.settings-panel');
const $applyBtn      = document.querySelector('.btn-apply');
const $inputWork     = document.getElementById('input-work');
const $inputShort    = document.getElementById('input-short');
const $inputLong     = document.getElementById('input-long');

// Tasks DOM
const $taskInput = document.getElementById('task-input');
const $addTaskBtn = document.getElementById('add-task-btn');
const $taskList = document.getElementById('task-list');
const $tasksToggleBtn = document.querySelector('.btn-tasks');
const $appContainer = document.querySelector('.app-container');

// Init inputs with current settings
 $inputWork.value = SETTINGS.work;
 $inputShort.value = SETTINGS.short_break;
 $inputLong.value = SETTINGS.long_break;

// Init tasks visibility
if (localStorage.getItem('pomodoro_tasks_visible') === 'true') {
    $appContainer.classList.add('tasks-visible');
}

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
    const modeLabel = currentMode === 'work' ? 'Focus' : 'Break';
    document.title = `${formatTime(timeLeft)} · ${modeLabel}`;
}

function updateTimerStatus() {
    if (currentMode !== 'work') {
        $status.textContent = MODES[currentMode].label;
        return;
    }
    const activeTask = tasks.find(t => t.active);
    if (activeTask) {
        $status.textContent = activeTask.text;
    } else {
        $status.textContent = MODES.work.label;
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

    $startBtn.textContent = 'Start';
    $body.classList.remove('running');

    updateDisplay();
    updateTimerStatus();
}

function startTimer() {
    if (isRunning) {
        pauseTimer();
        return;
    }

    isRunning = true;
    $startBtn.textContent = 'Pause';
    $body.classList.add('running');

    // Disable settings during run
    $settingsPanel.classList.remove('active');
    $settingsPanel.classList.add('disabled');
    $settingsBtn.classList.add('disabled');

    endTime = Date.now() + (timeLeft * 1000);

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
    $startBtn.textContent = 'Resume';
    $body.classList.remove('running');

    // Enable settings after pause
    $settingsPanel.classList.remove('disabled');
    $settingsBtn.classList.remove('disabled');
}

function resetTimer() {
    pauseTimer();
    $startBtn.textContent = 'Start';
    timeLeft = MODES[currentMode].duration;
    updateDisplay();
}

function handleComplete() {
    playChime();
    notify(`Pomodoro: ${currentMode === 'work' ? 'Focus' : 'Break'} session complete`);

    if (currentMode === 'work') {
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
            body: JSON.stringify({ mode: 'work', task: activeTask ? activeTask.text : null })
        }).catch(() => {});

        const nextMode = (completedSessions % LONG_BREAK_INTERVAL === 0) ? 'long' : 'short';
        setMode(nextMode);
    } else {
        setMode('work');
    }

    // Enable settings after completion
    $settingsPanel.classList.remove('disabled');
    $settingsBtn.classList.remove('disabled');
}

function updateDots() {
    const cycle = completedSessions % LONG_BREAK_INTERVAL || LONG_BREAK_INTERVAL;
    $dots.forEach((dot, i) => dot.classList.toggle('completed', i < cycle));
}

// --- Task Logic ---
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

// --- Soft Sound (Tibetan Bowl / Marimba feel via Web Audio API) ---
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

 $tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
 $startBtn.addEventListener('click', startTimer);
 $resetBtn.addEventListener('click', resetTimer);

// Settings Listeners
 $settingsBtn.addEventListener('click', () => {
    $settingsPanel.classList.toggle('active');
});

 $applyBtn.addEventListener('click', () => {
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
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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

// Init
renderTasks();
updateDisplay();
updateTimerStatus();

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

        $submitFeedbackBtn.textContent = 'Sending...';
        $submitFeedbackBtn.disabled = true;

        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                $feedbackText.value = '';
                $feedbackForm.classList.remove('active');
                $feedbackToggle.textContent = 'Thank you ✓';
                setTimeout(() => {
                    $feedbackToggle.textContent = 'Feedback';
                }, 3000);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to send');
            }
        } catch (err) {
            alert('Network error. Please try later.');
        } finally {
            $submitFeedbackBtn.textContent = 'Send';
            $submitFeedbackBtn.disabled = false;
        }
    });
}