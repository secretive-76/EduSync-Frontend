let currentDate = new Date();
let selectedDate = null;
let eventsByDate = {};
let allEvents = [];
let editingEventId = null;

const API_BASE = 'https://edusync-life-production.up.railway.app/api/calendar';

function getAuthToken() {
    return localStorage.getItem('authToken');
}

function toDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function normalizeTime24(value) {
    if (!value || typeof value !== 'string') return '00:00';
    const match = value.trim().match(/^([0-1]\d|2[0-3]):([0-5]\d)$/);
    return match ? match[0] : '00:00';
}

function getEventTime24(event) {
    if (event.time) return normalizeTime24(event.time);

    const eventDate = new Date(event.date);
    if (Number.isNaN(eventDate.getTime())) return '00:00';

    const hours = String(eventDate.getHours()).padStart(2, '0');
    const minutes = String(eventDate.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function getEventDateKey(event) {
    const eventDate = new Date(event.date);
    return toDateKey(eventDate);
}

function buildEventKey(event) {
    return `${event._id}:${getEventDateKey(event)}:${getEventTime24(event)}`;
}

function checkRecurringEvent(eventDate, repeatType, checkYear, checkMonth, checkDay) {
    const eventStartDate = new Date(eventDate);
    const checkDate = new Date(checkYear, checkMonth, checkDay);
    eventStartDate.setHours(0, 0, 0, 0);

    // If check date is before event start date, it doesn't match
    if (checkDate < eventStartDate) return false;

    if (repeatType === 'none') return false;

    const eventMonth = eventStartDate.getMonth();
    const eventDay = eventStartDate.getDate();
    const eventDayOfWeek = eventStartDate.getDay();

    if (repeatType === 'weekly') {
        return checkDate.getDay() === eventDayOfWeek;
    } else if (repeatType === 'monthly') {
        return checkDate.getDate() === eventDay;
    } else if (repeatType === 'yearly') {
        return checkDate.getMonth() === eventMonth && checkDate.getDate() === eventDay;
    }

    return false;
}

function matchesEventOnDate(event, targetDate) {
    const eventDate = new Date(event.date);
    const targetDateKey = toDateKey(targetDate);
    const eventDateKey = toDateKey(eventDate);

    if (eventDateKey === targetDateKey) {
        return true;
    }

    const repeatType = event.repeat || 'none';
    if (repeatType === 'none') return false;

    return checkRecurringEvent(eventDate, repeatType, targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
}

function getEventsForDate(y, m, d) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let matchingEvents = eventsByDate[key] ? [...eventsByDate[key]] : [];

    // Also check for recurring events that match this date
    allEvents.forEach((event) => {
        const eventDate = new Date(event.date);
        const repeatType = event.repeat || 'none';

        if (repeatType !== 'none' && checkRecurringEvent(eventDate, repeatType, y, m, d)) {
            // Check if this recurring event isn't already in the matched list (avoid duplicates)
            if (!matchingEvents.find((e) => e._id === event._id && toDateKey(new Date(e.date)) === key)) {
                matchingEvents.push(event);
            }
        }
    });

    return matchingEvents;
}

function buildEventsByDate(events) {
    const grouped = {};

    events.forEach((event) => {
        const eventDate = new Date(event.date);
        const key = toDateKey(eventDate);

        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(event);
    });

    Object.keys(grouped).forEach((key) => {
        grouped[key].sort((a, b) => new Date(a.date) - new Date(b.date));
    });

    eventsByDate = grouped;
    allEvents = events;
}

async function fetchMonthEvents() {
    const token = getAuthToken();
    if (!token) {
        eventsByDate = {};
        allEvents = [];
        return;
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    try {
        const response = await fetch(`${API_BASE}?year=${year}&month=${month}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const result = await response.json();

        if (response.ok && result.success) {
            buildEventsByDate(result.data || []);
            return;
        }
    } catch (error) {
        console.error('Failed to fetch calendar events:', error);
    }

    eventsByDate = {};
    allEvents = [];
}

function renderCalendar() {
    const calendar = document.getElementById("calendar");
    const monthYear = document.getElementById("monthYear");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = new Date();

    if (!calendar || !monthYear) return;
    calendar.innerHTML = "";

    // Render Day Names
    days.forEach(d => {
        const div = document.createElement("div");
        div.className = "day-name";
        div.innerText = d;
        calendar.appendChild(div);
    });

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    monthYear.innerText = currentDate.toLocaleString("default", { month: "long", year: "numeric" });

    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Fill empty slots
    for (let i = 0; i < firstDay; i++) calendar.appendChild(document.createElement("div"));

    // Render actual days
    for (let day = 1; day <= totalDays; day++) {
        // We use YYYY-MM-DD for consistency with Dashboard
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const cell = document.createElement("div");
        cell.className = "day";
        cell.setAttribute('data-date', dateKey);

        // Apply active-date class if this is the selected date
        if (selectedDate === dateKey) {
            cell.classList.add('active-date');
        }

        if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            cell.style.backgroundColor = "#fff5fb";
            cell.style.border = "2px solid #8B4513";
        }

        const dayEventsData = getEventsForDate(year, month, day);
        
        cell.onclick = () => openModal(dateKey);

        cell.innerHTML = `<div class="date-number" style="font-weight:bold; margin-bottom:5px;">${day}</div>`;

        dayEventsData.forEach((e) => {
            const ev = document.createElement("div");
            ev.className = "event-tag"; // Matches your CSS
            ev.style.backgroundColor = e.color || "#8B4513";
            ev.style.color = "white";
            ev.style.fontSize = "0.7rem";
            ev.style.padding = "2px 4px";
            ev.style.borderRadius = "3px";
            ev.style.marginBottom = "2px";
            const repeatIcon = (e.repeat && e.repeat !== 'none') ? '🔁 ' : '';
            ev.innerText = repeatIcon + e.title;
            cell.appendChild(ev);
        });
        calendar.appendChild(cell);
    }
}

function selectDate(dateKey) {
    // Remove active-date class from all cells
    document.querySelectorAll('.day.active-date').forEach(cell => {
        cell.classList.remove('active-date');
    });

    // Add active-date class to the clicked cell
    const selectedCell = document.querySelector(`[data-date="${dateKey}"]`);
    if (selectedCell) {
        selectedCell.classList.add('active-date');
    }

    selectedDate = dateKey;
}

function openModal(dateKey) {
    selectDate(dateKey);
    document.getElementById("modalDateTitle").innerText = dateKey;
    refreshEventList();
    resetForm();
    document.getElementById("eventModal").style.display = "flex";
}

function refreshEventList() {
    const container = document.getElementById("eventListContainer");
    container.innerHTML = "";
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dayEvents = getEventsForDate(y, m - 1, d);

    dayEvents.forEach(e => {
        const readableTime = getEventTime24(e);

        const repeatLabel = (e.repeat && e.repeat !== 'none') ? ` 🔁 (${e.repeat})` : '';
        const row = document.createElement("div");
        row.style = `display:flex; justify-content:space-between; padding:8px; background:#f0f0f0; margin-bottom:5px; border-radius:5px; border-left:4px solid ${e.color}`;
        row.innerHTML = `
            <span>${e.title}${repeatLabel} (${readableTime})</span>
            <div style="display:flex; gap:8px; align-items:center;">
                <button onclick="startEditEvent('${e._id}')" style="border:none; background:none; cursor:pointer;">✏️ Edit</button>
                <button onclick="deleteEvent('${e._id}')" style="border:none; background:none; cursor:pointer;">🗑️ Delete</button>
            </div>
        `;
        container.appendChild(row);
    });
}

async function saveEvent() {
    const title = document.getElementById("eventTitle").value;
    const time = document.getElementById("eventTime").value;
    const color = document.getElementById("eventCategory").value;
    const repeat = document.getElementById("eventRepeat").value;
    const description = document.getElementById("eventDescription").value;
    const reminder = document.getElementById("reminder").checked;
    const token = getAuthToken();

    if (!title) return showToast('Please enter an event title', 'error');
    if (!token) return showToast('Please login first', 'warning');

    const categoryOption = document.querySelector('#eventCategory option:checked');
    const category = categoryOption ? categoryOption.textContent.split('(')[0].trim() : 'General';
    const normalizedTime = normalizeTime24(time || '00:00');
    const eventDate = new Date(`${selectedDate}T${normalizedTime}:00`);
    const isUpdate = Boolean(editingEventId);

    try {
        const response = await fetch(isUpdate ? `${API_BASE}/${editingEventId}` : API_BASE, {
            method: isUpdate ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            // Send local YYYY-MM-DD date string instead of an ISO string to avoid timezone shifts
            body: JSON.stringify({ title, date: selectedDate, time: normalizedTime, category, color, repeat, description, reminder })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            await fetchMonthEvents();
            closeModal();
            renderCalendar();
            resetForm();
            return;
        }
    } catch (error) {
        console.error('Failed to save event:', error);
    }

    showToast('Failed to save your event. Please try again', 'error');
}

async function deleteEvent(eventId) {
    const token = getAuthToken();
    if (!token) return;

    const confirmed = await showConfirmDialog('Delete this event?');
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/${eventId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });

        const result = await response.json();
        if (response.ok && result.success) {
            if (editingEventId === eventId) {
                resetForm();
            }
            await fetchMonthEvents();
            renderCalendar();
            if (selectedDate) {
                refreshEventList();
            }
        }
    } catch (error) {
        console.error('Failed to delete event:', error);
    }

    refreshEventList();
}

function startEditEvent(eventId) {
    const event = allEvents.find((item) => item._id === eventId);
    if (!event) return;

    editingEventId = eventId;
    selectedDate = toDateKey(new Date(event.date));

    document.getElementById('modalDateTitle').innerText = `Edit Event - ${selectedDate}`;
    document.getElementById('eventTitle').value = event.title || '';
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventRepeat').value = event.repeat || 'none';
    document.getElementById('eventCategory').value = event.color || '#bc4ca0';
    document.getElementById('eventTime').value = getEventTime24(event);
    document.getElementById('reminder').checked = Boolean(event.reminder);
    document.getElementById('saveBtn').innerText = 'Update Event';
    document.getElementById('eventModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById("eventModal").style.display = "none";
    resetForm();
}

function resetForm() {
    document.getElementById("eventTitle").value = "";
    document.getElementById("eventTime").value = "";
    document.getElementById("eventRepeat").value = "none";
    document.getElementById("eventDescription").value = "";
    document.getElementById("reminder").checked = false;
    document.getElementById('saveBtn').innerText = 'Save';
    editingEventId = null;
}
async function prevMonth() { currentDate.setMonth(currentDate.getMonth() - 1); await fetchMonthEvents(); renderCalendar(); }
async function nextMonth() { currentDate.setMonth(currentDate.getMonth() + 1); await fetchMonthEvents(); renderCalendar(); }

async function changeYear(step) {
    currentDate.setFullYear(currentDate.getFullYear() + step);
    await fetchMonthEvents();
    renderCalendar();
}

async function goToDate() {
    const searchDate = document.getElementById('searchDate').value;
    if (!searchDate) return;

    const target = new Date(`${searchDate}T00:00:00`);
    if (Number.isNaN(target.getTime())) return;

    currentDate = target;
    await fetchMonthEvents();
    renderCalendar();
}

document.addEventListener('DOMContentLoaded', async () => {
    await fetchMonthEvents();
    renderCalendar();
});