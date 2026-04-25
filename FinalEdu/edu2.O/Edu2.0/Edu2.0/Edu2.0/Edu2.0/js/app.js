// --- Authentication & Welcome ---
function displayWelcome() {
    // UPDATED: Uses 'currentUserName' to match your login route storage
    const savedName = localStorage.getItem('currentUserName');
    const welcomeHeading = document.getElementById('welcomeMessage');
    
    if (savedName && welcomeHeading) {
        welcomeHeading.innerText = `Welcome Back, ${savedName}! 🎓`;
    }
}

function handleLogout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

window.handleLogout = handleLogout;
window.logout = handleLogout;

// --- Dashboard Synchronization ---
async function updateDashboard() {
    const budgetBox = document.getElementById('dashRemaining');
    const token = localStorage.getItem('authToken');
    const cgpaEl = document.getElementById('dashCGPA');
    const creditsEl = document.getElementById('totalCreditsBox');
    const cgpaSubtitleEl = document.getElementById('cgpaSubtitle');
    const attendanceAvgEl = document.getElementById('dashAttendanceAvg');
    const attendanceLabelEl = document.getElementById('dashAttendanceLabel');

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    const daysLeft = Math.max(lastDay - now.getDate() + 1, 1);

    let remainingBalance = 0;
    let isOverspent = false;
    let warningMessage = '';
    let currentCgpa = 0;
    let totalCreditsCompleted = 0;
    let academicStatus = 'Start adding semester records';
    let globalAttendanceAvg = 0;

    if (token) {
        try {
            const [financeResponse, academicResponse] = await Promise.all([
                fetch(`http://localhost:5000/api/finance/summary?year=${currentYear}&month=${currentMonth}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch('http://localhost:5000/api/academic/summary', {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);

            const financeResult = await financeResponse.json();
            if (financeResponse.ok && financeResult.success) {
                const financeSummary = financeResult.data?.summary || {};
                remainingBalance = Number(financeSummary.remainingBalance) || 0;
                isOverspent = Boolean(financeSummary.isOverspent);
                warningMessage = financeSummary.warningMessage || '';
            }

            const academicResult = await academicResponse.json();
            if (academicResponse.ok && academicResult.success) {
                const academicSummary = (academicResult.data || [])[0] || {};
                currentCgpa = Number(academicSummary.currentCgpa) || 0;
                totalCreditsCompleted = Number(academicSummary.totalCreditsCompleted) || 0;
                academicStatus = academicSummary.statusMessage || 'Keep going';
                globalAttendanceAvg = Number(academicSummary.globalAttendanceAvg) || 0;
            }
        } catch (error) {
            console.error('Failed to fetch dashboard summary:', error);
        }
    }

    if (cgpaEl) {
        cgpaEl.innerText = currentCgpa.toFixed(2);
    }
    if (creditsEl) {
        creditsEl.innerText = totalCreditsCompleted.toFixed(1);
    }
    if (cgpaSubtitleEl) {
        cgpaSubtitleEl.innerText = academicStatus;
    }

    if (attendanceAvgEl) {
        attendanceAvgEl.innerText = `${globalAttendanceAvg.toFixed(2)}%`;

        if (globalAttendanceAvg < 75) {
            attendanceAvgEl.style.color = '#dc2626';
            if (attendanceLabelEl) attendanceLabelEl.innerText = 'Warning Zone';
        } else if (globalAttendanceAvg <= 85) {
            attendanceAvgEl.style.color = '#d97706';
            if (attendanceLabelEl) attendanceLabelEl.innerText = 'Moderate Zone';
        } else {
            attendanceAvgEl.style.color = '#15803d';
            if (attendanceLabelEl) attendanceLabelEl.innerText = 'Healthy Zone';
        }
    }

    const avgPerDay = remainingBalance > 0 ? (remainingBalance / daysLeft).toFixed(2) : '0.00';

    if (budgetBox) {
        const amountColor = isOverspent ? '#dc2626' : 'var(--dashboard-primary, var(--primary))';
        const warningHtml = isOverspent
            ? `<div style="margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #fef2f2; color: #b91c1c; font-size: 0.8rem; font-weight: 700;">${warningMessage || 'Warning: spending has exceeded the monthly budget.'}</div>`
            : '';

        budgetBox.innerHTML = `
            <h2 style="font-size: 2.4rem; color: ${amountColor}; font-weight: 800; margin: 0;">Tk ${remainingBalance.toFixed(2)}</h2>
            <p style="font-size: 0.85rem; color: var(--text-gray, #64748b); margin-top: 4px;">Avg: Tk ${avgPerDay}/day remaining</p>
            ${warningHtml}
        `;
    }

    // 2. Live Events + Daily Routine
    const eventBox = document.getElementById('upcomingEventsList');
    const routineBox = document.getElementById('dailyRoutineList');

    if (!token) {
        if (eventBox) {
            eventBox.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">Login required to load events.</p>';
        }
        if (routineBox) {
            routineBox.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">Login required to load routine tasks.</p>';
        }
        return;
    }

    const todayDateStr = now.toISOString().split('T')[0];
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayOfWeek = dayNames[now.getDay()];

    try {
        const [eventsRes, routineRes] = await Promise.all([
            fetch(`http://localhost:5000/api/calendar?fromDate=${todayDateStr}&limit=3`, {
                headers: { Authorization: `Bearer ${token}` }
            }),
            fetch(`http://localhost:5000/api/routine?dayOfWeek=${currentDayOfWeek}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
        ]);

        const eventsJson = await eventsRes.json();
        const routineJson = await routineRes.json();

        const upcomingEvents = eventsRes.ok && eventsJson.success ? (eventsJson.data || []) : [];
        const todayTasks = routineRes.ok && routineJson.success ? (routineJson.data || []) : [];

        if (eventBox) {
            if (upcomingEvents.length > 0) {
                let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
                upcomingEvents.slice(0, 3).forEach((ev) => {
                    const eventDate = new Date(ev.date);
                    const dateLabel = eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const timeLabel = eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    html += `
                    <li style="padding: 12px; border-radius: 8px; border-left: 4px solid ${ev.color || 'var(--primary)'}; margin-bottom: 10px; background: #f8f9fa; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">${dateLabel}</div>
                        <div style="font-weight: 600; color: #333;">${ev.title}</div>
                        <div style="font-size: 0.8rem; color: #666;">${timeLabel}</div>
                    </li>`;
                });
                html += '</ul>';
                eventBox.innerHTML = html;
            } else {
                eventBox.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">No upcoming events.</p>';
            }
        }

        if (routineBox) {
            if (todayTasks.length > 0) {
                let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
                todayTasks.slice(0, 5).forEach((task) => {
                    const doneStyle = task.isCompleted ? 'text-decoration: line-through; color: #10b981;' : 'color: #334155;';
                    html += `
                    <li style="padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; background: #f8fafc; border-left: 4px solid ${task.isCompleted ? '#10b981' : '#cbd5e1'}; display: flex; justify-content: space-between; align-items: center;">
                        <span style="${doneStyle} font-weight: 600;">${task.title}</span>
                        <span style="font-size: 0.75rem; color: #64748b;">${task.time || ''}</span>
                    </li>`;
                });
                html += '</ul>';
                routineBox.innerHTML = html;
            } else {
                routineBox.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">No routine tasks for today.</p>';
            }
        }
    } catch (error) {
        console.error('Failed to fetch dashboard live widgets:', error);
        if (eventBox) {
            eventBox.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 20px;">Unable to load events.</p>';
        }
        if (routineBox) {
            routineBox.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 20px;">Unable to load routine tasks.</p>';
        }
    }
}

if (document.getElementById('upcomingEventsList') || document.getElementById('dailyRoutineList')) {
    setInterval(() => {
        updateDashboard();
    }, 30000);
}

// ============================================================================
// GLOBAL ALARM ENGINE (Java Clock1.java Style)
// ============================================================================
// Background watchdog that:
// - Checks every 1 second
// - Matches: currentH == eventH && currentM == eventM && currentAMPM == eventAMPM && flag == 1
// - Plays synthesized beep when matched
// - Uses lastAlarmId tracking to prevent 60x repeats in the same minute
// ============================================================================

// State variables (Java style)
let flag = 1; // 1 = alarm can trigger, 0 = alarm suppressed for current minute
let lastAlarmId = null; // Track which event triggered to prevent repeats
let lastTriggeredSecondKey = null; // Prevent duplicate trigger attempts inside same second
let watchdogBusy = false;

// Current alarm context
let currentAlarmEvent = null;
let currentAlarmSource = null;
let systemBeepIntervalId = null;
let alarmAudioContext = null;
let alarmEventsCache = [];
let alarmEventsLastFetchAt = 0;
let alarmRoutineTasksCache = [];
let alarmRoutineTasksLastFetchAt = 0;

const playSingleBeep = () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!alarmAudioContext) {
        alarmAudioContext = new AudioCtx();
    }

    if (alarmAudioContext.state === 'suspended') {
        alarmAudioContext.resume().catch(() => {});
    }

    const oscillator = alarmAudioContext.createOscillator();
    const gainNode = alarmAudioContext.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(880, alarmAudioContext.currentTime);

    gainNode.gain.setValueAtTime(0.0001, alarmAudioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.18, alarmAudioContext.currentTime + 0.02);
    gainNode.gain.setValueAtTime(0.18, alarmAudioContext.currentTime + 0.45);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, alarmAudioContext.currentTime + 0.5);

    oscillator.connect(gainNode);
    gainNode.connect(alarmAudioContext.destination);

    oscillator.start();
    oscillator.stop(alarmAudioContext.currentTime + 0.5);
};

const startBeeping = () => {
    if (systemBeepIntervalId) return;

    // 500ms ON (beep), 500ms OFF (silence), repeat.
    playSingleBeep();
    systemBeepIntervalId = setInterval(playSingleBeep, 1000);
};

const stopBeeping = () => {
    if (systemBeepIntervalId) {
        clearInterval(systemBeepIntervalId);
        systemBeepIntervalId = null;
    }
};

// ============================================================================
// UTILITY: Extract hour, minute, AM/PM from time string
// ============================================================================

function parseEventTime(timeStr) {
    if (!timeStr) return null;

    // Try 24-hour format: "14:30"
    const match24 = timeStr.match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/);
    if (match24) {
        const hour24 = parseInt(match24[1], 10);
        let hour12 = hour24 % 12;
        if (hour12 === 0) hour12 = 12;
        const ampm = hour24 < 12 ? 'AM' : 'PM';
        return {
            h: String(hour12),
            m: String(parseInt(match24[2], 10)),
            am_pm: String(ampm)
        };
    }

    // Try 12-hour format: "02:30 PM"
    const match12 = timeStr.match(/^([0-1]?\d):([0-5]\d)\s*([AaPp][Mm])$/);
    if (match12) {
        const hour = parseInt(match12[1], 10);
        const period = match12[3].toUpperCase();
        return {
            h: String(hour),
            m: String(parseInt(match12[2], 10)),
            am_pm: String(period)
        };
    }

    return null;
}

function getCurrentTimeComponents() {
    const now = new Date();
    let hour = now.getHours();
    let am_pm = hour < 12 ? 'AM' : 'PM';
    hour = hour % 12;
    if (hour === 0) hour = 12;

    return {
        h: String(hour),
        m: String(now.getMinutes()),
        am_pm: String(am_pm)
    };
}

// ============================================================================
// UTILITY: Extract event time
// ============================================================================

function extractEventTime(event) {
    if (!event) return null;

    // Try multiple time field names
    const timeField = event.time || event.eventTime || event.startTime;
    if (timeField) {
        return parseEventTime(timeField);
    }

    // Fallback: derive from event.date
    if (event.date) {
        const eventDate = new Date(event.date);
        if (!isNaN(eventDate.getTime())) {
            const timeStr = `${String(eventDate.getHours()).padStart(2, '0')}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
            return parseEventTime(timeStr);
        }
    }

    return null;
}

// ============================================================================
// UTILITY: Check if event repeats/applies today
// ============================================================================

function doesEventApplyToday(event) {
    if (!event.date) return false;

    const eventDate = new Date(event.date);
    if (isNaN(eventDate.getTime())) return false;

    const today = new Date();

    const eventDayOfWeek = eventDate.getDay();
    const eventDayOfMonth = eventDate.getDate();
    const eventMonth = eventDate.getMonth();

    const todayDayOfWeek = today.getDay();
    const todayDayOfMonth = today.getDate();
    const todayMonth = today.getMonth();

    const repeatType = event.repeat || 'none';

    if (repeatType === 'none') {
        return eventDate.toDateString() === today.toDateString();
    }
    if (repeatType === 'weekly') {
        return eventDayOfWeek === todayDayOfWeek;
    }
    if (repeatType === 'monthly') {
        return eventDayOfMonth === todayDayOfMonth;
    }
    if (repeatType === 'yearly') {
        return eventMonth === todayMonth && eventDayOfMonth === todayDayOfMonth;
    }

    return false;
}

// ============================================================================
// UI: Show centered modal with burgundy theme
// ============================================================================

function showAlarmModal(event) {
    const modalId = 'alarmModalContainer';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'alarm-modal-overlay';

    const eventTitle = event.title || 'Reminder';

    modal.innerHTML = `
        <div class="alarm-modal-card">
            <div style="font-size: 4rem; margin-bottom: 20px;">⏰</div>
            <h2 class="alarm-modal-title">Reminder: ${eventTitle}</h2>
            <p class="alarm-modal-message">Time to take action!</p>
            <button class="btn-main alarm-dismiss-btn" onclick="btnStopClick()">
                Stop & Dismiss
            </button>
        </div>
    `;

    document.body.appendChild(modal);
}

// ============================================================================
// CONTROL: btnStop logic (mirrors your Java code)
// ============================================================================

async function dismissAlarmInDatabase(alarmId, sourceType) {
    const token = localStorage.getItem('authToken');
    if (!token || !alarmId) return;

    const endpoint = sourceType === 'routine'
        ? `http://localhost:5000/api/routine/${alarmId}/dismiss`
        : `http://localhost:5000/api/events/${alarmId}/dismiss`;

    try {
        await fetch(endpoint, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        });
    } catch (error) {
        console.error('Failed to dismiss reminder in database:', error);
    }
}

window.btnStopClick = async function() {
    stopBeeping();
    flag = 0; // Suppress alarm for the rest of this minute

    const alarmToDismiss = currentAlarmEvent;
    if (alarmToDismiss) {
        // Update local event object immediately so this session won't re-trigger it.
        alarmToDismiss.isDismissed = true;
        if (currentAlarmSource === 'routine') {
            alarmRoutineTasksCache = alarmRoutineTasksCache.map((task) => {
                if (task._id === alarmToDismiss._id) {
                    return { ...task, isDismissed: true };
                }
                return task;
            });
        } else {
            alarmEventsCache = alarmEventsCache.map((event) => {
                if (event._id === alarmToDismiss._id) {
                    return { ...event, isDismissed: true };
                }
                return event;
            });
        }
        await dismissAlarmInDatabase(alarmToDismiss._id, currentAlarmSource);
    }

    const modal = document.getElementById('alarmModalContainer');
    if (modal) modal.remove();

    currentAlarmEvent = null;
    currentAlarmSource = null;
};

// ============================================================================
// CORE: Load events from API
// ============================================================================

async function loadEventsForAlarm() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        return [];
    }

    try {
        const response = await fetch('http://localhost:5000/api/calendar', {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000) // 5 second timeout to prevent hanging
        });
        if (response.ok) {
            const json = await response.json();
            if (json.success && Array.isArray(json.data)) {
                return json.data.map((event) => ({
                    ...event,
                    isDismissed: Boolean(event.isDismissed)
                }));
            }
        }
    } catch (err) {
        // Network error, backend down, or timeout - keep alarm engine silent.
    }

    return [];
}

async function refreshAlarmEvents(force = false) {
    const nowMs = Date.now();
    const cacheWindowMs = 15000;

    if (!force && nowMs - alarmEventsLastFetchAt < cacheWindowMs) {
        return alarmEventsCache;
    }

    const latestEvents = await loadEventsForAlarm();
    alarmEventsCache = Array.isArray(latestEvents) ? latestEvents : [];
    alarmEventsLastFetchAt = nowMs;
    return alarmEventsCache;
}

function getCurrentDayKey() {
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return dayNames[now.getDay()];
}

async function loadRoutineTasksForAlarm() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        return [];
    }

    try {
        const dayOfWeek = getCurrentDayKey();
        const response = await fetch(`http://localhost:5000/api/routine?dayOfWeek=${dayOfWeek}&alarmEnabled=true`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
            const json = await response.json();
            if (json.success && Array.isArray(json.data)) {
                return json.data.map((task) => ({
                    ...task,
                    alarmEnabled: task.alarmEnabled !== undefined ? Boolean(task.alarmEnabled) : Boolean(task.reminder),
                    isDismissed: Boolean(task.isDismissed)
                }));
            }
        }
    } catch (err) {
        // Network error, backend down, or timeout - keep alarm engine silent.
    }

    return [];
}

async function refreshAlarmRoutineTasks(force = false) {
    const nowMs = Date.now();
    const cacheWindowMs = 15000;

    if (!force && nowMs - alarmRoutineTasksLastFetchAt < cacheWindowMs) {
        return alarmRoutineTasksCache;
    }

    const latestTasks = await loadRoutineTasksForAlarm();
    alarmRoutineTasksCache = Array.isArray(latestTasks) ? latestTasks : [];
    alarmRoutineTasksLastFetchAt = nowMs;
    return alarmRoutineTasksCache;
}

// ============================================================================
// CORE: Background watchdog (every 1 second)
// ============================================================================

async function backgroundWatchdog() {
    try {
        // Get current time components (Java style: temp_h, temp_m, temp_am_pm)
        const now = new Date();
        const current = getCurrentTimeComponents();
        const currentH = current.h;
        const currentM = current.m;
        const currentAMPM = current.am_pm;
        const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const currentSecond = String(now.getSeconds());

        // Keep a DB-backed cache and periodically refresh it.
        const events = await refreshAlarmEvents(false);
        const routineTasks = await refreshAlarmRoutineTasks(false);
        if (!Array.isArray(events)) return;

        // Search through events
        events.forEach((event) => {
            // Skip if reminder not enabled
            if (!event.reminder) return;

            // Skip if event doesn't apply today
            if (!doesEventApplyToday(event)) return;

            // Extract event time
            const eventTime = extractEventTime(event);
            if (!eventTime) return;

            const eventH = String(eventTime.h);
            const eventM = String(eventTime.m);
            const eventAMPM = String(eventTime.am_pm);

            // ===== THE TRIGGER (Java Clock1.java logic) =====
            // if (currentH == eventH && currentM == eventM && currentAMPM == eventAMPM && flag == 1)
            if (
                String(currentH) === eventH
                && String(currentM) === eventM
                && String(currentAMPM) === eventAMPM
                && event.isDismissed === false
                && flag === 1
            ) {
                const secondKey = `${event._id || event.title}:${currentH}:${currentM}:${currentAMPM}:${currentSecond}`;
                if (lastTriggeredSecondKey === secondKey) {
                    return;
                }

                // Prevent this specific event from triggering again this minute
                if (lastAlarmId === event._id || lastAlarmId === event.title) {
                    return; // Already triggered for this event in this minute
                }

                // Lock trigger immediately to avoid duplicate starts in this second.
                lastTriggeredSecondKey = secondKey;

                // TRIGGER THE ALARM
                lastAlarmId = event._id || event.title;
                currentAlarmEvent = event;
                currentAlarmSource = 'event';

                showAlarmModal(event);
                startBeeping();
            }
        });

        if (!Array.isArray(routineTasks)) return;

        routineTasks.forEach((task) => {
            if (!task.alarmEnabled) return;
            if (task.isDismissed) return;
            if (!task.time) return;

            if (task.time === currentHHMM && flag === 1) {
                const secondKey = `${task._id || task.title}:${currentHHMM}:${currentSecond}`;
                if (lastTriggeredSecondKey === secondKey) {
                    return;
                }

                if (lastAlarmId === task._id || lastAlarmId === task.title) {
                    return;
                }

                lastTriggeredSecondKey = secondKey;
                lastAlarmId = task._id || task.title;
                currentAlarmEvent = task;
                currentAlarmSource = 'routine';

                showAlarmModal(task);
                startBeeping();
            }
        });
    } catch (err) {
        // Keep alarm engine silent in background mode.
    }
}

// ============================================================================
// RESET: flag should reset when minute changes
// ============================================================================

let lastMinuteChecked = -1;

function checkAndResetFlag() {
    const now = new Date();
    const currentMinute = now.getMinutes();

    if (currentMinute !== lastMinuteChecked) {
        flag = 1; // Reset flag for new minute
        lastTriggeredSecondKey = null;
        lastMinuteChecked = currentMinute;
    }
}

// ============================================================================
// UTILITY: Check if backend is reachable
// ============================================================================

async function isBackendReachable() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

        const response = await fetch('http://localhost:5000/api/health', {
            method: 'HEAD',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch (err) {
        // Backend unreachable, down, or timeout
        return false;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function startAlarmEngine() {
    // Only proceed if user is logged in
    const token = localStorage.getItem('authToken');
    if (!token) {
        return;
    }

    refreshAlarmEvents(true);
    refreshAlarmRoutineTasks(true);

    // Wrap the entire setInterval callback in try...catch to handle any errors
    setInterval(async () => {
        if (watchdogBusy) return;

        watchdogBusy = true;
        try {
            checkAndResetFlag();
            await backgroundWatchdog();
        } catch (err) {
            // Keep alarm engine silent in background mode.
        } finally {
            watchdogBusy = false;
        }
    }, 1000);

    setInterval(() => {
        refreshAlarmEvents(true);
        refreshAlarmRoutineTasks(true);
    }, 15000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshAlarmEvents(true);
            refreshAlarmRoutineTasks(true);
        }
    });

    window.addEventListener('focus', () => {
        refreshAlarmEvents(true);
        refreshAlarmRoutineTasks(true);
    });
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    startAlarmEngine();
});