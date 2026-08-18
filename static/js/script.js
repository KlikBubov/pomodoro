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

const MODES = {
    work:  { duration: SETTINGS.work * 60,        label: '> INITIALIZE FOCUS', color: '#00ff99' },
    short: { duration: SETTINGS.short_break * 60, label: '> QUICK_REBOOT',     color: '#00ffff' },
    long:  { duration: SETTINGS.long_break * 60, label: '> DEEP_SLEEP',        color: '#ff00ff' },
};

const LONG_BREAK_INTERVAL = SETTINGS.long_break_interval;

let currentMode = 'work';
let timeLeft = MODES.work.duration;
let totalTime = MODES.work.duration;
let isRunning = false;
let intervalId = null;
let completedSessions = 0;

const $time      = document.querySelector('.time');
const $status    = document.querySelector('.status');
const $startBtn  = document.querySelector('.btn-start');
const $resetBtn  = document.querySelector('.btn-reset');
const $tabs      = document.querySelectorAll('.mode-tab');
const $ring      = document.querySelector('.progress-ring-fill');
const $dots      = document.querySelectorAll('.dot');
const $sessionNum= document.querySelector('.session-num');
const $body      = document.body;

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
    const modeLabel = currentMode === 'work' ? 'FOCUS' : 'BREAK';
    document.title = `[${formatTime(timeLeft)}] :: ${modeLabel}`;
}

function setMode(mode) {
    currentMode = mode;
    timeLeft = MODES[mode].duration;
    totalTime = MODES[mode].duration;
    isRunning = false;
    clearInterval(intervalId);

    $tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
    $status.textContent = MODES[mode].label;
    document.documentElement.style.setProperty('--accent', MODES[mode].color);
    $startBtn.textContent = '[ START ]';
    $body.classList.remove('running');

    updateDisplay();
}

function startTimer() {
    if (isRunning) {
        pauseTimer();
        return;
    }
    isRunning = true;
    $startBtn.textContent = '[ PAUSE ]';
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
    $startBtn.textContent = '[ RESUME ]';
    $body.classList.remove('running');
}

function resetTimer() {
    pauseTimer();
    $startBtn.textContent = '[ START ]';
    timeLeft = MODES[currentMode].duration;
    updateDisplay();
}

function handleComplete() {
    playChime();
    notify(`> PROCESS COMPLETE: ${currentMode === 'work' ? 'FOCUS' : 'BREAK'}`);

    if (currentMode === 'work') {
        completedSessions++;
        updateDots();
        $sessionNum.textContent = Math.floor(completedSessions / LONG_BREAK_INTERVAL) + 1;

        fetch('/api/log-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'work' })
        }).catch(() => {});

        const nextMode = (completedSessions % LONG_BREAK_INTERVAL === 0) ? 'long' : 'short';
        setMode(nextMode);
    } else {
        setMode('work');
    }
}

function updateDots() {
    const cycle = completedSessions % LONG_BREAK_INTERVAL || LONG_BREAK_INTERVAL;
    $dots.forEach((dot, i) => dot.classList.toggle('completed', i < cycle));
}

// --- 8-bit Sound (Chiptune via Web Audio API) ---
let audioCtx = null;
function playChime() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        // Retro 4-note arpeggio (A4, C5, E5, A5)
        [440, 523.25, 659.25, 880].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'square'; // Square wave for authentic 8-bit sound
            osc.frequency.value = freq;

            const t = now + i * 0.15; // Fast succession
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.15, t + 0.02); // Lower volume to avoid harshness
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2); // Short blip

            osc.start(t);
            osc.stop(t + 0.25);
        });
    } catch (e) {
        console.warn("Audio playback failed:", e);
    }
}

function notify(message) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        new Notification('🍅 POMODORO.EXE', { body: message });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification('🍅 POMODORO.EXE', { body: message });
        });
    }
}

 $tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
 $startBtn.addEventListener('click', startTimer);
 $resetBtn.addEventListener('click', resetTimer);

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); startTimer(); }
    if (e.code === 'KeyR')  { resetTimer(); }
});

updateDisplay();

// --- Floating Feedback Widget Logic ---
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
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                $feedbackText.value = '';
                $feedbackForm.classList.remove('active');
                $feedbackToggle.textContent = '> TRANSMITTED OK';
                setTimeout(() => {
                    $feedbackToggle.textContent = '> REPORT';
                }, 3000);
            } else {
                const data = await response.json();
                alert(data.message || 'TRANSMISSION FAILED');
            }
        } catch (err) {
            alert('NETWORK ERROR. RETRY LATER.');
        } finally {
            $submitFeedbackBtn.textContent = 'TRANSMIT';
            $submitFeedbackBtn.disabled = false;
        }
    });
}