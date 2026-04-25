const gradePoints = {
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

const API_BASE = 'http://localhost:5000/api/academic';
let lastCalculatedCourses = [];
let cachedSemesters = [];

function getAuthToken() {
    return localStorage.getItem('authToken');
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

document.addEventListener('DOMContentLoaded', async () => {
    for (let i = 0; i < 3; i++) addCourseRow();
    const semesterNameInput = document.getElementById('semesterName');
    if (semesterNameInput) {
        semesterNameInput.addEventListener('input', () => {
            updatePreviousAcademicInputs();
            calculateEverything();
        });
    }
    await loadAcademicData();
});

function parseSemesterName(name) {
    const match = /^\s*(\d+)\s*[-/]\s*(\d+)\s*$/.exec(name || '');
    if (!match) return null;

    return {
        year: Number(match[1]),
        term: Number(match[2])
    };
}

function getPreviousSemesters(currentSemesterName) {
    const normalizedCurrent = (currentSemesterName || '').trim().toLowerCase();
    if (!normalizedCurrent) return [...cachedSemesters];

    const currentParsed = parseSemesterName(normalizedCurrent);

    return cachedSemesters.filter((record) => {
        const recordName = (record.semesterName || '').trim().toLowerCase();

        if (recordName === normalizedCurrent) {
            return false;
        }

        if (!currentParsed) {
            return true;
        }

        const recordParsed = parseSemesterName(recordName);
        if (!recordParsed) {
            return true;
        }

        if (recordParsed.year < currentParsed.year) return true;
        if (recordParsed.year === currentParsed.year && recordParsed.term < currentParsed.term) return true;
        return false;
    });
}

function updatePreviousAcademicInputs() {
    const currentSemesterName = (document.getElementById('semesterName').value || '').trim();
    const previousSemesters = getPreviousSemesters(currentSemesterName);

    const previousCredits = previousSemesters.reduce(
        (sum, record) => sum + Number(record.totalCredits || 0),
        0
    );

    const previousWeightedPoints = previousSemesters.reduce(
        (sum, record) => sum + Number(record.semesterGPA || 0) * Number(record.totalCredits || 0),
        0
    );

    const previousCgpa = previousCredits > 0 ? previousWeightedPoints / previousCredits : 0;

    document.getElementById('prevTotalCredits').value = previousCredits > 0 ? previousCredits.toFixed(2) : '';
    document.getElementById('prevCGPA').value = previousCredits > 0 ? previousCgpa.toFixed(2) : '';
}

function addCourseRow(course = null) {
    const tbody = document.getElementById('courseTableBody');
    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid var(--border)';

    const options = Object.keys(gradePoints)
        .map((g) => `<option value="${g}" ${course && course.grade === g ? 'selected' : ''}>${g}</option>`)
        .join('');

    row.innerHTML = `
        <td style="padding: 10px;"><input type="text" class="cur-name" placeholder="Course Name" style="width:100%; border:none; background:transparent; outline:none;" value="${course ? course.name : ''}"></td>
        <td style="padding: 10px;"><input type="number" class="cur-credits" placeholder="3" min="0" style="width:80px;" value="${course ? course.credits : ''}"></td>
        <td style="padding: 10px;">
            <select class="cur-grade" style="width:100%;">
                ${options}
            </select>
        </td>
        <td style="padding: 10px; text-align:center;"><button onclick="this.parentElement.parentElement.remove()" style="background:none; border:none; cursor:pointer; color:#fb7185; font-weight:bold;">✕</button></td>
    `;
    tbody.appendChild(row);
}

function collectCourses() {
    const names = document.querySelectorAll('.cur-name');
    const creditsInputs = document.querySelectorAll('.cur-credits');
    const gradesInputs = document.querySelectorAll('.cur-grade');

    const courses = [];
    names.forEach((nameInput, index) => {
        const name = (nameInput.value || '').trim();
        const credits = parseFloat(creditsInputs[index].value) || 0;
        const grade = gradesInputs[index].value;
        const gpa = gradePoints[grade] || 0;

        if (name && credits > 0) {
            courses.push({ name, credits, grade, gpa });
        }
    });

    return courses;
}

function calculateEverything() {
    const courses = collectCourses();

    const curTotalPoints = courses.reduce((sum, c) => sum + c.credits * c.gpa, 0);
    const curTotalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
    const semesterGPA = curTotalCredits > 0 ? curTotalPoints / curTotalCredits : 0;

    document.getElementById('semGPA').innerText = semesterGPA.toFixed(2);

    const prevCredits = parseFloat(document.getElementById('prevTotalCredits').value) || 0;
    const prevCGPA = parseFloat(document.getElementById('prevCGPA').value) || 0;

    const prevTotalPoints = prevCredits * prevCGPA;
    const combinedTotalPoints = curTotalPoints + prevTotalPoints;
    const combinedTotalCredits = curTotalCredits + prevCredits;
    const finalCGPA = combinedTotalCredits > 0 ? combinedTotalPoints / combinedTotalCredits : 0;

    document.getElementById('finalCGPA').innerText = finalCGPA.toFixed(2);

    lastCalculatedCourses = courses;
    document.getElementById('saveCloudBtn').style.display = courses.length > 0 ? 'block' : 'none';

    return {
        combinedPoints: combinedTotalPoints,
        combinedCredits: combinedTotalCredits,
        semesterGPA,
        courses
    };
}

async function saveSemesterToCloud() {
    const semesterName = (document.getElementById('semesterName').value || '').trim();
    if (!semesterName) {
        alert('Please provide a semester name.');
        return;
    }

    const calc = calculateEverything();
    if (calc.courses.length === 0) {
        alert('Add at least one course before saving.');
        return;
    }

    try {
        const result = await apiRequest(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                semesterName,
                courses: calc.courses
            })
        });
        console.log('Server Response:', result);
        await loadAcademicData();
        alert('Semester saved to cloud.');
    } catch (error) {
        alert('Failed to save semester.');
    }
}

async function deleteSemester(semesterId) {
    if (!confirm('Delete this semester record?')) return;

    try {
        await apiRequest(`${API_BASE}/${semesterId}`, { method: 'DELETE' });
        await loadAcademicData();
    } catch (error) {
        alert('Failed to delete semester.');
    }
}

function renderSavedSemesters(records) {
    const container = document.getElementById('savedSemestersList');
    if (!container) return;

    if (!records.length) {
        container.innerHTML = '<p style="margin:0; color: #94a3b8;">No semester records saved yet.</p>';
        return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
    records.forEach((record) => {
        html += `
            <div style="padding:10px; border:1px solid var(--border); border-radius:8px; background:#fff;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <div>
                        <div style="font-weight:700;">${record.semesterName}</div>
                        <div style="font-size:0.78rem; color:#64748b;">GPA: ${Number(record.semesterGPA || 0).toFixed(2)} | Credits: ${Number(record.totalCredits || 0).toFixed(2)}</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button onclick="loadSemesterToForm('${record._id}')" style="border:none; background:#e0f2fe; color:#0c4a6e; padding:6px 10px; border-radius:6px; cursor:pointer;">Load</button>
                        <button onclick="deleteSemester('${record._id}')" style="border:none; background:#fee2e2; color:#b91c1c; padding:6px 10px; border-radius:6px; cursor:pointer;">Delete</button>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

function loadSemesterToForm(semesterId) {
    const record = cachedSemesters.find((item) => item._id === semesterId);
    if (!record) return;

    document.getElementById('semesterName').value = record.semesterName;
    const tbody = document.getElementById('courseTableBody');
    tbody.innerHTML = '';

    (record.courses || []).forEach((course) => addCourseRow(course));
    if ((record.courses || []).length === 0) {
        addCourseRow();
    }

    updatePreviousAcademicInputs();
    calculateEverything();
}

async function loadAcademicData() {
    try {
        const [semestersRes, summaryRes] = await Promise.all([
            apiRequest(API_BASE),
            apiRequest(`${API_BASE}/summary`)
        ]);

        cachedSemesters = semestersRes.data || [];
        renderSavedSemesters(cachedSemesters);

        updatePreviousAcademicInputs();

        const summary = (summaryRes.data || [])[0] || {};
        const settings = summary.strategistSettings || {};
        const desiredCgpaValue = settings.desiredCGPA !== undefined ? settings.desiredCGPA : settings.targetCgpa;
        const targetGpaValue = settings.targetGPA !== undefined ? settings.targetGPA : settings.requiredGpa;
        document.getElementById('targetGoal').value = desiredCgpaValue || '';
        document.getElementById('nextSemCredits').value = targetGpaValue || '';
    } catch (error) {
        const container = document.getElementById('savedSemestersList');
        if (container) {
            container.innerHTML = '<p style="margin:0; color:#ef4444;">Unable to load academic records. Please login again.</p>';
        }
    }
}

async function calculateNextSemRequirement() {
    const currentStatus = calculateEverything();

    const totalCreditsSoFar = currentStatus.combinedCredits;
    const totalPointsSoFar = currentStatus.combinedPoints;

    const targetCGPA = parseFloat(document.getElementById('targetGoal').value);
    const nextCredits = parseFloat(document.getElementById('nextSemCredits').value);
    const resultDiv = document.getElementById('targetResult');

    if (isNaN(targetCGPA) || isNaN(nextCredits) || nextCredits <= 0) {
        alert("Please enter a valid target CGPA and next semester's credit load.");
        return;
    }

    const totalTargetPointsNeeded = targetCGPA * (totalCreditsSoFar + nextCredits);
    const pointsNeededFromNextSem = totalTargetPointsNeeded - totalPointsSoFar;
    const requiredGPA = pointsNeededFromNextSem / nextCredits;
    const targetGPA = requiredGPA;

    resultDiv.style.display = 'block';

    if (requiredGPA > 4.0) {
        resultDiv.innerHTML = `<p style="color: #b91c1c; margin:0;"><b>Impossible!</b><br>To hit ${targetCGPA}, you need a ${requiredGPA.toFixed(2)} GPA. That's higher than a perfect 4.0!</p>`;
        resultDiv.style.background = '#fee2e2';
    } else if (requiredGPA <= 0) {
        resultDiv.innerHTML = `<p style="color: #15803d; margin:0;"><b>Target Safe!</b><br>You could get a 0.00 next semester and still stay above ${targetCGPA}.</p>`;
        resultDiv.style.background = '#dcfce7';
    } else {
        resultDiv.innerHTML = `<p style="margin:0;">To reach a total CGPA of <b>${targetCGPA.toFixed(2)}</b>, you need to obtain a <b>${requiredGPA.toFixed(2)}</b> GPA next semester.</p>`;
        resultDiv.style.background = '#fdfaf9';
    }

    try {
        await apiRequest(`${API_BASE}/strategist-settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetGPA,
                desiredCGPA: targetCGPA
            })
        });
    } catch (error) {
        console.error('Failed to save strategist settings:', error);
    }
}
