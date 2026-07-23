const DEFAULT_API_BASE_URL = 'https://edusync-life-1.onrender.com';

const resolveApiBaseUrl = window.resolveApiBaseUrl || function () {
    const configuredBase = typeof window.API_BASE_URL === 'string' ? window.API_BASE_URL.trim() : '';
    if (configuredBase) {
        return configuredBase.replace(/\/+$/, '');
    }

    const { protocol, hostname } = window.location;
    if (protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
        return 'http://localhost:5000';
    }

    return DEFAULT_API_BASE_URL;
};
const API_ROOT = resolveApiBaseUrl();
const getApiUrl = window.getApiUrl || function (endpoint = '', params) {
    const baseUrl = API_ROOT;
    const rawEndpoint = String(endpoint).trim();
    const normalizedEndpoint = rawEndpoint
        ? (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawEndpoint)
            ? rawEndpoint
            : (() => {
                const [pathPart, queryPart = ''] = rawEndpoint.split('?');
                const cleanPath = pathPart.replace(/^\/+|\/+$/g, '');
                const normalizedPath = cleanPath ? `/${cleanPath}` : '';
                return queryPart ? `${normalizedPath}?${queryPart}` : normalizedPath;
            })())
        : '';

    if (!params) {
        return normalizedEndpoint ? `${baseUrl}${normalizedEndpoint}` : baseUrl;
    }

    const [pathPart, existingQuery = ''] = normalizedEndpoint.split('?');
    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        queryParams.set(key, String(value));
    });

    const queryString = queryParams.toString();
    const mergedQuery = [existingQuery, queryString].filter(Boolean).join('&');
    return mergedQuery ? `${baseUrl}${pathPart}?${mergedQuery}` : `${baseUrl}${pathPart}`;
};
const ACADEMIC_API_BASE = getApiUrl('/api/academic');
const ATTENDANCE_CACHE_KEY = 'edusync-attendance-cache';
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

function buildAttendancePayload() {
    return attendanceSheets.map((sheet) => ({
        courseId: sheet.courseId,
        courseName: sheet.courseName,
        credits: sheet.credits,
        classesPresent: getPresentCount(sheet),
        totalClasses: getTotalClasses(sheet),
        classAbsentStates: sheet.classAbsentStates,
        classStatuses: sheet.classAbsentStates.map((absent) => (absent ? 'A' : 'P')),
        lastUpdated: sheet.lastUpdated
    }));
}

function saveAttendanceCache() {
    try {
        localStorage.setItem(ATTENDANCE_CACHE_KEY, JSON.stringify(buildAttendancePayload()));
    } catch (error) {
        console.warn('Failed to save attendance cache:', error);
    }
}

function loadAttendanceCache() {
    try {
        const raw = localStorage.getItem(ATTENDANCE_CACHE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((item) => normalizeSheet(item)) : [];
    } catch (error) {
        console.warn('Failed to load attendance cache:', error);
        return [];
    }
}

function mergeAttendanceSources(serverSheets = [], cachedSheets = []) {
    const merged = new Map();

    cachedSheets.forEach((sheet) => {
        merged.set(sheet.courseId, sheet);
    });

    serverSheets.forEach((sheet) => {
        merged.set(sheet.courseId, sheet);
    });

    return Array.from(merged.values());
}

function clearAllDirtyStates() {
    attendanceSheets.forEach((sheet) => {
        sheet.dirty = false;
    });
}

async function persistAttendanceSheets(silent = false) {
    const token = getToken();
    if (!token) {
        saveAttendanceCache();
        if (!silent) alert('Please sign in first so we can sync your attendance securely. 🔐');
        return false;
    }

    try {
        const response = await fetch(getApiUrl('/api/academic/strategist-settings'), {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                attendanceData: buildAttendancePayload()
            })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error('Save failed');
        }

        saveAttendanceCache();
        clearAllDirtyStates();
        renderSheets();
        return true;
    } catch (error) {
        console.error('Attendance save error:', error);
        saveAttendanceCache();
        if (!silent) {
            alert("Oops! We couldn't sync your attendance just yet. Please try again. 🛠️");
        }
        return false;
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

async function deleteAttendanceSheet(courseId) {
    const sheetIndex = attendanceSheets.findIndex((item) => item.courseId === courseId);
    if (sheetIndex < 0) return;

    const confirmed = window.confirm('Delete this course and all of its attendance data?');
    if (!confirmed) return;

    const token = getToken();
    if (!token) {
        alert('Please sign in first so we can sync your attendance securely. 🔐');
        return;
    }

    const removedSheet = attendanceSheets.splice(sheetIndex, 1)[0];
    saveAttendanceCache();
    const saved = await persistAttendanceSheets(true);

    if (!saved) {
        attendanceSheets.splice(sheetIndex, 0, removedSheet);
        saveAttendanceCache();
        renderSheets();
        alert("Oops! We couldn't delete that course on the server. Please try again. 🛠️");
    }
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

                <div style="display:flex; justify-content:space-between; align-items:center; gap: 10px; flex-wrap: wrap;">
                    <span id="syncAttendance-${sheet.courseId}" style="font-size:0.8rem; color:#64748b;">${sheet.dirty ? 'Unsaved changes' : 'All saved'}</span>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <button onclick="deleteAttendanceSheet('${sheet.courseId}')" style="border:1px solid #dc2626; background:#fff; color:#dc2626; border-radius:8px; padding:8px 14px; font-weight:700; cursor:pointer; transition:all 0.3s ease;">Delete Course</button>
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
        alert('Quick check: please add a valid course name and credit value to continue. ✍️');
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
    saveAttendanceCache();

    nameEl.value = '';
    creditEl.value = '';

    renderSheets();
    setDirty(sheet.courseId, true);
    persistAttendanceSheets(true);
}

async function saveAttendanceSheet(courseId, silent) {
    const sheet = attendanceSheets.find((item) => item.courseId === courseId);
    if (!sheet) return;

    const syncEl = document.getElementById(`syncAttendance-${courseId}`);
    const saveBtn = document.getElementById(`saveAttendance-${courseId}`);

    if (saveBtn) {
        saveBtn.innerText = '⏳ Saving...';
        saveBtn.disabled = true;
    }

    const saved = await persistAttendanceSheets(silent);

    if (saved) {
        if (saveBtn) {
            saveBtn.innerText = '✅ Saved';
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.45';
            saveBtn.style.cursor = 'not-allowed';
            setTimeout(() => {
                if (saveBtn) {
                    saveBtn.innerText = 'Save Changes';
                }
            }, 2000);
        }
        return;
    }

    if (syncEl) {
        syncEl.innerText = 'Save failed';
        syncEl.style.color = '#dc2626';
    }
    if (saveBtn) {
        saveBtn.innerText = 'Save Changes';
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    }
}

async function loadAttendanceSheets() {
    const token = getToken();
    if (!token) {
        attendanceSheets = loadAttendanceCache();
        renderSheets();
        return;
    }

    try {
        const response = await fetch(getApiUrl('/api/academic/strategist-settings'), {
            headers: { Authorization: `Bearer ${token}` }
        });
        const result = await response.json();
        const cachedSheets = loadAttendanceCache();

        if (response.ok && result.success) {
            const settings = (result.data || [])[0] || {};
            const attendanceData = Array.isArray(settings.attendanceData) ? settings.attendanceData : [];
            attendanceSheets = mergeAttendanceSources(
                attendanceData.map((item) => normalizeSheet(item)),
                cachedSheets
            );
        } else {
            attendanceSheets = cachedSheets;
        }
    } catch (error) {
        console.error('Failed to load attendance sheets:', error);
        attendanceSheets = loadAttendanceCache();
    }

    renderSheets();
}

document.addEventListener('DOMContentLoaded', () => {
    loadAttendanceSheets();
});
