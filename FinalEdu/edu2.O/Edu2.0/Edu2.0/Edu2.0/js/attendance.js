const ACADEMIC_API_BASE = 'https://edusync-life-production.up.railway.app/api/academic';
let attendanceSheets = [];

function getToken() {
    return localStorage.getItem('token') || localStorage.getItem('authToken');
}

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
    };
}

function toNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function totalClassesFromCredits(credits) {
    const safeCredits = Math.max(0, toNumber(credits));
    return Math.max(1, Math.round(safeCredits * 13));
}

function normalizeSheet(item = {}) {
    const courseId = String(item.courseId || `${Date.now()}-${Math.floor(Math.random() * 1000)}`);
    const courseName = String(item.courseName || '').trim() || 'Untitled Course';
    const credits = Math.max(0, toNumber(item.credits));
    const totalSlots = totalClassesFromCredits(credits);

    const absentStates = Array.isArray(item.classAbsentStates)
        ? item.classAbsentStates.map((v) => Boolean(v))
        : (Array.isArray(item.classStatuses)
            ? item.classStatuses.map((status) => status === 'A')
            : Array.from({ length: totalSlots }, () => false));

    const classAbsentStates = Array.from({ length: totalSlots }, (_, idx) => Boolean(absentStates[idx]));

    return {
        courseId,
        courseName,
        credits,
        classAbsentStates,
        dirty: false,
        isExpanded: false,
        lastUpdated: item.lastUpdated ? new Date(item.lastUpdated).toISOString() : new Date().toISOString()
    };
}

function getAbsentCount(sheet) {
    return sheet.classAbsentStates.filter((state) => state).length;
}

function getTotalClasses(sheet) {
    return sheet.classAbsentStates.length;
}

function getPresentCount(sheet) {
    return Math.max(0, getTotalClasses(sheet) - getAbsentCount(sheet));
}

function getMarksCalculation(sheet) {
    const credits = sheet.credits;
    const missed = getAbsentCount(sheet);
    const totalMarks = credits * 10;
    
    let marksLost = 0;
    if (missed > 0) {
        marksLost = Math.floor((missed - 1) / credits) * credits;
    }
    let obtainedMarks = Math.max(0, totalMarks - marksLost);
    if (missed > credits * 5) {
        obtainedMarks = 0;
    }
    
    return {
        obtainedMarks: Math.floor(obtainedMarks),
        totalMarks: totalMarks,
        marksLost: Math.floor(marksLost)
    };
}

function getStatusAndAdvice(sheet) {
    const credits = sheet.credits;
    const missed = getAbsentCount(sheet);
    
    let status = 'Safe';
    let statusColor = '#15803d'; // Green
    let backlogMsg = '';
    
    if (missed <= credits) {
        status = 'Safe';
        statusColor = '#15803d'; // Green
    } else if (missed <= credits * 3) {
        status = 'At Risk';
        statusColor = '#f59e0b'; // Orange
    } else if (missed <= credits * 5) {
        status = 'Critical';
        statusColor = '#ef4444'; // Red
    } else {
        status = 'Dead';
        statusColor = '#7f1d1d'; // Dark Red
        backlogMsg = ' (Backlog Warning)';
    }
    
    return {
        status: status,
        statusColor: statusColor,
        backlogMsg: backlogMsg
    };
}

function setDirty(courseId, dirty) {
    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    sheet.dirty = dirty;
    const saveBtn = document.getElementById(`saveAttendance-${courseId}`);
    const syncEl = document.getElementById(`syncAttendance-${courseId}`);

    if (saveBtn) {
        saveBtn.disabled = !dirty;
        saveBtn.style.opacity = dirty ? '1' : '0.45';
        saveBtn.style.cursor = dirty ? 'pointer' : 'not-allowed';
    }

    if (syncEl) {
        syncEl.innerText = dirty ? 'Unsaved changes' : 'All saved';
        syncEl.style.color = dirty ? '#b45309' : '#15803d';
    }
}

function updateStatsView(courseId) {
    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    const marksEl = document.getElementById(`marks-${courseId}`);
    const missedEl = document.getElementById(`missed-${courseId}`);
    const statusEl = document.getElementById(`status-${courseId}`);

    const marksInfo = getMarksCalculation(sheet);
    const missed = getAbsentCount(sheet);
    const total = getTotalClasses(sheet);
    const statusInfo = getStatusAndAdvice(sheet);

    if (marksEl) marksEl.innerText = `${marksInfo.obtainedMarks} / ${marksInfo.totalMarks}`;
    if (missedEl) missedEl.innerText = `${missed} / ${total}`;
    if (statusEl) {
        statusEl.innerHTML = `<span style="color: ${statusInfo.statusColor}; font-weight: bold;">${statusInfo.status}${statusInfo.backlogMsg}</span>`;
    }
}

function toggleCardExpand(courseId) {
    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    sheet.isExpanded = !sheet.isExpanded;
    renderSheets();
}

function onAbsentToggle(courseId, classIndex, checkboxEl) {
    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    sheet.classAbsentStates[classIndex] = checkboxEl.checked;
    sheet.lastUpdated = new Date().toISOString();

    setDirty(courseId, true);
    updateStatsView(courseId);
}

function buildSheetRows(sheet) {
    let html = '';
    for (let i = 0; i < sheet.classAbsentStates.length; i += 1) {
        html += `
            <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; align-items:center; background:#fff;">
                <span style="font-size:0.9rem;"><b>Class ${i + 1}</b></span>
                <label style="font-size:0.8rem; color:#bc4ca0; cursor:pointer;">
                    <input
                        type="checkbox"
                        id="absent-${sheet.courseId}-${i}"
                        ${sheet.classAbsentStates[i] ? 'checked' : ''}
                        onchange="onAbsentToggle('${sheet.courseId}', ${i}, this)"
                        style="width:auto !important; margin-right: 5px;"
                    > Mark Absent
                </label>
            </div>
        `;
    }
    return html;
}

function renderSheets() {
    const container = document.getElementById('attendanceCards');
    if (!container) return;

    container.innerHTML = '';
    if (!attendanceSheets.length) {
        container.innerHTML = '<div style="color:#64748b; font-size:0.9rem;">No saved sheets yet. Generate one above.</div>';
        return;
    }

    attendanceSheets.forEach((sheet) => {
        const card = document.createElement('section');
        card.className = 'card';
        card.style.background = '#fff';
        card.style.padding = '18px';
        card.style.border = '1px solid var(--border)';
        card.style.maxWidth = '760px';
        card.style.cursor = 'pointer';

        const marksInfo = getMarksCalculation(sheet);
        const statusInfo = getStatusAndAdvice(sheet);

        // Collapsed header (always visible)
        const headerHtml = `
            <div onclick="toggleCardExpand('${sheet.courseId}')" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none;">
                <div style="display:flex; align-items:center; gap:12px; flex:1;">
                    <span style="font-size:1.2rem; color:#64748b; transition:transform 0.3s ease;">${sheet.isExpanded ? '▼' : '▶'}</span>
                    <h3 style="margin:0; color:#3E2723;">${sheet.courseName}</h3>
                </div>
                <span style="font-size:0.82rem; color:#64748b;">Credits: ${sheet.credits}</span>
            </div>
        `;

        // Expanded content (hidden by default)
        const contentHtml = sheet.isExpanded ? `
            <div style="margin-top: 12px;">
                <div style="max-height: 300px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; margin-bottom: 14px; background:#fff;">
                    ${buildSheetRows(sheet)}
                </div>

                <div style="background: #f8fafc; padding: 15px; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 14px;">
                    <b>Stats for this Course:</b><br>
                    Marks: <span id="marks-${sheet.courseId}">${marksInfo.obtainedMarks} / ${marksInfo.totalMarks}</span><br>
                    Missed: <span id="missed-${sheet.courseId}">${getAbsentCount(sheet)} / ${getTotalClasses(sheet)}</span><br>
                    Status: <span id="status-${sheet.courseId}" style="color: ${statusInfo.statusColor}; font-weight: bold;">${statusInfo.status}${statusInfo.backlogMsg}</span>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span id="syncAttendance-${sheet.courseId}" style="font-size:0.8rem; color:#64748b;">${sheet.dirty ? 'Unsaved changes' : 'All saved'}</span>
                    <div style="display:flex; gap:10px;">
                        <button id="deleteAttendance-${sheet.courseId}" onclick="deleteAttendanceSheet('${sheet.courseId}')" style="border:none; background:#b91c1c; color:#fff; border-radius:8px; padding:8px 14px; font-weight:700; cursor:pointer; transition:all 0.3s ease;">Delete</button>
                        <button id="saveAttendance-${sheet.courseId}" onclick="saveAttendanceSheet('${sheet.courseId}', false)" ${sheet.dirty ? '' : 'disabled'} style="border:none; background:#2E7D32; color:#fff; border-radius:8px; padding:8px 14px; font-weight:700; opacity:${sheet.dirty ? '1' : '0.45'}; cursor:${sheet.dirty ? 'pointer' : 'not-allowed'}; transition:all 0.3s ease;">Save Changes</button>
                    </div>
                </div>
            </div>
        ` : '';

        card.innerHTML = headerHtml + contentHtml;
        container.appendChild(card);

        if (sheet.isExpanded) {
            updateStatsView(sheet.courseId);
        }
    });
}

function generateAttendanceSheet() {
    const nameEl = document.getElementById('courseName');
    const creditEl = document.getElementById('credit');

    const courseName = (nameEl.value || '').trim();
    const credits = Math.max(0, toNumber(creditEl.value));

    if (!courseName || credits <= 0) {
        showToast('Please enter a valid course name and credits', 'error');
        return;
    }

    const existing = attendanceSheets.find((item) => item.courseName.toLowerCase() === courseName.toLowerCase());
    if (existing) {
        renderSheets();
        return;
    }

    const totalSlots = totalClassesFromCredits(credits);
    const sheet = normalizeSheet({
        courseId: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        courseName,
        credits,
        classAbsentStates: Array.from({ length: totalSlots }, () => false),
        lastUpdated: new Date().toISOString()
    });

    sheet.dirty = true;
    attendanceSheets.push(sheet);

    nameEl.value = '';
    creditEl.value = '';

    renderSheets();
    setDirty(sheet.courseId, true);
}

async function saveAttendanceSheet(courseId, silent) {
    const token = getToken();
    if (!token) {
        if (!silent) showToast('Please login to save your attendance', 'warning');
        return;
    }

    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    const syncEl = document.getElementById(`syncAttendance-${courseId}`);
    const saveBtn = document.getElementById(`saveAttendance-${courseId}`);

    if (saveBtn) {
        saveBtn.innerText = '⏳ Saving...';
        saveBtn.disabled = true;
    }

    try {
        const response = await fetch(`${ACADEMIC_API_BASE}/strategist-settings`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                attendanceData: attendanceSheets.map((item) => ({
                    courseId: item.courseId,
                    courseName: item.courseName,
                    credits: item.credits,
                    classesPresent: getPresentCount(item),
                    totalClasses: getTotalClasses(item),
                    classAbsentStates: item.classAbsentStates,
                    classStatuses: item.classAbsentStates.map((absent) => (absent ? 'A' : 'P')),
                    lastUpdated: item.lastUpdated
                }))
            })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error('Save failed');
        }

        setDirty(courseId, false);
        if (syncEl) {
            syncEl.innerText = 'All saved';
            syncEl.style.color = '#15803d';
        }
        if (saveBtn) {
            saveBtn.innerText = '✅ Saved';
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.45';
            saveBtn.style.cursor = 'not-allowed';
            setTimeout(() => {
                if (saveBtn && !sheet.dirty) {
                    saveBtn.innerText = 'Save Changes';
                }
            }, 2000);
        }
    } catch (error) {
        console.error('Attendance save error:', error);
        if (syncEl) {
            syncEl.innerText = 'Save failed';
            syncEl.style.color = '#dc2626';
        }
        if (saveBtn) {
            saveBtn.innerText = 'Save Changes';
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
        }
        if (!silent) {
            showToast('Failed to save your attendance. Please try again', 'error');
        }
    }
}

async function deleteAttendanceSheet(courseId) {
    const token = getToken();
    if (!token) {
        showToast('Please login to delete your attendance', 'warning');
        return;
    }

    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    const dialogConfirmed = await showConfirmDialog(`Delete attendance course "${sheet.courseName}"? This cannot be undone.`);
    if (!dialogConfirmed) return;

    const nextSheets = attendanceSheets.filter((item) => item.courseId !== courseId);

    try {
        const response = await fetch(`${ACADEMIC_API_BASE}/strategist-settings`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                attendanceData: nextSheets.map((item) => ({
                    courseId: item.courseId,
                    courseName: item.courseName,
                    credits: item.credits,
                    classesPresent: getPresentCount(item),
                    totalClasses: getTotalClasses(item),
                    classAbsentStates: item.classAbsentStates,
                    classStatuses: item.classAbsentStates.map((absent) => (absent ? 'A' : 'P')),
                    lastUpdated: item.lastUpdated
                }))
            })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error('Delete failed');
        }

        attendanceSheets = nextSheets;
        renderSheets();
    } catch (error) {
        console.error('Attendance delete error:', error);
        showToast('Failed to delete the course. Please try again', 'error');
    }
}

window.deleteAttendanceSheet = deleteAttendanceSheet;

async function loadAttendanceSheets() {
    const token = getToken();
    if (!token) {
        attendanceSheets = [];
        renderSheets();
        return;
    }

    try {
        const response = await fetch(`${ACADEMIC_API_BASE}/strategist-settings`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const result = await response.json();

        if (response.ok && result.success) {
            const settings = (result.data || [])[0] || {};
            const attendanceData = Array.isArray(settings.attendanceData) ? settings.attendanceData : [];
            attendanceSheets = attendanceData.map((item) => normalizeSheet(item));
        } else {
            attendanceSheets = [];
        }
    } catch (error) {
        console.error('Failed to load attendance sheets:', error);
        attendanceSheets = [];
    }

    renderSheets();
}

document.addEventListener('DOMContentLoaded', () => {
    loadAttendanceSheets();
});
