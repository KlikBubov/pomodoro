// --- Глобальный перехватчик ошибок (заменяет Sentry JS) ---
window.onerror = function(message, source, lineno, colno, error) {
    const errorData = {
        message: message,
        stack: error && error.stack ? error.stack : `${source}:${lineno}:${colno}`
    };

    // Отправляем ошибку на бэкенд
    fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorData)
    }).catch(() => {}); // Тихо игнорируем, если отправка не удалась

    return false; // Позволяет стандартному выводу ошибки в консоль
};

const MODES = {
    work:  { duration: SETTINGS.work * 60,        label: 'Time to focus',     color: '#ff6b6b' },
    short: { duration: SETTINGS.short_break * 60, label: 'Short break',       color: '#4ecdc4' },
    long:  { duration: SETTINGS.long_break * 60,  label: 'Long break',        color: '#a78bfa' },
};

const LONG_BREAK_INTERVAL = SETTINGS.long_break_interval;

let currentMode = 'work';
let timeLeft = MODES.work.duration;
let totalTime = MODES.work.duration;
let isRunning = false;
let intervalId = null;
let completedSessions = 0;

// DOM
const $time      = document.querySelector('.time');
const $status    = document.querySelector('.status');
const $startBtn  = document.querySelector('.btn-start');
const $resetBtn  = document.querySelector('.btn-reset');
const $tabs      = document.querySelectorAll('.mode-tab');
const $ring      = document.querySelector('.progress-ring-fill');
const $dots      = document.querySelectorAll('.dot');
const $sessionNum= document.querySelector('.session-num');
const $body      = document.body;

// Ring math
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

    // Update browser tab title so the user can see time remaining
    const modeLabel = currentMode === 'work' ? 'Focus' : 'Break';
    document.title = `${formatTime(timeLeft)} · ${modeLabel}`;
}

function setMode(mode, { autostart = false } = {}) {
    currentMode = mode;
    timeLeft = MODES[mode].duration;
    totalTime = MODES[mode].duration;
    isRunning = false;
    clearInterval(intervalId);

    $tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
    $status.textContent = MODES[mode].label;
    document.documentElement.style.setProperty('--accent', MODES[mode].color);
    $startBtn.textContent = 'Start';
    $body.classList.remove('running');

    updateDisplay();

    if (autostart) startTimer();
}

function startTimer() {
    if (isRunning) {
        pauseTimer();
        return;
    }

    isRunning = true;
    $startBtn.textContent = 'Pause';
    $body.classList.add('running');

    intervalId = setInterval(() => {
        timeLeft--;
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
    $startBtn.textContent = 'Start';
    $body.classList.remove('running');
}

function resetTimer() {
    pauseTimer();
    timeLeft = MODES[currentMode].duration;
    updateDisplay();
}

function handleComplete() {
    playChime();
    notify(`${currentMode === 'work' ? 'Focus' : 'Break'} session complete!`);

    if (currentMode === 'work') {
        completedSessions++;
        updateDots();
        $sessionNum.textContent = Math.floor(completedSessions / LONG_BREAK_INTERVAL) + 1;

        // Log to backend
        fetch('/api/log-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'work' })
        }).catch(() => {});

        const nextMode = (completedSessions % LONG_BREAK_INTERVAL === 0) ? 'long' : 'short';
        setMode(nextMode, { autostart: true });
    } else {
        setMode('work', { autostart: true });
    }
}

function updateDots() {
    const cycle = completedSessions % LONG_BREAK_INTERVAL || LONG_BREAK_INTERVAL;
    $dots.forEach((dot, i) => dot.classList.toggle('completed', i < cycle));
}

/* --- Sound: gentle chime via Web Audio API --- */
function playChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

        // Two-note ascending chime
        [880, 1320].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = now + i * 0.18;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            osc.start(t);
            osc.stop(t + 0.65);
        });
    } catch (e) { /* audio not supported */ }
}

/* --- Browser notifications --- */
function notify(message) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        new Notification('🍅 Pomodoro', { body: message });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification('🍅 Pomodoro', { body: message });
        });
    }
}

/* --- Wire up events --- */
 $tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
 $startBtn.addEventListener('click', startTimer);
 $resetBtn.addEventListener('click', resetTimer);

// Keyboard shortcuts: Space = start/pause, R = reset
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); startTimer(); }
    if (e.code === 'KeyR')  { resetTimer(); }
});

// Init
updateDisplay();