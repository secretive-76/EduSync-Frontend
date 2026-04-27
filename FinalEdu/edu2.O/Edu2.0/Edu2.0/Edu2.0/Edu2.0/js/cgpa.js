let courses = [];
const dirtyCourseIds = new Set();
const ACADEMIC_API_BASE = 'https://edusync-life-1.onrender.com/api/academic';
let persistedStrategicTotalGPA = null;

const gpaPoints = {
    'A+': 4.0,
    A: 3.75,
    'A-': 3.5,
    'B+': 3.25,
    B: 3.0,
    'B-': 2.75,
    'C+': 2.5,
    C: 2.25,
    D: 2.0,
    F: 0.0
};

const strategistGradeValues = {
    'A+': 3.2,
    A: 3.0,
    'A-': 2.8,
    'B+': 2.6,
    B: 2.4,
    'B-': 2.2,
    'C+': 2.0,
    C: 1.8,
    D: 1.6,
    F: 0.0
};

function getAcademicToken() {
    return localStorage.getItem('token') || localStorage.getItem('authToken');
}

function toNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function courseRules(credits) {
    const safeCredits = Math.max(0, toNumber(credits));
    const totalMarks = safeCredits * 100;
    const attendanceMax = safeCredits * 10;
    const ctInputs = Math.floor(safeCredits) + 1;
    const bestCtCount = Math.floor(safeCredits);
    const finalExamMax = totalMarks - (attendanceMax + bestCtCount * 20);

    return {
        credits: safeCredits,
        totalMarks,
        attendanceMax,
        ctInputs,
        bestCtCount,
        finalExamMax: Math.max(0, finalExamMax)
    };
}

function normalizeCourse(rawCourse) {
    const id = rawCourse.id || Date.now() + Math.floor(Math.random() * 10000);
    const courseName = (rawCourse.courseName || rawCourse.name || 'Untitled Course').trim();
    const credits = toNumber(rawCourse.credits !== undefined ? rawCourse.credits : rawCourse.credit, 3);
    const rules = courseRules(credits);

    const rawCtMarks = Array.isArray(rawCourse.ctMarks) ? rawCourse.ctMarks : [];
    const ctMarks = Array.from({ length: rules.ctInputs }, (_, idx) => Math.min(20, Math.max(0, toNumber(rawCtMarks[idx]))));

    return {
        id,
        courseName,
        credits,
        attendance: Math.min(rules.attendanceMax, Math.max(0, toNumber(rawCourse.attendance !== undefined ? rawCourse.attendance : rawCourse.attendanceMark))),
        ctMarks,
        targetGrade: strategistGradeValues[rawCourse.targetGrade] !== undefined ? rawCourse.targetGrade : 'A+'
    };
}

function getBestCtTotal(course) {
    const rules = courseRules(course.credits);
    const sorted = [...course.ctMarks].map((mark) => toNumber(mark)).sort((a, b) => b - a);
    return sorted.slice(0, rules.bestCtCount).reduce((sum, mark) => sum + mark, 0);
}

function buildCoursePayload(course) {
    return {
        id: course.id,
        courseName: course.courseName,
        credits: course.credits,
        attendance: toNumber(course.attendance),
        ctMarks: (course.ctMarks || []).map((mark) => toNumber(mark)),
        targetGrade: course.targetGrade,
        // Backward compatibility keys
        name: course.courseName,
        credit: course.credits,
        attendanceMark: toNumber(course.attendance)
    };
}

function updateStrategistTotalGPA() {
    const plannerTarget = document.getElementById('plannerTotalGPA');
    if (courses.length === 0 && persistedStrategicTotalGPA !== null && plannerTarget) {
        plannerTarget.innerText = persistedStrategicTotalGPA.toFixed(2);
        return;
    }

    const totalCredits = courses.reduce((sum, course) => sum + toNumber(course.credits), 0);
    const weightedGpa = courses.reduce((sum, course) => {
        const gp = gpaPoints[course.targetGrade] || 0;
        return sum + gp * toNumber(course.credits);
    }, 0);

    const total = totalCredits > 0 ? (weightedGpa / totalCredits).toFixed(2) : '0.00';
    if (plannerTarget) plannerTarget.innerText = total;
}

async function fetchRemoteStrategistSettings(token) {
    const response = await fetch(`${ACADEMIC_API_BASE}/strategist-settings`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error('Failed to load strategist settings from cloud');
    }

    return (result.data || [])[0] || {};
}

async function saveStrategistSettingsToCloud(strategistCourses, strategicTotalGPA) {
    const response = await fetch(`${ACADEMIC_API_BASE}/strategist-settings`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify({
            strategicTotalGPA,
            strategistCourses: strategistCourses.map((course) => buildCoursePayload(course))
        })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error('Save failed');
    }

    return result;
}

function collectCoursesFromScreen() {
    const collected = courses.map((course) => {
        const rules = courseRules(course.credits);
        const attendanceInput = document.getElementById(`attendance-${course.id}`);
        const gradeSelect = document.getElementById(`grade-${course.id}`);

        let attendance = attendanceInput ? toNumber(attendanceInput.value, 0) : toNumber(course.attendance, 0);
        if (attendance > rules.attendanceMax) attendance = rules.attendanceMax;
        if (attendance < 0) attendance = 0;
        if (attendanceInput) attendanceInput.value = attendance;

        const ctMarks = [];
        for (let i = 0; i < rules.ctInputs; i += 1) {
            const ctInput = document.getElementById(`ct-${course.id}-${i}`);
            let mark = ctInput ? toNumber(ctInput.value, 0) : toNumber(course.ctMarks[i], 0);
            if (mark > 20) mark = 20;
            if (mark < 0) mark = 0;
            if (ctInput) ctInput.value = mark;
            ctMarks.push(mark);
        }

        const targetGrade = gradeSelect && strategistGradeValues[gradeSelect.value] !== undefined
            ? gradeSelect.value
            : (strategistGradeValues[course.targetGrade] !== undefined ? course.targetGrade : 'A+');

        return {
            id: course.id,
            courseName: course.courseName,
            credits: course.credits,
            attendance,
            ctMarks,
            targetGrade
        };
    });

    courses = collected.map((course) => normalizeCourse(course));
    return collected;
}

async function loadStrategistSettings() {
    const token = getAcademicToken();
    if (!token) {
        courses = [];
        return;
    }

    try {
        const settings = await fetchRemoteStrategistSettings(token);
        persistedStrategicTotalGPA = Object.prototype.hasOwnProperty.call(settings, 'strategicTotalGPA')
            ? toNumber(settings.strategicTotalGPA, 0)
            : null;

        const plannerTarget = document.getElementById('plannerTotalGPA');
        if (plannerTarget && persistedStrategicTotalGPA !== null) {
            plannerTarget.innerText = persistedStrategicTotalGPA.toFixed(2);
        }

        const incomingCourses = Array.isArray(settings.strategistCourses) ? settings.strategistCourses : [];
        const normalizedIncoming = incomingCourses.map((course) => normalizeCourse(course));

        const mergedById = new Map();
        normalizedIncoming.forEach((course) => mergedById.set(course.id, course));
        courses.forEach((course) => {
            if (!mergedById.has(course.id)) {
                mergedById.set(course.id, normalizeCourse(course));
            }
        });

        courses = Array.from(mergedById.values());
    } catch (error) {
        console.error('Failed to load strategist settings:', error);
        courses = [];
        persistedStrategicTotalGPA = null;
    }
}

function markCourseDirty(courseId, isDirty = true) {
    const saveBtn = document.getElementById(`saveBtn-${courseId}`);
    if (!saveBtn) return;

    if (isDirty) {
        dirtyCourseIds.add(courseId);
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
        saveBtn.innerText = '💾 Save Course';
    } else {
        dirtyCourseIds.delete(courseId);
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.45';
        saveBtn.style.cursor = 'not-allowed';
    }
}

function refreshCourseCalculation(courseId) {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    const rules = courseRules(course.credits);
    const bestCtTotal = getBestCtTotal(course);
    const targetMarks = rules.totalMarks * ((strategistGradeValues[course.targetGrade] || 0) / 4.0);
    const runningSecured = toNumber(course.attendance) + bestCtTotal;
    const requiredInFinal = targetMarks - runningSecured;
    const impossible = requiredInFinal > rules.finalExamMax;

    const bestCtEl = document.getElementById(`bestCt-${courseId}`);
    const requiredEl = document.getElementById(`required-${courseId}`);

    if (bestCtEl) {
        bestCtEl.innerText = `Target: ${targetMarks.toFixed(1)} | Best CT(${rules.bestCtCount}): ${bestCtTotal.toFixed(1)}`;
    }

    if (requiredEl) {
        requiredEl.style.color = impossible ? '#d32f2f' : '#2E7D32';
        requiredEl.innerText = `Required in Final: ${requiredInFinal <= 0 ? '0.0 (Goal reached)' : requiredInFinal.toFixed(1)} / ${rules.finalExamMax.toFixed(1)}`;
    }

    updateStrategistTotalGPA();
}

function onAttendanceInput(courseId, inputEl) {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    const rules = courseRules(course.credits);
    let value = toNumber(inputEl.value, 0);

    if (value > rules.attendanceMax) value = rules.attendanceMax;
    if (value < 0) value = 0;

    if (toNumber(inputEl.value) !== value) inputEl.value = value;

    course.attendance = value;
    markCourseDirty(courseId, true);
    refreshCourseCalculation(courseId);
}

function onCtInput(courseId, index, inputEl) {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    let value = toNumber(inputEl.value, 0);
    if (value > 20) value = 20;
    if (value < 0) value = 0;

    if (toNumber(inputEl.value) !== value) inputEl.value = value;

    course.ctMarks[index] = value;
    markCourseDirty(courseId, true);
    refreshCourseCalculation(courseId);
}

function onGradeChange(courseId, value) {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    course.targetGrade = strategistGradeValues[value] !== undefined ? value : 'A+';
    markCourseDirty(courseId, true);
    refreshCourseCalculation(courseId);
}

async function saveCourseToCloud(courseId) {
    const token = localStorage.getItem('token') || getAcademicToken();
    if (!token) {
        showToast('Please login to save your planning', 'warning');
        return;
    }
    if (!localStorage.getItem('token')) {
        localStorage.setItem('token', token);
    }

    if (!courses.find((c) => c.id === courseId)) return;

    const saveBtn = document.getElementById(`saveBtn-${courseId}`);
    const saveStatus = document.getElementById(`saveStatus-${courseId}`);
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = '⏳ Saving...';
        saveBtn.style.opacity = '0.75';
    }

    try {
        const strategistCourses = collectCoursesFromScreen();
        const plannerTotalEl = document.getElementById('plannerTotalGPA');
        const strategicTotalGPA = plannerTotalEl ? toNumber(plannerTotalEl.innerText, 0) : 0;
        await saveStrategistSettingsToCloud(strategistCourses, strategicTotalGPA);

        persistedStrategicTotalGPA = strategicTotalGPA;

        if (saveStatus) {
            saveStatus.innerText = `Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            saveStatus.style.color = '#2E7D32';
        }

        markCourseDirty(courseId, false);
        if (saveBtn) saveBtn.innerText = '✅ Saved';

        setTimeout(() => {
            if (!dirtyCourseIds.has(courseId) && saveBtn) {
                saveBtn.innerText = '💾 Save Course';
            }
        }, 1400);
    } catch (error) {
        console.error('Failed to save course:', error);
        if (saveStatus) {
            saveStatus.innerText = 'Save failed. Try again.';
            saveStatus.style.color = '#d32f2f';
        }
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = '💾 Save Course';
            saveBtn.style.opacity = '1';
        }
    }
}

function addCourse() {
    const nameInput = document.getElementById('courseName');
    const creditInput = document.getElementById('courseCredit');

    const courseName = nameInput.value.trim();
    if (!courseName) {
        showToast('Please enter a course name', 'error');
        return;
    }

    const credits = toNumber(creditInput.value, 3);
    const rules = courseRules(credits);

    courses.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        courseName,
        credits,
        attendance: 0,
        ctMarks: Array.from({ length: rules.ctInputs }, () => 0),
        targetGrade: 'A+'
    });

    nameInput.value = '';
    renderCourses();

    const newId = courses[courses.length - 1].id;
    markCourseDirty(newId, true);
}

function renderCourses() {
    const container = document.getElementById('courseContainer');
    container.innerHTML = '';

    courses.forEach((course) => {
        const rules = courseRules(course.credits);

        let ctHtml = '';
        for (let i = 0; i < rules.ctInputs; i += 1) {
            const mark = toNumber(course.ctMarks[i]);
            ctHtml += `
                <div style="flex: 1; min-width: 70px;">
                    <label style="display:block; font-size: 0.72rem; color: #8B4513; margin-bottom: 4px;">CT ${i + 1}/20</label>
                    <input
                        id="ct-${course.id}-${i}"
                        type="number"
                        step="0.1"
                        min="0"
                        max="20"
                        value="${mark}"
                        style="width: 100%; padding: 8px; text-align: center; border: 1px solid #D7CCC8; border-radius: 6px; font-weight: bold; color: #3E2723;"
                    >
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = 'card';
        card.style.padding = '20px';
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
                <div>
                    <h3 style="margin:0; color:#3E2723;">${course.courseName}</h3>
                    <div style="font-size:0.82rem; color:#8B4513; margin-top:4px;">Credits: ${course.credits.toFixed(2)} | Total: ${rules.totalMarks.toFixed(1)} | Final Max: ${rules.finalExamMax.toFixed(1)}</div>
                </div>
                <button onclick="deleteCourse(${course.id})" title="Delete course" style="width:32px; height:32px; border-radius:50%; border:none; background:#ef5350; color:#fff; font-size:1.1rem; cursor:pointer; font-weight:bold; line-height:32px;">X</button>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                <div>
                    <label style="display:block; font-size: 0.75rem; color: #8B4513; margin-bottom: 4px;">Attendance (${rules.attendanceMax.toFixed(1)} max)</label>
                    <input
                        id="attendance-${course.id}"
                        type="number"
                        step="0.1"
                        min="0"
                        max="${rules.attendanceMax.toFixed(1)}"
                        value="${toNumber(course.attendance)}"
                        style="width: 100%; padding: 9px; text-align: center; border: 1px solid #D7CCC8; border-radius: 6px;"
                    >
                </div>
                <div>
                    <label style="display:block; font-size: 0.75rem; color: #8B4513; margin-bottom: 4px;">Desired Grade</label>
                    <select id="grade-${course.id}" style="width: 100%; padding: 9px; border: 1px solid #D7CCC8; border-radius: 6px;">
                        ${Object.keys(strategistGradeValues).map((grade) => `<option value="${grade}" ${course.targetGrade === grade ? 'selected' : ''}>${grade}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div style="display:flex; gap:8px; margin-bottom: 12px; flex-wrap: wrap;">${ctHtml}</div>

            <div style="text-align:center; padding: 10px; background: #fff; border-radius: 8px; border: 1px solid #f0f0f0; margin-bottom: 12px;">
                <div id="bestCt-${course.id}" style="font-size:0.78rem; color:#6d4c41; margin-bottom: 6px;"></div>
                <h2 id="required-${course.id}" style="margin:4px 0; font-size: 1.5rem;"></h2>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <span id="saveStatus-${course.id}" style="font-size:0.8rem; color:#6d4c41;">Not saved</span>
                <button id="saveBtn-${course.id}" disabled onclick="saveCourseToCloud(${course.id})" style="background:#2E7D32; color:#fff; border:none; padding:8px 14px; border-radius:6px; font-weight:bold; opacity:.45; cursor:not-allowed;">💾 Save Course</button>
            </div>
        `;

        container.appendChild(card);

        const attendanceInput = document.getElementById(`attendance-${course.id}`);
        attendanceInput.addEventListener('input', () => onAttendanceInput(course.id, attendanceInput));

        const gradeSelect = document.getElementById(`grade-${course.id}`);
        gradeSelect.addEventListener('change', () => onGradeChange(course.id, gradeSelect.value));

        for (let i = 0; i < rules.ctInputs; i += 1) {
            const ctInput = document.getElementById(`ct-${course.id}-${i}`);
            ctInput.addEventListener('input', () => onCtInput(course.id, i, ctInput));
        }

        refreshCourseCalculation(course.id);
        markCourseDirty(course.id, dirtyCourseIds.has(course.id));
    });

    updateStrategistTotalGPA();
}

async function deleteCourse(id) {
    const confirmed = await showConfirmDialog('Are you sure you want to remove this course?');
    if (!confirmed) return;

    const token = localStorage.getItem('token') || getAcademicToken();
    if (!token) {
        showToast('Please login to update your planning', 'warning');
        return;
    }
    if (!localStorage.getItem('token')) {
        localStorage.setItem('token', token);
    }

    const previousCourses = courses.map((course) => normalizeCourse(course));

    courses = courses.filter((course) => course.id !== id);
    dirtyCourseIds.delete(id);
    renderCourses();

    try {
        const plannerTotalEl = document.getElementById('plannerTotalGPA');
        const strategicTotalGPA = plannerTotalEl ? toNumber(plannerTotalEl.innerText, 0) : 0;

        await saveStrategistSettingsToCloud(courses, strategicTotalGPA);
        persistedStrategicTotalGPA = strategicTotalGPA;
        showToast('Course removed and synced', 'success');
    } catch (error) {
        console.error('Failed to delete course from cloud:', error);
        courses = previousCourses;
        renderCourses();
        showToast('Could not remove course from cloud. Try again.', 'error');
    }
}

async function initCGPA() {
    await loadStrategistSettings();
    renderCourses();
    addCalcRow();
}

function addCalcRow() {
    const container = document.getElementById('calculatorRows');
    const row = document.createElement('div');
    row.style = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';

    row.innerHTML = `
        <input type="text" placeholder="Subject Name" style="flex: 2; padding: 8px; border-radius: 5px; border: none;">
        <select class="calc-credit" onchange="calculateGPA()" style="flex: 1; padding: 8px; border-radius: 5px;">
            <option value="4">4.0</option>
            <option value="3" selected>3.0</option>
            <option value="2">2.0</option>
            <option value="1.5">1.5</option>
            <option value="0.75">0.75</option>
        </select>
        <select class="calc-grade" onchange="calculateGPA()" style="flex: 1; padding: 8px; border-radius: 5px;">
            ${Object.keys(gpaPoints).map((g) => `<option value="${g}">${g}</option>`).join('')}
        </select>
        <button onclick="this.parentElement.remove(); calculateGPA();" style="background:transparent; color:#fb7185; border:none; cursor:pointer; font-weight:bold;">X</button>
    `;

    container.appendChild(row);
    calculateGPA();
}

function calculateGPA() {
    const credits = document.querySelectorAll('.calc-credit');
    const grades = document.querySelectorAll('.calc-grade');

    let totalWeightedPoints = 0;
    let totalCredits = 0;

    credits.forEach((c, i) => {
        const credit = toNumber(c.value);
        const gp = gpaPoints[grades[i].value] || 0;
        totalWeightedPoints += credit * gp;
        totalCredits += credit;
    });

    const gpa = totalCredits > 0 ? (totalWeightedPoints / totalCredits).toFixed(2) : '0.00';
    document.getElementById('finalGPA').innerText = gpa;
}
