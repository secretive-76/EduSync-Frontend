let allowance = 0;
let expenses = [];
let myChart;

// Get current date context for the backend
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

async function initExpenses() {
    // 1. Fetch data from the database instead of localStorage
    await fetchBackendData();
    displayWelcome(); // From app.js
}

async function fetchBackendData() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        allowance = 0;
        expenses = [];
        updateUI();
        updateChart();
        return;
    }

    try {
        const response = await fetch(`https://edusync-life-production.up.railway.app/api/finance/summary?year=${currentYear}&month=${currentMonth}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // NOTE: Accessing .data.summary and .data.expenses based on your controller
            allowance = result.data.summary?.monthlyBudget || 0;
            expenses = result.data.expenses || [];
            
            document.getElementById('monthlyAllowance').value = allowance || '';
            updateUI();
            updateChart();
            return;
        }

        if (response.status === 404) {
            allowance = 0;
            expenses = [];
            document.getElementById('monthlyAllowance').value = '';
            updateUI();
            updateChart();
            return;
        }
    } catch (err) {
        console.error("Failed to fetch expenses:", err);
        allowance = 0;
        expenses = [];
        updateUI();
        updateChart();
    }
}

async function saveAllowance() {
    const allowanceInput = document.getElementById('monthlyAllowance').value;
    const token = localStorage.getItem('authToken');
    const amt = parseFloat(allowanceInput) || 0;

    try {
        const response = await fetch('https://edusync-life-production.up.railway.app/api/finance/set-budget', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                year: currentYear,
                month: currentMonth,
                monthlyBudget: amt
            })
        });

        if (response.ok) {
            allowance = amt;
            updateUI();
            showToast('Budget synced to cloud successfully! ☁️', 'success');
        }
    } catch (err) {
        showToast('Failed to save your budget. Please try again', 'error');
    }
}

async function processSpending() {
    const input = document.getElementById('expenseAmount');
    const amt = parseFloat(input.value);
    const token = localStorage.getItem('authToken');

    if (isNaN(amt) || amt <= 0) return;

    try {
        const response = await fetch('https://edusync-life-production.up.railway.app/api/finance/add-expense', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: amt,
                category: "General",
                note: "Expense",
                year: currentYear,
                month: currentMonth
            })
        });

        if (response.ok) {
            input.value = '';
            await fetchBackendData(); // Refresh everything from the server
        }
    } catch (err) {
        console.error("Error saving expense:", err);
    }
}

// NOTE: Ensure your backend has a DELETE route for this to work
async function deleteExpense(id) {
    const confirmed = await showConfirmDialog('Cancel this expense?');
    if (!confirmed) return;
    
    const token = localStorage.getItem('authToken');

    try {
        const response = await fetch(`https://edusync-life-production.up.railway.app/api/finance/expense/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            await fetchBackendData();
        }
    } catch (err) {
        console.error("Delete failed:", err);
    }
}

function updateUI() {
    const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);
    const remaining = allowance - totalSpent;
    
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const daysLeft = daysInMonth - now.getDate() + 1;
    const avg = remaining > 0 ? (remaining / daysLeft).toFixed(2) : 0;

    document.getElementById('remainingSummary').innerHTML = `
        <div style="font-size:1.2rem;">Available: <b>Tk. ${remaining.toFixed(2)}</b></div>
        <p>Average spendable for next ${daysLeft} days: <b>Tk. ${avg}/day</b></p>
    `;

    const list = document.getElementById('historyList');
    list.innerHTML = "";
    
    // Using ._id because MongoDB uses underscores for IDs
    [...expenses].reverse().forEach(e => {
        const dateDisplay = new Date(e.spentAt || e.createdAt).toLocaleDateString();
        list.innerHTML += `
            <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #ddd;">
                <span>${dateDisplay}: Tk. ${e.amount}</span>
                <button onclick="deleteExpense('${e._id}')" style="color:red; background:none; border:none; cursor:pointer;">Cancel</button>
            </div>`;
    });
}

function updateChart() {
    const ctx = document.getElementById('spendingChart').getContext('2d');
    if (myChart) myChart.destroy();

    // Grouping expenses by date for the chart
    const labels = [...new Set(expenses.map(e => new Date(e.spentAt || e.createdAt).toLocaleDateString()))];
    const data = labels.map(label => 
        expenses.filter(e => new Date(e.spentAt || e.createdAt).toLocaleDateString() === label)
                .reduce((sum, e) => sum + e.amount, 0)
    );

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ 
                label: 'Spent (Tk)', 
                data: data, 
                backgroundColor: '#8B4513',
                borderRadius: 5
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}