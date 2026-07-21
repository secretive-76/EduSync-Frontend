let routineTasks = [];
let allTasks = [];
let myChart;
const reminderLog = new Set();

function isDarkMode() {
    return document.documentElement.classList.contains('dark-mode')
        || document.documentElement.classList.contains('dark-theme')
        || document.documentElement.getAttribute('data-theme') === 'dark';
}

function getRoutineChartColors() {
    const dark = isDarkMode();
    return {
        text: dark ? '#b2bec3' : '#000000',
        grid: dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(44, 62, 80, 0.10)',
        line: dark ? '#f5f5f5' : '#8B4513',
        fill: dark ? 'rgba(245, 245, 245, 0.14)' : 'rgba(188, 76, 160, 0.12)',
        background: dark ? '#1e272e' : 'transparent'
    };
}

const API_ROOT = window.API_BASE_URL || 'https://edusync-life-1.onrender.com';
const getApiUrl = window.getApiUrl || function (endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${API_ROOT}${cleanEndpoint}`;
};
const API_BASE = getApiUrl('/api/routine');
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getAuthToken() {
    return localStorage.getItem('authToken');
}

function getSelectedDate() {
    return document.getElementById('routineDate').value;
}

function getDayOfWeek(dateStr) {
    const date = new Date(`${dateStr}T00:00:00`);
    return DAYS[date.getDay()];
}

async function apiRequest(url, options = {}) {
    const token = getAuthToken();
    if (!token) {
        throw new Error('Missing auth token');
    }

    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`
        }
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error(result.message || 'Request failed');
    }

    return result;
}

// Request notification permission for reminders
if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('routineDate');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
        dateInput.addEventListener('change', () => {
            loadRoutine();
            fetchAllTasks();
        });
    }

    loadRoutine();
    fetchAllTasks();

    setInterval(() => {
        loadRoutine();
        checkReminders();
    }, 30000);

    window.addEventListener('themechange', () => {
        const modal = document.getElementById('statsModal');
        if (modal && modal.style.display === 'block') {
            updateChart('weekly');
        }
    });
});

// --- MODAL LOGIC ---
function openStats() {
    document.getElementById('statsModal').style.display = 'block';
    updateChart('weekly');
}

function closeStats() {
    document.getElementById('statsModal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('statsModal');
    if (event.target === modal) {
        closeStats();
    }
};

async function fetchRoutineTasks() {
    const selectedDate = getSelectedDate();
    const dayOfWeek = getDayOfWeek(selectedDate);
    const result = await apiRequest(`${API_BASE}?dayOfWeek=${dayOfWeek}`);
    routineTasks = result.data || [];
}

async function fetchAllTasks() {
    try {
        const result = await apiRequest(API_BASE);
        allTasks = result.data || [];
    } catch (error) {
        allTasks = [];
    }
}

async function loadRoutine() {
    const selectedDate = getSelectedDate();
    const listContainer = document.getElementById('taskList');
    const displayDate = document.getElementById('displayDate');

    if (!selectedDate || !listContainer) return;

    displayDate.innerText = new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    try {
        await fetchRoutineTasks();
    } catch (error) {
        listContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 20px;">Unable to load routine tasks.</p>';
        return;
    }

    listContainer.innerHTML = '';
    const now = new Date();

    if (routineTasks.length === 0) {
        listContainer.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">No tasks scheduled for this day.</p>';
    } else {
        routineTasks.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        routineTasks.forEach((task) => {
            const isAlarmEnabled = task.alarmEnabled !== undefined ? Boolean(task.alarmEnabled) : Boolean(task.reminder);
            const taskDateTime = task.time
                ? new Date(`${selectedDate}T${task.time}:00`)
                : new Date(`${selectedDate}T00:00:00`);
            const isTimeArrived = now >= taskDateTime;
            const isRingingOrOverdue = isAlarmEnabled && !task.isCompleted && !task.isDismissed && task.time && now > taskDateTime;

            const taskDiv = document.createElement('div');
            taskDiv.className = 'task-item';
            if (isRingingOrOverdue) {
                taskDiv.classList.add('task-ringing');
            }

            let statusClass = isTimeArrived ? 'ready' : 'locked';
            if (task.isCompleted) statusClass = 'completed';

            taskDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <input type="checkbox"
                        ${task.isCompleted ? 'checked' : ''}
                        ${!isTimeArrived ? 'disabled' : ''}
                        onchange="toggleTask('${task._id}', ${task.isCompleted})"
                        style="width: 18px; height: 18px; cursor: ${isTimeArrived ? 'pointer' : 'not-allowed'}">
                    <div>
                        <span class="${statusClass}" style="font-size: 1rem;">${task.title}</span>
                        <div style="font-size: 0.75rem; color: #64748b; display: flex; gap: 10px; align-items: center;">
                            ⏰ ${task.time || '00:00'} ${!isTimeArrived ? '(Locked)' : ''}
                            ${isAlarmEnabled ? '<span class="reminder-tag">🔔 Alarm Active</span>' : ''}
                        </div>
                    </div>
                </div>
                <div>
                    <button class="btn-action routine-alarm-toggle ${isAlarmEnabled ? 'enabled' : ''}" onclick="toggleTaskAlarm('${task._id}', ${isAlarmEnabled})">
                        ${isAlarmEnabled ? '🔕 Disable' : '🔔 Enable'}
                    </button>
                    <button class="btn-action btn-edit" onclick="editTask('${task._id}', '${(task.title || '').replace(/'/g, "\\'")}', '${task.time || ''}')">Edit</button>
                    <button class="btn-action btn-delete" onclick="deleteTask('${task._id}')">Delete</button>
                </div>
            `;
            listContainer.appendChild(taskDiv);
        });
    }

    calculatePercentage();
}

async function addTask() {
    const date = getSelectedDate();
    const time = document.getElementById('newTaskTime').value;
    const name = document.getElementById('newTaskName').value;
    const reminder = document.getElementById('reminderNeeded').checked;

    if (!date || !time || !name) {
        alert('Add both the task time and task name, and you are good to go. ✍️');
        return;
    }

    try {
        await apiRequest(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: name,
                scheduledDate: `${date}T00:00:00`,
                dayOfWeek: getDayOfWeek(date),
                time,
                reminder,
                alarmEnabled: reminder
            })
        });

        document.getElementById('newTaskName').value = '';
        document.getElementById('newTaskTime').value = '';
        document.getElementById('reminderNeeded').checked = false;
        await loadRoutine();
        await fetchAllTasks();
    } catch (error) {
        alert("Oops! We couldn't add that task right now. Please try again. 🛠️");
    }
}

async function editTask(taskId, currentTitle, currentTime) {
    const newName = prompt('Edit Task Description:', currentTitle);
    const newTime = prompt('Edit Time (HH:MM):', currentTime);

    if (!newName || !newTime) return;

    try {
        await apiRequest(`${API_BASE}/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newName, time: newTime })
        });
        await loadRoutine();
        await fetchAllTasks();
    } catch (error) {
        alert("We couldn't update this task just yet. Let's try again. 🛠️");
    }
}

async function toggleTask(taskId, currentState) {
    try {
        await apiRequest(`${API_BASE}/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isCompleted: !currentState })
        });
        await loadRoutine();
        await fetchAllTasks();
    } catch (error) {
        alert("We couldn't sync that task status right now. Please retry. 🛠️");
    }
}

async function deleteTask(taskId) {
    if (!confirm('Delete this task?')) return;

    try {
        await apiRequest(`${API_BASE}/${taskId}`, { method: 'DELETE' });
        await loadRoutine();
        await fetchAllTasks();
    } catch (error) {
        alert("We couldn't delete that task yet. Please give it one more try. 🛠️");
    }
}

function calculatePercentage() {
    const scoreDisplay = document.getElementById('successPercent');
    const quoteDisplay = document.getElementById('motivationQuote');

    let percent;
    if (routineTasks.length === 0) {
        percent = 100;
    } else {
        const done = routineTasks.filter((t) => t.isCompleted).length;
        percent = Math.round((done / routineTasks.length) * 100);
    }

    scoreDisplay.innerText = `${percent}%`;
    if (quoteDisplay) {
        quoteDisplay.innerText = getMotivation(percent);
    }
}

function checkReminders() {
    const selectedDate = getSelectedDate();
    const now = new Date();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    routineTasks.forEach((task) => {
        const reminderKey = `${task._id}-${selectedDate}-${currentHHMM}`;
        const isAlarmEnabled = task.alarmEnabled !== undefined ? Boolean(task.alarmEnabled) : Boolean(task.reminder);
        if (isAlarmEnabled && !task.isCompleted && task.time && currentHHMM >= task.time && !reminderLog.has(reminderKey)) {
            if (Notification.permission === 'granted') {
                new Notification('EduSync Routine', {
                    body: `Time for: ${task.title}`,
                    icon: 'https://cdn-icons-png.flaticon.com/512/311/311024.png'
                });
            } else {
                alert(`⏰ Gentle reminder: it's time for ${task.title}. You got this!`);
            }
            reminderLog.add(reminderKey);
        }
    });
}

async function updateChart(viewType) {
    const canvas = document.getElementById('performanceChart');
    if (!canvas) return;

    if (allTasks.length === 0) {
        await fetchAllTasks();
    }

    const ctx = canvas.getContext('2d');
    const chartColors = getRoutineChartColors();
    const labels = [];
    const successData = [];
    const daysToLookBack = viewType === 'monthly' ? 30 : 7;

    const byDay = {};
    allTasks.forEach((task) => {
        const key = task.dayOfWeek;
        if (!byDay[key]) byDay[key] = { total: 0, done: 0 };
        byDay[key].total += 1;
        if (task.isCompleted) byDay[key].done += 1;
    });

    if (viewType === 'yearly') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        months.forEach((month, index) => {
            labels.push(month);
            const dayName = DAYS[index % 7];
            const stats = byDay[dayName] || { total: 0, done: 0 };
            successData.push(stats.total === 0 ? 100 : Math.round((stats.done / stats.total) * 100));
        });
    } else {
        for (let i = daysToLookBack - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            labels.push(label);

            const dayName = DAYS[d.getDay()];
            const stats = byDay[dayName] || { total: 0, done: 0 };
            successData.push(stats.total === 0 ? 100 : Math.round((stats.done / stats.total) * 100));
        }
    }

    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: viewType === 'yearly' ? 'bar' : 'line',
        data: {
            labels,
            datasets: [{
                label: `Success % (${viewType})`,
                data: successData,
                borderColor: chartColors.line,
                backgroundColor: viewType === 'yearly' ? chartColors.line : chartColors.fill,
                pointBackgroundColor: chartColors.line,
                pointBorderColor: chartColors.line,
                pointHoverBackgroundColor: '#ffffff',
                pointHoverBorderColor: chartColors.line,
                pointRadius: viewType === 'yearly' ? 3 : 4,
                pointHoverRadius: 5,
                borderWidth: 2,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 30,
                    right: 10,
                    bottom: 20,
                    left: 10
                }
            },
            backgroundColor: chartColors.background,
            scales: {
                x: {
                    ticks: {
                        padding: 8,
                        color: chartColors.text,
                        font: {
                            weight: 600
                        }
                    },
                    grid: {
                        color: chartColors.grid
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        color: chartColors.text,
                        font: {
                            weight: 600
                        }
                    },
                    grid: {
                        color: chartColors.grid
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDarkMode() ? '#1f2937' : '#ffffff',
                    titleColor: isDarkMode() ? '#ffffff' : '#000000',
                    bodyColor: isDarkMode() ? '#ffffff' : '#000000',
                    borderColor: isDarkMode() ? '#555555' : '#d1d5db',
                    borderWidth: 1,
                    displayColors: false,
                    titleFont: {
                        weight: 700
                    },
                    bodyFont: {
                        weight: 600
                    }
                }
            }
        }
    });
}
function getMotivation(percent) {
    const quotes = {
        perfect: [
            "Flawless victory! You're unstoppable today.",
            "100% effort looks good on you. Keep that momentum!",
            "Master of your routine. What's your secret?"
        ],
        high: [
            "Almost there! You're crushing your goals.",
            "Great discipline. Success is built on days like this.",
            "You're in the zone. Don't stop now!"
        ],
        mid: [
            "Steady progress is still progress.",
            "Consistency is better than perfection. Keep going!",
            "You've started the engine—now keep it running."
        ],
        low: [
            "Small steps are better than no steps. Do one more task!",
            "Don't let the clock bully you. You've got time to turn this around.",
            "Focus on the next task, not the ones you missed."
        ],
        empty: [
            "A clean slate! What will you achieve today?",
            "Your journey starts with the first checkmark.",
            "Ready to synchronize your life? Add your first task!"
        ]
    };

    let category;
    if (percent === 100) category = "perfect";
    else if (percent >= 75) category = "high";
    else if (percent >= 40) category = "mid";
    else if (percent > 0) category = "low";
    else category = "empty";

    const selection = quotes[category];
    return selection[Math.floor(Math.random() * selection.length)];
}

async function toggleTaskAlarm(taskId, currentAlarmEnabled) {
    try {
        await apiRequest(`${API_BASE}/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alarmEnabled: !currentAlarmEnabled })
        });
        await loadRoutine();
        await fetchAllTasks();
    } catch (error) {
        alert("We couldn't update the alarm setting just now. Please try again. 🛠️");
    }
}