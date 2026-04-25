let allowance = 0;
let expenses = [];
let myChart;

function getExpenseChartColors() {
    const isDark = document.documentElement.classList.contains('dark-mode')
        || document.documentElement.classList.contains('dark-theme')
        || document.documentElement.getAttribute('data-theme') === 'dark';

    return {
        text: isDark ? '#cccccc' : '#000000',
        grid: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(44, 62, 80, 0.10)',
        bar: isDark ? '#c94c4c' : '#8B4513',
        tooltipBg: isDark ? '#2d2d2d' : '#ffffff',
        tooltipText: isDark ? '#ffffff' : '#000000'
    };
}

// Get current date context for the backend
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

async function initExpenses() {
    // 1. Fetch data from the database instead of localStorage
    await fetchBackendData();
    displayWelcome(); // From app.js

    window.addEventListener('themechange', () => {
        updateChart();
    });
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
        const response = await fetch(`https://edusync-life-1.onrender.com/api/finance/summary?year=${currentYear}&month=${currentMonth}`, {
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
        const response = await fetch('https://edusync-life-1.onrender.com/api/finance/set-budget', {
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
            alert('All synced up! Your monthly budget is now updated. ✅');
        }
    } catch (err) {
        alert("Oops! We couldn't save your budget yet. Let's try that again. 🛠️");
    }
}

async function processSpending() {
    const input = document.getElementById('expenseAmount');
    const amt = parseFloat(input.value);
    const token = localStorage.getItem('authToken');

    if (isNaN(amt) || amt <= 0) return;

    try {
        const response = await fetch('https://edusync-life-1.onrender.com/api/finance/add-expense', {
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
    if (!confirm("Cancel this expense?")) return;
    
    const token = localStorage.getItem('authToken');

    try {
        const response = await fetch(`https://edusync-life-1.onrender.com/api/finance/expense/${id}`, {
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
    const chartColors = getExpenseChartColors();

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
                backgroundColor: chartColors.bar,
                borderRadius: 5
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: {
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
                    display: true,
                    labels: {
                        color: chartColors.text,
                        font: {
                            weight: 600
                        }
                    }
                },
                tooltip: {
                    backgroundColor: chartColors.tooltipBg,
                    titleColor: chartColors.tooltipText,
                    bodyColor: chartColors.tooltipText,
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

function isDarkMode() {
    return document.documentElement.classList.contains('dark-mode')
        || document.documentElement.classList.contains('dark-theme')
        || document.documentElement.getAttribute('data-theme') === 'dark';
}