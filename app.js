// ============================================
// Payroll Management System - JavaScript
// ============================================

// Check authentication on load
function checkAuth() {
    const isLoggedIn = sessionStorage.getItem('payroll_logged_in') === 'true';
    const rememberMe = localStorage.getItem('payroll_remember_me') === 'true';
    const savedUser = localStorage.getItem('payroll_username');

    if (isLoggedIn || rememberMe) {
        document.getElementById('loginModal').classList.add('hidden');
        if (savedUser) {
            document.getElementById('loginUsername').value = savedUser;
            document.getElementById('rememberMe').checked = true;
        }
        initializeApp();
    } else {
        document.getElementById('loginModal').classList.remove('hidden');
    }
}

function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    // Demo credentials: admin / admin123
    if (username === 'admin' && password === 'admin123') {
        sessionStorage.setItem('payroll_logged_in', 'true');
        if (rememberMe) {
            localStorage.setItem('payroll_remember_me', 'true');
            localStorage.setItem('payroll_username', username);
        } else {
            localStorage.removeItem('payroll_remember_me');
            localStorage.removeItem('payroll_username');
        }
        document.getElementById('loginModal').classList.add('hidden');
        initializeApp();
    } else {
        showToast('Invalid username or password!', 'error');
    }
}

function logout() {
    sessionStorage.removeItem('payroll_logged_in');
    document.getElementById('loginModal').classList.remove('hidden');
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay?.classList.toggle('active');
}

// Initialize App
function initializeApp() {
    loadSettings();
    loadEmployees();
    loadDTR();
    loadPayroll();
    updateDashboard();
    document.getElementById('dtrDateFilter').valueAsDate = new Date();
    document.getElementById('payrollMonthFilter').value = new Date().toISOString().slice(0, 7);
    document.getElementById('reportMonth').value = new Date().toISOString().slice(0, 7);
    initializeQRScanner();
}

document.addEventListener('DOMContentLoaded', checkAuth);

// ============================================
// Data Storage
// ============================================

const STORAGE_KEYS = {
    SETTINGS: 'payroll_settings',
    EMPLOYEES: 'payroll_employees',
    DTR: 'payroll_dtr',
    PAYROLL: 'payroll_processed',
    COMPANY: 'payroll_company'
};

// Default company settings
const defaultCompany = {
    name: 'Company Name',
    address: 'Company Address',
    tin: '000-000-000-000',
    sssNumber: '00-0000000-0',
    philhealthNumber: '000000000000',
    pagibigNumber: '0000-0000-0000'
};

// Default Settings
const defaultSettings = {
    lateType: 'per_minute',
    latePerMinute: 1.00,
    lateRanges: [
        { min: 1, max: 15, amount: 5.00 },
        { min: 16, max: 30, amount: 10.00 },
        { min: 31, max: 60, amount: 20.00 }
    ],
    otRate: 100.00,
    standardTimeIn: '08:00',
    standardTimeOut: '17:00',
    breakMinutes: 60,
    // Split AM/PM schedule used by the Paste DTR Data grid & attendance rules
    scheduleAmIn: '08:00',
    scheduleAmOut: '12:00',
    schedulePmIn: '13:00',
    schedulePmOut: '17:00',
    // Attendance tiers: minutes-late thresholds (inclusive upper bound) for each tier.
    // 0..lateGraceEnd = Grace (no penalty), then per-minute, then flat 1hr/2hr, then half day, then absent.
    lateGraceEnd: 10,
    latePerMinuteEnd: 29,
    lateFlat1hrEnd: 59,
    lateFlat2hrEnd: 89,
    lateHalfDayEnd: 149,
    // If true, any hours worked on Sunday are paid entirely at the OT rate
    sundayAllOT: true,
    baseDailyPay: 500.00,
    payrollCutoff: '15',
    payrollFrequency: 'monthly',
    defaultDailyRate: 400.00,
    defaultHourlyRate: 50.00,
    defaultPosition: 'Employee',
    enableStatutoryDeductions: true
};

// Current settings
let settings = {};

// Company info
let company = {};

// Employees data
let employees = [];

// DTR entries
let dtrEntries = [];

// Processed payroll records
let processedPayroll = [];

// ============================================
// Settings Functions
// ============================================

function loadSettings() {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    settings = stored ? JSON.parse(stored) : { ...defaultSettings };

    // Load company settings
    const companyStored = localStorage.getItem(STORAGE_KEYS.COMPANY);
    company = companyStored ? JSON.parse(companyStored) : { ...defaultCompany };
    populateCompanyForm();

    // Populate settings form
    document.getElementById('latePerMinute').value = settings.latePerMinute || 1.00;
    document.getElementById('otRate').value = settings.otRate || 100.00;
    document.getElementById('breakMinutes').value = settings.breakMinutes || 60;
    document.getElementById('scheduleAmIn').value = settings.scheduleAmIn || '08:00';
    document.getElementById('scheduleAmOut').value = settings.scheduleAmOut || '12:00';
    document.getElementById('schedulePmIn').value = settings.schedulePmIn || '13:00';
    document.getElementById('schedulePmOut').value = settings.schedulePmOut || '17:00';
    document.getElementById('lateGraceEnd').value = settings.lateGraceEnd ?? 10;
    document.getElementById('latePerMinuteEnd').value = settings.latePerMinuteEnd ?? 29;
    document.getElementById('lateFlat1hrEnd').value = settings.lateFlat1hrEnd ?? 59;
    document.getElementById('lateFlat2hrEnd').value = settings.lateFlat2hrEnd ?? 89;
    document.getElementById('lateHalfDayEnd').value = settings.lateHalfDayEnd ?? 149;
    document.getElementById('sundayAllOT').checked = settings.sundayAllOT !== false;
    document.getElementById('baseDailyPay').value = settings.baseDailyPay || 500.00;
    document.getElementById('payrollCutoff').value = settings.payrollCutoff || '15';
    document.getElementById('payrollFrequency').value = settings.payrollFrequency || 'monthly';
    document.getElementById('defaultDailyRate').value = settings.defaultDailyRate || 400.00;
    document.getElementById('defaultHourlyRate').value = settings.defaultHourlyRate || 50.00;
    document.getElementById('defaultPosition').value = settings.defaultPosition || 'Employee';
    document.getElementById('enableStatutoryDeductions').checked = settings.enableStatutoryDeductions !== false;

    // Late type radio buttons
    document.querySelectorAll('input[name="lateType"]').forEach(radio => {
        radio.checked = radio.value === settings.lateType;
    });

    // Late deduction ranges
    updateLateRangeGroupVisibility();
    renderLateRanges();

    // Update default values in employee form
    document.getElementById('baseDailyPayInput').value = settings.baseDailyPay || 500.00;
}

function saveSettings() {
    settings.lateType = document.querySelector('input[name="lateType"]:checked')?.value || 'per_minute';
    settings.latePerMinute = parseFloat(document.getElementById('latePerMinute').value) || 0;
    settings.otRate = parseFloat(document.getElementById('otRate').value) || 0;
    settings.breakMinutes = parseInt(document.getElementById('breakMinutes').value) || 0;
    settings.scheduleAmIn = document.getElementById('scheduleAmIn').value || '08:00';
    settings.scheduleAmOut = document.getElementById('scheduleAmOut').value || '12:00';
    settings.schedulePmIn = document.getElementById('schedulePmIn').value || '13:00';
    settings.schedulePmOut = document.getElementById('schedulePmOut').value || '17:00';
    settings.lateGraceEnd = parseInt(document.getElementById('lateGraceEnd').value) || 0;
    settings.latePerMinuteEnd = parseInt(document.getElementById('latePerMinuteEnd').value) || 0;
    settings.lateFlat1hrEnd = parseInt(document.getElementById('lateFlat1hrEnd').value) || 0;
    settings.lateFlat2hrEnd = parseInt(document.getElementById('lateFlat2hrEnd').value) || 0;
    settings.lateHalfDayEnd = parseInt(document.getElementById('lateHalfDayEnd').value) || 0;
    settings.sundayAllOT = document.getElementById('sundayAllOT').checked;
    // Keep legacy single time-in/out fields in sync with the AM start / PM end
    // so older calculation paths (manual DTR entry) stay consistent.
    settings.standardTimeIn = settings.scheduleAmIn;
    settings.standardTimeOut = settings.schedulePmOut;
    settings.baseDailyPay = parseFloat(document.getElementById('baseDailyPay').value) || 0;
    settings.payrollCutoff = document.getElementById('payrollCutoff').value;
    settings.payrollFrequency = document.getElementById('payrollFrequency').value;
    settings.defaultDailyRate = parseFloat(document.getElementById('defaultDailyRate').value) || 0;
    settings.defaultHourlyRate = parseFloat(document.getElementById('defaultHourlyRate').value) || 0;
    settings.defaultPosition = document.getElementById('defaultPosition').value;
    settings.enableStatutoryDeductions = document.getElementById('enableStatutoryDeductions').checked;

    // Save late ranges
    const ranges = [];
    document.querySelectorAll('.late-range-item').forEach(item => {
        const min = parseInt(item.querySelector('.range-min').value);
        const max = parseInt(item.querySelector('.range-max').value);
        const amount = parseFloat(item.querySelector('.range-amount').value);
        if (min > 0 && max > 0 && amount >= 0) {
            ranges.push({ min, max, amount });
        }
    });
    settings.lateRanges = ranges;

    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    showToast('Settings saved successfully!', 'success');
    updateDashboard();
    loadPayroll();
}

function saveCompanySettings() {
    company.name = document.getElementById('companyName').value.trim();
    company.address = document.getElementById('companyAddress').value.trim();
    company.tin = document.getElementById('companyTIN').value.trim();
    company.sssNumber = document.getElementById('companySSS').value.trim();
    company.philhealthNumber = document.getElementById('companyPhilhealth').value.trim();
    company.pagibigNumber = document.getElementById('companyPagibig').value.trim();

    localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(company));
    showToast('Company settings saved successfully!', 'success');
}

function populateCompanyForm() {
    document.getElementById('companyName').value = company.name || '';
    document.getElementById('companyAddress').value = company.address || '';
    document.getElementById('companyTIN').value = company.tin || '';
    document.getElementById('companySSS').value = company.sssNumber || '';
    document.getElementById('companyPhilhealth').value = company.philhealthNumber || '';
    document.getElementById('companyPagibig').value = company.pagibigNumber || '';
}

function updateLateRangeGroupVisibility() {
    const isPerMinute = settings.lateType === 'per_minute';
    document.getElementById('latePerMinuteGroup').classList.toggle('hidden', !isPerMinute);
    document.getElementById('latePerRangeGroup').classList.toggle('hidden', isPerMinute);
}

function renderLateRanges() {
    const container = document.getElementById('lateRangeList');
    container.innerHTML = '';

    settings.lateRanges.forEach((range, index) => {
        const item = document.createElement('div');
        item.className = 'late-range-item';
        item.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px;';
        item.innerHTML = `
            <input type="number" class="range-min form-control" placeholder="Min" value="${range.min}" min="0" style="width: 80px;" onchange="saveSettings()">
            <span style="color: var(--gray-500);">-</span>
            <input type="number" class="range-max form-control" placeholder="Max" value="${range.max}" min="0" style="width: 80px;" onchange="saveSettings()">
            <span style="color: var(--gray-500); margin-right: 8px;">min</span>
            <div class="input-with-icon" style="flex: 1;">
                <span class="currency-symbol">₱</span>
                <input type="number" class="range-amount form-control" placeholder="Amount" value="${range.amount}" min="0" step="0.01" onchange="saveSettings()">
            </div>
            <button class="btn btn-sm btn-outline text-danger" onclick="removeLateRange(${index})">
                <i class="fas fa-trash"></i>
            </button>
        `;
        container.appendChild(item);
    });
}

function addLateRange() {
    if (!settings.lateRanges) settings.lateRanges = [];
    const lastRange = settings.lateRanges[settings.lateRanges.length - 1];
    const newMin = lastRange ? lastRange.max + 1 : 1;
    settings.lateRanges.push({ min: newMin, max: newMin + 14, amount: 0 });
    renderLateRanges();
}

function removeLateRange(index) {
    settings.lateRanges.splice(index, 1);
    renderLateRanges();
}

// ============================================
// Employee Functions
// ============================================

function loadEmployees() {
    const stored = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
    if (stored) {
        employees = JSON.parse(stored);
    } else {
        // Only seed sample data if there's nothing in localStorage at all
        seedSampleData();
    }
    renderEmployeeTable();
    updateEmployeeFilters();
}

function seedSampleData() {
    employees = [
        {
            id: generateEmployeeId(),
            firstName: 'Juan',
            lastName: 'Dela Cruz',
            middleName: '',
            position: 'Software Engineer',
            department: 'Engineering',
            email: 'juan.delacruz@company.com',
            phone: '+63 912 345 6789',
            address: '123 Main St, Manila',
            dailyRate: 800,
            hourlyRate: 100,
            baseDailyPay: 500,
            sssNumber: '12-3456789-0',
            philhealthNumber: '123456789012',
            pagibigNumber: '1234-5678-9012',
            tin: '123-456-789-000',
            hireDate: '2023-01-15',
            status: 'active',
            createdAt: new Date().toISOString()
        },
        {
            id: generateEmployeeId(),
            firstName: 'Maria',
            lastName: 'Santos',
            middleName: 'Lopez',
            position: 'HR Manager',
            department: 'Human Resources',
            email: 'maria.santos@company.com',
            phone: '+63 917 234 5678',
            address: '456 Oak Ave, Quezon City',
            dailyRate: 900,
            hourlyRate: 112.50,
            baseDailyPay: 500,
            sssNumber: '12-4567890-1',
            philhealthNumber: '234567890123',
            pagibigNumber: '2345-6789-0123',
            tin: '234-567-890-000',
            hireDate: '2022-06-01',
            status: 'active',
            createdAt: new Date().toISOString()
        },
        {
            id: generateEmployeeId(),
            firstName: 'Pedro',
            lastName: 'Reyes',
            middleName: '',
            position: 'Accountant',
            department: 'Finance',
            email: 'pedro.reyes@company.com',
            phone: '+63 918 345 6789',
            address: '789 Pine Rd, Makati',
            dailyRate: 700,
            hourlyRate: 87.50,
            baseDailyPay: 500,
            sssNumber: '12-5678901-2',
            philhealthNumber: '345678901234',
            pagibigNumber: '3456-7890-1234',
            tin: '345-678-901-000',
            hireDate: '2023-03-10',
            status: 'active',
            createdAt: new Date().toISOString()
        }
    ];
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
}

function generateEmployeeId() {
    const count = employees.length + 1;
    const year = new Date().getFullYear();
    return `EMP-${year}-${String(count).padStart(3, '0')}`;
}

function renderEmployeeTable() {
    const tbody = document.getElementById('employeeTableBody');
    tbody.innerHTML = '';

    const searchTerm = document.getElementById('employeeSearch')?.value?.toLowerCase() || '';

    const filtered = employees.filter(emp => {
        if (!searchTerm) return true;
        return `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(searchTerm) ||
               emp.position.toLowerCase().includes(searchTerm) ||
               emp.id.toLowerCase().includes(searchTerm);
    });

    filtered.forEach(emp => {
        const initials = `${emp.firstName[0]}${emp.lastName[0]}`.toUpperCase();
        const statusClass = emp.status === 'active' ? 'badge-success' :
                           emp.status === 'inactive' ? 'badge-neutral' : 'badge-warning';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code class="text-muted">${emp.id}</code></td>
            <td><div class="employee-photo">${initials}</div></td>
            <td>
                <strong>${emp.firstName} ${emp.lastName}</strong>
                <br><small class="text-muted">${emp.position}</small>
            </td>
            <td>${emp.position}</td>
            <td>₱${formatNumber(emp.dailyRate || 0)}</td>
            <td>₱${formatNumber(emp.hourlyRate || 0)}</td>
            <td><span class="badge ${statusClass}">${capitalize(emp.status)}</span></td>
            <td class="actions">
                <button class="btn-icon" onclick="editEmployee('${emp.id}')" title="Edit">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon" onclick="viewQREmployee('${emp.id}')" title="QR Code">
                    <i class="fas fa-qrcode"></i>
                </button>
                <button class="btn-icon" onclick="deleteEmployee('${emp.id}')" title="Delete" style="color: var(--danger);">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateEmployeeFilters() {
    const employeeFilter = document.getElementById('dtrEmployeeFilter');
    const payrollFilter = document.getElementById('payrollEmployeeFilter');

    const currentDtrValue = employeeFilter.value;
    const currentPayrollValue = payrollFilter.value;

    employeeFilter.innerHTML = '<option value="">All Employees</option>' +
        employees.filter(e => e.status === 'active').map(e =>
            `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
        ).join('');

    payrollFilter.innerHTML = '<option value="">All Employees</option>' +
        employees.filter(e => e.status === 'active').map(e =>
            `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
        ).join('');

    if (currentDtrValue && [...employeeFilter.options].some(o => o.value === currentDtrValue)) {
        employeeFilter.value = currentDtrValue;
    }

    if (currentPayrollValue && [...payrollFilter.options].some(o => o.value === currentPayrollValue)) {
        payrollFilter.value = currentPayrollValue;
    }

    // Update DTR select
    const dtrSelect = document.getElementById('dtrEmployee');
    if (dtrSelect) {
        dtrSelect.innerHTML = employees.filter(e => e.status === 'active').map(e =>
            `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
        ).join('');
    }
}

function addEmployee() {
    document.getElementById('editEmployeeId').value = '';
    document.getElementById('employeeId').value = generateEmployeeId();
    document.getElementById('firstName').value = '';
    document.getElementById('middleName').value = '';
    document.getElementById('lastName').value = '';
    document.getElementById('position').value = settings.defaultPosition || '';
    document.getElementById('department').value = '';
    document.getElementById('email').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('address').value = '';
    document.getElementById('dailyRate').value = settings.defaultDailyRate || 400;
    document.getElementById('hourlyRate').value = settings.defaultHourlyRate || 50;
    document.getElementById('baseDailyPayInput').value = settings.baseDailyPay || 500;
    document.getElementById('hireDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('sssNumber').value = '';
    document.getElementById('philhealthNumber').value = '';
    document.getElementById('pagibigNumber').value = '';
    document.getElementById('tin').value = '';
    document.getElementById('employeeStatus').value = 'active';
    showModal('employeeModal');
}

function editEmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('editEmployeeId').value = emp.id;
    document.getElementById('employeeId').value = emp.id;
    document.getElementById('firstName').value = emp.firstName || '';
    document.getElementById('middleName').value = emp.middleName || '';
    document.getElementById('lastName').value = emp.lastName || '';
    document.getElementById('position').value = emp.position || '';
    document.getElementById('department').value = emp.department || '';
    document.getElementById('email').value = emp.email || '';
    document.getElementById('phone').value = emp.phone || '';
    document.getElementById('address').value = emp.address || '';
    document.getElementById('dailyRate').value = emp.dailyRate || 0;
    document.getElementById('hourlyRate').value = emp.hourlyRate || 0;
    document.getElementById('baseDailyPayInput').value = emp.baseDailyPay || settings.baseDailyPay || 500;
    document.getElementById('hireDate').value = emp.hireDate || '';
    document.getElementById('sssNumber').value = emp.sssNumber || '';
    document.getElementById('philhealthNumber').value = emp.philhealthNumber || '';
    document.getElementById('pagibigNumber').value = emp.pagibigNumber || '';
    document.getElementById('tin').value = emp.tin || '';
    document.getElementById('employeeStatus').value = emp.status || 'active';
    showModal('employeeModal');
}

function saveEmployee() {
    const editId = document.getElementById('editEmployeeId').value;
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const position = document.getElementById('position').value.trim();
    const department = document.getElementById('department').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const address = document.getElementById('address').value.trim();
    const dailyRate = parseFloat(document.getElementById('dailyRate').value) || 0;
    const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 0;
    const baseDailyPay = parseFloat(document.getElementById('baseDailyPayInput').value) || 0;
    const hireDate = document.getElementById('hireDate').value;
    const sssNumber = document.getElementById('sssNumber').value.trim();
    const philhealthNumber = document.getElementById('philhealthNumber').value.trim();
    const pagibigNumber = document.getElementById('pagibigNumber').value.trim();
    const tin = document.getElementById('tin').value.trim();
    const status = document.getElementById('employeeStatus').value;

    if (!firstName || !lastName) {
        showToast('First name and last name are required!', 'error');
        return;
    }
    if (!position) {
        showToast('Position is required!', 'error');
        return;
    }

    if (editId) {
        // Update existing
        const idx = employees.findIndex(e => e.id === editId);
        if (idx !== -1) {
            employees[idx] = {
                ...employees[idx],
                firstName,
                middleName,
                lastName,
                position,
                department,
                email,
                phone,
                address,
                dailyRate,
                hourlyRate,
                baseDailyPay,
                hireDate,
                sssNumber,
                philhealthNumber,
                pagibigNumber,
                tin,
                status
            };
            showToast('Employee updated successfully!', 'success');
        }
    } else {
        // Add new
        const newEmployee = {
            id: document.getElementById('employeeId').value,
            firstName,
            middleName,
            lastName,
            position,
            department,
            email,
            phone,
            address,
            dailyRate,
            hourlyRate,
            baseDailyPay,
            hireDate,
            sssNumber,
            philhealthNumber,
            pagibigNumber,
            tin,
            status,
            createdAt: new Date().toISOString()
        };
        employees.push(newEmployee);
        showToast('Employee added successfully!', 'success');
    }

    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    closeModal('employeeModal');
    loadEmployees();
    updateDashboard();
}

function deleteEmployee(id) {
    if (!confirm('Are you sure you want to delete this employee? All their DTR records will also be deleted.')) {
        return;
    }

    employees = employees.filter(e => e.id !== id);
    dtrEntries = dtrEntries.filter(d => d.employeeId !== id);
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    localStorage.setItem(STORAGE_KEYS.DTR, JSON.stringify(dtrEntries));
    loadEmployees();
    updateDashboard();
    showToast('Employee deleted successfully!', 'info');
}

function viewQREmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('qrEmployeeDisplayName').textContent = `${emp.firstName} ${emp.lastName} - ${emp.id}`;
    const qrDisplay = document.getElementById('qrCodeDisplay');
    qrDisplay.innerHTML = '';
    generateRealQRCode(`payroll://${emp.id}`, 'qrCodeDisplay');
    showModal('qrModal');
}

// ============================================
// DTR Functions
// ============================================

function loadDTR() {
    const stored = localStorage.getItem(STORAGE_KEYS.DTR);
    dtrEntries = stored ? JSON.parse(stored) : [];

    const employeeFilter = document.getElementById('dtrEmployeeFilter')?.value;
    const dateFilter = document.getElementById('dtrDateFilter')?.value;

    let filtered = dtrEntries;

    if (employeeFilter) {
        filtered = filtered.filter(d => d.employeeId === employeeFilter);
    }

    if (dateFilter) {
        filtered = filtered.filter(d => d.date === dateFilter);
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('dtrTableBody');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center text-muted" style="padding: 40px;">
                    <i class="fas fa-inbox" style="font-size: 32px; display: block; margin-bottom: 12px; opacity: 0.5;"></i>
                    No DTR entries found
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(dtr => {
        const emp = employees.find(e => e.id === dtr.employeeId);
        if (!emp) return;

        const statusClass = dtr.status === 'present' ? 'badge-success' :
                          dtr.status === 'late' ? 'badge-warning' :
                          dtr.status === 'absent' ? 'badge-danger' : 'badge-info';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(dtr.date)}</td>
            <td>
                <strong>${emp.firstName} ${emp.lastName}</strong>
            </td>
            <td>${dtr.timeIn || '-'}</td>
            <td>${dtr.timeOut || '-'}</td>
            <td>${dtr.totalHours ? dtr.totalHours.toFixed(2) + ' hrs' : '-'}</td>
            <td>${dtr.otHours ? dtr.otHours.toFixed(2) + ' hrs' : '0.00 hrs'}</td>
            <td>${dtr.lateMinutes || 0} min</td>
            <td><span class="badge ${statusClass}">${capitalize(dtr.status)}</span></td>
            <td class="actions">
                <button class="btn-icon" onclick="editDTR('${dtr.id}')" title="Edit">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon" onclick="deleteDTR('${dtr.id}')" title="Delete" style="color: var(--danger);">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showDTRAddModal() {
    document.getElementById('dtrEmployee').innerHTML = employees.filter(e => e.status === 'active').map(e =>
        `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
    ).join('');
    document.getElementById('dtrDate').value = document.getElementById('dtrDateFilter').value || new Date().toISOString().split('T')[0];
    document.getElementById('dtrTimeIn').value = '';
    document.getElementById('dtrTimeOut').value = '';
    document.getElementById('dtrOTHours').value = '';
    document.getElementById('dtrLateMinutes').value = '';
    document.getElementById('dtrStatus').value = 'present';
    showModal('dtrModal');
}

function saveDTR() {
    const employeeId = document.getElementById('dtrEmployee').value;
    const date = document.getElementById('dtrDate').value;
    const timeIn = document.getElementById('dtrTimeIn').value;
    const timeOut = document.getElementById('dtrTimeOut').value;
    const otHours = parseFloat(document.getElementById('dtrOTHours').value) || 0;
    const lateMinutes = parseInt(document.getElementById('dtrLateMinutes').value) || 0;
    const status = document.getElementById('dtrStatus').value;
    const editId = document.getElementById('dtrEmployee').dataset.editId;

    if (!employeeId || !date) {
        showToast('Please select employee and date!', 'error');
        return;
    }

    // Calculate total hours
    let totalHours = 0;
    if (timeIn && timeOut) {
        totalHours = calculateWorkHours(timeIn, timeOut);
    }

    // Auto-calculate late minutes if not manually set
    const calculatedLate = calculateLateMinutes(timeIn);
    const finalLateMinutes = lateMinutes || calculatedLate;

    if (editId) {
        // Update existing
        const idx = dtrEntries.findIndex(d => d.id === editId);
        if (idx !== -1) {
            dtrEntries[idx] = {
                ...dtrEntries[idx],
                employeeId,
                date,
                timeIn,
                timeOut,
                totalHours,
                otHours,
                lateMinutes: finalLateMinutes,
                status
            };
            showToast('DTR entry updated!', 'success');
        }
        // Clear edit ID
        delete document.getElementById('dtrEmployee').dataset.editId;
    } else {
        // Add new
        const dtrEntry = {
            id: 'DTR-' + Date.now(),
            employeeId,
            date,
            timeIn,
            timeOut,
            totalHours,
            otHours,
            lateMinutes: finalLateMinutes,
            status,
            createdAt: new Date().toISOString()
        };
        dtrEntries.push(dtrEntry);
        showToast('DTR entry saved!', 'success');
    }

    localStorage.setItem(STORAGE_KEYS.DTR, JSON.stringify(dtrEntries));
    closeModal('dtrModal');
    loadDTR();
    updateDashboard();
}

function editDTR(id) {
    const dtr = dtrEntries.find(d => d.id === id);
    if (!dtr) return;

    document.getElementById('dtrEmployee').innerHTML = employees.filter(e => e.status === 'active').map(e =>
        `<option value="${e.id}" ${e.id === dtr.employeeId ? 'selected' : ''}>${e.firstName} ${e.lastName} (${e.id})</option>`
    ).join('');
    document.getElementById('dtrDate').value = dtr.date;
    document.getElementById('dtrTimeIn').value = dtr.timeIn || '';
    document.getElementById('dtrTimeOut').value = dtr.timeOut || '';
    document.getElementById('dtrOTHours').value = dtr.otHours || '';
    document.getElementById('dtrLateMinutes').value = dtr.lateMinutes || '';
    document.getElementById('dtrStatus').value = dtr.status;

    // Store ID for update
    document.getElementById('dtrEmployee').dataset.editId = id;
    showModal('dtrModal');
}

function deleteDTR(id) {
    if (!confirm('Are you sure you want to delete this DTR entry?')) {
        return;
    }

    dtrEntries = dtrEntries.filter(d => d.id !== id);
    localStorage.setItem(STORAGE_KEYS.DTR, JSON.stringify(dtrEntries));
    loadDTR();
    updateDashboard();
    showToast('DTR entry deleted!', 'info');
}

// ============================================
// Paste DTR Data — multi-employee monthly grid
// (Replaces the old single-employee bulk paste UI.)
// ============================================

let pasteDtrDaysInMonth = 30;
let pasteDtrActiveTab = 1;
const PASTE_DTR_DAY1_END = 15;
const WEEKDAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function getActiveEmployees() {
    return employees.filter(e => e.status === 'active');
}

function getDaysInMonth(year, month) {
    // month is 1-indexed
    return new Date(year, month, 0).getDate();
}

function getPasteDtrMonthValue() {
    return document.getElementById('pasteDtrMonth')?.value || '';
}

function populatePasteDtrMonthOptions(selectedValue) {
    const select = document.getElementById('pasteDtrMonth');
    if (!select) return;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
    const now = new Date();
    const options = [];
    for (let offset = -6; offset <= 2; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const value = `${y}-${String(m).padStart(2, '0')}`;
        options.push(`<option value="${value}">${monthNames[m - 1]} ${y}</option>`);
    }
    select.innerHTML = options.join('');
    select.value = selectedValue || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function showPasteDTRModal() {
    populatePasteDtrMonthOptions();
    populatePasteDtrEmployeeDatalist();
    pasteDtrActiveTab = 1;
    buildPasteDtrGrid();
    setupPasteDtrPasteHandler();
    showModal('bulkDtrModal');
}

// Backward-compatible alias in case older markup still references this name.
function showBulkDTRModal() {
    showPasteDTRModal();
}

function populatePasteDtrEmployeeDatalist() {
    const list = document.getElementById('pasteDtrEmployeeList');
    if (!list) return;
    list.innerHTML = getActiveEmployees()
        .map(e => `<option value="${escapeHtml(e.firstName + ' ' + e.lastName)}">`)
        .join('');
}

function onPasteDtrMonthChange() {
    // Keep whatever employee names were already typed; reset day cells
    // since the number/labels of days can change between months.
    const names = [...document.querySelectorAll('#pasteDtrTableBody .paste-dtr-name-input')].map(i => i.value);
    pasteDtrActiveTab = 1;
    buildPasteDtrGrid(names);
}

function buildPasteDtrGrid(preserveNames) {
    const monthValue = getPasteDtrMonthValue();
    if (!monthValue) return;
    const [yearStr, monthStr] = monthValue.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    pasteDtrDaysInMonth = getDaysInMonth(year, month);

    renderPasteDtrRulesHint();
    renderPasteDtrTabs();
    renderPasteDtrTableHead(year, month);
    renderPasteDtrTableBody(preserveNames);
    applyPasteDtrTabVisibility();
}

function renderPasteDtrRulesHint() {
    const hintEl = document.getElementById('pasteDtrRulesHint');
    if (!hintEl) return;

    const toClock = (m) => {
        const wrapped = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
        const h = Math.floor(wrapped / 60);
        const mm = wrapped % 60;
        return `${h}:${String(mm).padStart(2, '0')}`;
    };
    const amIn = timeStrToMinutes(settings.scheduleAmIn || '08:00') || 0;
    const grace = settings.lateGraceEnd ?? 10;
    const perMinEnd = settings.latePerMinuteEnd ?? 29;
    const flat1hrEnd = settings.lateFlat1hrEnd ?? 59;
    const flat2hrEnd = settings.lateFlat2hrEnd ?? 89;
    const halfDayEnd = settings.lateHalfDayEnd ?? 149;
    const tierRange = (start, end) => `${toClock(amIn + start)}-${toClock(amIn + end)}`;

    const perMinuteLabel = settings.lateType === 'per_minute'
        ? `₱${formatNumber(settings.latePerMinute || 0)}/min late`
        : 'minutes late';

    const rulesParts = [
        `Grace ${tierRange(0, grace)}`,
        `${tierRange(grace + 1, perMinEnd)}: ${perMinuteLabel}`,
        `${tierRange(perMinEnd + 1, flat1hrEnd)}: 1hr`,
        `${tierRange(flat1hrEnd + 1, flat2hrEnd)}: 2hr`,
        `${tierRange(flat2hrEnd + 1, halfDayEnd)}: Half day`
    ];

    const scheduleText = `${settings.scheduleAmIn}-${settings.scheduleAmOut} & ${settings.schedulePmIn}-${settings.schedulePmOut} | OT: Beyond ${settings.schedulePmOut}`;

    hintEl.innerHTML = `
        <div>Enter employee names and time in/out for each day. Format: HH:MM (e.g., 08:00, 17:00)</div>
        <div><strong>Late Rules:</strong> ${rulesParts.join(' | ')}</div>
        <div><strong>Schedule:</strong> ${scheduleText}${settings.sundayAllOT ? ' | <span class="badge badge-warning">SUN</span> = All hours at OT rate' : ''}</div>
    `;
}

function renderPasteDtrTabs() {
    const wrap = document.getElementById('pasteDtrTabs');
    if (!wrap) return;
    wrap.innerHTML = `
        <button type="button" class="paste-dtr-tab ${pasteDtrActiveTab === 1 ? 'active' : ''}" onclick="switchPasteDtrTab(1)">Days 1-${PASTE_DTR_DAY1_END}</button>
        <button type="button" class="paste-dtr-tab ${pasteDtrActiveTab === 2 ? 'active' : ''}" onclick="switchPasteDtrTab(2)">Days ${PASTE_DTR_DAY1_END + 1}-${pasteDtrDaysInMonth}</button>
    `;
}

function switchPasteDtrTab(tab) {
    pasteDtrActiveTab = tab;
    renderPasteDtrTabs();
    applyPasteDtrTabVisibility();
}

function applyPasteDtrTabVisibility() {
    document.querySelectorAll('#pasteDtrTable .day-group-1').forEach(el => {
        el.classList.toggle('paste-dtr-hidden', pasteDtrActiveTab !== 1);
    });
    document.querySelectorAll('#pasteDtrTable .day-group-2').forEach(el => {
        el.classList.toggle('paste-dtr-hidden', pasteDtrActiveTab !== 2);
    });
}

function renderPasteDtrTableHead(year, month) {
    const thead = document.getElementById('pasteDtrTableHead');
    if (!thead) return;

    let headerCells = `<th class="paste-dtr-emp-col">Employee</th>`;
    for (let day = 1; day <= pasteDtrDaysInMonth; day++) {
        const dateObj = new Date(year, month - 1, day);
        const weekday = WEEKDAY_ABBR[dateObj.getDay()];
        const isSunday = dateObj.getDay() === 0;
        const groupClass = day <= PASTE_DTR_DAY1_END ? 'day-group-1' : 'day-group-2';
        headerCells += `
            <th class="paste-dtr-day-col ${groupClass} ${isSunday ? 'paste-dtr-sunday' : ''}">
                <div>Day ${day} ${isSunday ? '<span class="badge badge-warning">SUN</span>' : `<small class="paste-dtr-weekday">${weekday}</small>`}</div>
                <small>In / Out</small>
            </th>`;
    }
    headerCells += `<th class="paste-dtr-del-col"></th>`;
    thead.innerHTML = `<tr>${headerCells}</tr>`;
}

function renderPasteDtrTableBody(preserveNames) {
    const tbody = document.getElementById('pasteDtrTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const names = (preserveNames && preserveNames.length > 0) ? preserveNames : [''];
    names.forEach(name => addPasteDtrEmployeeRow(name));
}

function addPasteDtrEmployeeRow(name) {
    const tbody = document.getElementById('pasteDtrTableBody');
    if (!tbody) return null;
    const row = document.createElement('tr');

    let cells = `
        <td class="paste-dtr-emp-col">
            <input type="text" class="form-control paste-dtr-name-input" list="pasteDtrEmployeeList" placeholder="Name" value="${escapeHtml(name || '')}">
        </td>`;

    for (let day = 1; day <= pasteDtrDaysInMonth; day++) {
        const groupClass = day <= PASTE_DTR_DAY1_END ? 'day-group-1' : 'day-group-2';
        const hiddenClass = (groupClass === 'day-group-1') === (pasteDtrActiveTab === 1) ? '' : 'paste-dtr-hidden';
        cells += `
            <td class="paste-dtr-day-cell ${groupClass} ${hiddenClass}" data-day="${day}">
                <input type="time" class="form-control paste-dtr-time-in" title="Time In">
                <input type="time" class="form-control paste-dtr-time-out" title="Time Out">
            </td>`;
    }

    cells += `
        <td class="paste-dtr-del-col">
            <button class="btn-icon" type="button" onclick="removePasteDtrRow(this)" title="Remove row" style="color: var(--danger);">
                <i class="fas fa-trash"></i>
            </button>
        </td>`;

    row.innerHTML = cells;
    tbody.appendChild(row);
    return row;
}

function removePasteDtrRow(btn) {
    const tbody = document.getElementById('pasteDtrTableBody');
    btn.closest('tr').remove();
    if (tbody && tbody.rows.length === 0) addPasteDtrEmployeeRow('');
}

function clearPasteDtrGrid() {
    if (!confirm('Clear all rows in this grid? This does not affect entries already saved.')) return;
    buildPasteDtrGrid();
}

// --- Spreadsheet-style paste across the whole grid ---

function setupPasteDtrPasteHandler() {
    const table = document.getElementById('pasteDtrTable');
    if (!table || table.dataset.pasteBound) return;
    table.dataset.pasteBound = '1';
    table.addEventListener('paste', handlePasteDtrGridPaste);
}

function getPasteDtrRowInputs(row) {
    // Ordered: [nameInput, day1In, day1Out, day2In, day2Out, ...]
    const inputs = [row.querySelector('.paste-dtr-name-input')];
    row.querySelectorAll('.paste-dtr-day-cell').forEach(cell => {
        inputs.push(cell.querySelector('.paste-dtr-time-in'));
        inputs.push(cell.querySelector('.paste-dtr-time-out'));
    });
    return inputs;
}

function handlePasteDtrGridPaste(e) {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    // A single value (no tabs/newlines) - let the browser paste normally into the one field.
    if (!text.includes('\t') && !text.includes('\n')) return;

    const target = e.target.closest('input');
    if (!target) return;
    e.preventDefault();

    const tbody = document.getElementById('pasteDtrTableBody');
    const startRow = target.closest('tr');
    let rows = [...tbody.querySelectorAll('tr')];
    const startRowIndex = rows.indexOf(startRow);
    const startInputs = getPasteDtrRowInputs(startRow);
    let startColIndex = startInputs.indexOf(target);
    if (startColIndex === -1) startColIndex = 0;

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        .filter((l, i, arr) => !(i === arr.length - 1 && l === ''));

    lines.forEach((line, r) => {
        const cols = line.split('\t');
        const rowIndex = startRowIndex + r;
        while (rowIndex >= rows.length) {
            addPasteDtrEmployeeRow('');
            rows = [...tbody.querySelectorAll('tr')];
        }
        const targetRow = rows[rowIndex];
        const inputs = getPasteDtrRowInputs(targetRow);

        cols.forEach((val, c) => {
            const input = inputs[startColIndex + c];
            if (!input) return; // beyond the last day column in the month, ignore
            const trimmed = val.trim();
            if (!trimmed) return;
            if (input.classList.contains('paste-dtr-name-input')) {
                input.value = trimmed;
            } else if (input.type === 'time') {
                const t = normalizeTime(trimmed);
                if (t) input.value = t;
            }
        });
    });

    applyPasteDtrTabVisibility();
    showToast(`Pasted ${lines.length} row(s) into the grid.`, 'success');
}

// --- Import into DTR records ---

function createEmployeeFromPasteName(rawName) {
    const parts = rawName.trim().replace(/\s+/g, ' ').split(' ');
    const firstName = parts.shift() || rawName;
    const lastName = parts.join(' ') || '-';
    const newEmployee = {
        id: generateEmployeeId(),
        firstName,
        middleName: '',
        lastName,
        position: settings.defaultPosition || 'Employee',
        department: '',
        email: '',
        phone: '',
        address: '',
        dailyRate: settings.defaultDailyRate || 400.00,
        hourlyRate: settings.defaultHourlyRate || 50.00,
        baseDailyPay: settings.baseDailyPay || 500.00,
        hireDate: new Date().toISOString().split('T')[0],
        sssNumber: '',
        philhealthNumber: '',
        pagibigNumber: '',
        tin: '',
        status: 'active',
        createdAt: new Date().toISOString()
    };
    employees.push(newEmployee);
    return newEmployee;
}

function importPasteDtrAttendance() {
    const monthValue = getPasteDtrMonthValue();
    if (!monthValue) {
        showToast('Select a month first.', 'error');
        return;
    }
    const [yearStr, monthStr] = monthValue.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const rows = [...document.querySelectorAll('#pasteDtrTableBody tr')];
    let newEmployees = 0;
    let importedEntries = 0;
    let skippedIncomplete = 0;

    rows.forEach(row => {
        const nameInput = row.querySelector('.paste-dtr-name-input');
        const rawName = (nameInput?.value || '').trim();
        if (!rawName) return; // skip blank rows entirely

        let employee = matchEmployeeByName(rawName);
        if (!employee) {
            employee = createEmployeeFromPasteName(rawName);
            newEmployees++;
        }

        row.querySelectorAll('.paste-dtr-day-cell').forEach(cell => {
            const day = parseInt(cell.dataset.day, 10);
            const timeIn = cell.querySelector('.paste-dtr-time-in')?.value || '';
            const timeOut = cell.querySelector('.paste-dtr-time-out')?.value || '';
            if (!timeIn && !timeOut) return; // nothing entered for this day

            if (!timeIn || !timeOut) {
                skippedIncomplete++;
                return; // need both Time In and Time Out to compute a day
            }

            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const result = computeDtrForDay(timeIn, timeOut, dateStr);
            if (!result) return;

            const existingIdx = dtrEntries.findIndex(d => d.employeeId === employee.id && d.date === dateStr);
            const entry = {
                id: existingIdx !== -1 ? dtrEntries[existingIdx].id : 'DTR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
                employeeId: employee.id,
                date: dateStr,
                timeIn,
                timeOut,
                totalHours: result.totalHours,
                otHours: result.otHours,
                lateMinutes: result.lateMinutes,
                status: result.status,
                createdAt: existingIdx !== -1 ? dtrEntries[existingIdx].createdAt : new Date().toISOString()
            };

            if (existingIdx !== -1) {
                dtrEntries[existingIdx] = entry;
            } else {
                dtrEntries.push(entry);
            }
            importedEntries++;
        });
    });

    if (importedEntries === 0) {
        showToast('No complete Time In / Time Out pairs found to import.', 'error');
        return;
    }

    localStorage.setItem(STORAGE_KEYS.DTR, JSON.stringify(dtrEntries));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    closeModal('bulkDtrModal');
    loadDTR();
    loadEmployees();
    updateDashboard();

    const summary = [`${importedEntries} day${importedEntries === 1 ? '' : 's'} imported`];
    if (newEmployees) summary.push(`${newEmployees} new employee${newEmployees === 1 ? '' : 's'} added`);
    if (skippedIncomplete) summary.push(`${skippedIncomplete} incomplete row${skippedIncomplete === 1 ? '' : 's'} skipped (need both Time In and Time Out)`);
    showToast(summary.join(', ') + '.', 'success');
}

// ============================================
// Shared parsing / matching helpers
// ============================================

function splitDtrColumns(line) {
    if (line.includes('\t')) return line.split('\t').map(c => c.trim());
    // CSV: handle quoted commas
    if (line.includes(',')) {
        const cols = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                cols.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        cols.push(current.trim());
        return cols;
    }
    // Multiple spaces
    return line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
}

function matchEmployeeByName(raw) {
    if (!raw) return null;
    const cleaned = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!cleaned) return null;

    const list = getActiveEmployees();

    // Exact id match
    const byId = list.find(e => e.id.toLowerCase() === cleaned);
    if (byId) return byId;

    // "Last, First" or "First Last"
    const noComma = cleaned.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

    const exactFull = list.find(e => {
        const full = `${e.firstName} ${e.lastName}`.toLowerCase();
        const fullMid = `${e.firstName} ${e.middleName || ''} ${e.lastName}`.replace(/\s+/g, ' ').trim().toLowerCase();
        const lastFirst = `${e.lastName} ${e.firstName}`.toLowerCase();
        return noComma === full || noComma === fullMid || noComma === lastFirst;
    });
    if (exactFull) return exactFull;

    // Contains both first and last
    const partial = list.find(e => {
        const first = e.firstName.toLowerCase();
        const last = e.lastName.toLowerCase();
        return noComma.includes(first) && noComma.includes(last);
    });
    if (partial) return partial;

    // Unique last-name match
    const lastMatches = list.filter(e => e.lastName.toLowerCase() === noComma || noComma.endsWith(' ' + e.lastName.toLowerCase()));
    if (lastMatches.length === 1) return lastMatches[0];

    return null;
}

function normalizeDate(value) {
    if (!value) return '';
    const v = value.trim();

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

    // MM/DD/YYYY or M/D/YYYY
    let m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        let month = parseInt(m[1], 10);
        let day = parseInt(m[2], 10);
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        // If first part > 12, treat as DD/MM/YYYY
        if (month > 12 && day <= 12) {
            const tmp = month;
            month = day;
            day = tmp;
        }
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // Excel serial date (e.g. 45901)
    if (/^\d{5}$/.test(v)) {
        const serial = parseInt(v, 10);
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const date = new Date(excelEpoch.getTime() + serial * 86400000);
        return date.toISOString().split('T')[0];
    }

    const parsed = new Date(v);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const mo = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }
    return '';
}

function normalizeTime(value) {
    if (!value) return '';
    let v = value.trim().toLowerCase();

    // Already HH:MM or HH:MM:SS
    let m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2];
        const ampm = (m[3] || '').toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${min}`;
    }

    // Excel fraction of day (0.333 = 8:00)
    if (/^0?\.\d+$/.test(v)) {
        const fraction = parseFloat(v);
        const totalMin = Math.round(fraction * 24 * 60);
        const h = Math.floor(totalMin / 60) % 24;
        const min = totalMin % 60;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }

    return '';
}

function normalizeStatus(value) {
    const v = (value || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (v === 'late') return 'late';
    if (v === 'absent') return 'absent';
    if (v === 'half_day' || v === 'halfday' || v === 'half-day' || v === 'half day') return 'half_day';
    return 'present';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function calculateWorkHours(timeIn, timeOut) {
    if (!timeIn || !timeOut) return 0;

    const [inH, inM] = timeIn.split(':').map(Number);
    const [outH, outM] = timeOut.split(':').map(Number);

    let startMinutes = inH * 60 + inM;
    let endMinutes = outH * 60 + outM;

    // Handle overnight shift
    if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
    }

    let workMinutes = endMinutes - startMinutes;

    // Subtract break time
    workMinutes -= settings.breakMinutes || 60;

    if (workMinutes < 0) workMinutes = 0;

    return workMinutes / 60;
}

function calculateLateMinutes(timeIn) {
    if (!timeIn || !settings.standardTimeIn) return 0;

    const [inH, inM] = timeIn.split(':').map(Number);
    const [stdH, stdM] = settings.standardTimeIn.split(':').map(Number);

    const inTotal = inH * 60 + inM;
    const stdTotal = stdH * 60 + stdM;

    if (inTotal <= stdTotal) return 0;
    return inTotal - stdTotal;
}

// ============================================
// Attendance rule engine (used by the Paste DTR Data grid)
// Applies the split AM/PM schedule, tiered late rules, OT-beyond-PM-out,
// and the Sunday-all-OT rule configured in Settings.
// ============================================
function timeStrToMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

function computeDtrForDay(timeIn, timeOut, dateStr) {
    if (!timeIn && !timeOut) return null;
    if (!timeIn || !timeOut) {
        return { status: 'absent', lateMinutes: 0, totalHours: 0, otHours: 0, isSunday: isSundayDate(dateStr), incomplete: true };
    }

    const isSunday = isSundayDate(dateStr);
    const amIn = timeStrToMinutes(settings.scheduleAmIn || '08:00');
    const amOut = timeStrToMinutes(settings.scheduleAmOut || '12:00');
    const pmIn = timeStrToMinutes(settings.schedulePmIn || '13:00');
    const pmOut = timeStrToMinutes(settings.schedulePmOut || '17:00');
    let inMin = timeStrToMinutes(timeIn);
    let outMin = timeStrToMinutes(timeOut);
    if (inMin === null || outMin === null) return null;
    if (outMin <= inMin) outMin += 24 * 60; // guard against overnight/typo entries

    // Worked minutes, minus the AM-out -> PM-in lunch gap if the shift spans it
    let workedMinutes = outMin - inMin;
    const lunchGap = Math.max(0, pmIn - amOut);
    if (lunchGap > 0 && inMin <= amOut && outMin >= pmIn) {
        workedMinutes -= lunchGap;
    }
    workedMinutes = Math.max(0, workedMinutes);

    let otMinutes = outMin > pmOut ? outMin - pmOut : 0;
    let lateMinutes = inMin > amIn ? inMin - amIn : 0;
    let status = 'present';

    if (isSunday && settings.sundayAllOT) {
        // Entire shift is paid at OT rate; late rules don't apply
        lateMinutes = 0;
        otMinutes = workedMinutes;
        status = 'present';
    } else {
        const grace = settings.lateGraceEnd ?? 10;
        const perMinEnd = settings.latePerMinuteEnd ?? 29;
        const flat1hrEnd = settings.lateFlat1hrEnd ?? 59;
        const flat2hrEnd = settings.lateFlat2hrEnd ?? 89;
        const halfDayEnd = settings.lateHalfDayEnd ?? 149;

        if (lateMinutes <= grace) {
            status = 'present';
        } else if (lateMinutes <= perMinEnd) {
            status = 'late';
        } else if (lateMinutes <= flat1hrEnd) {
            status = 'late';
        } else if (lateMinutes <= flat2hrEnd) {
            status = 'late';
        } else if (lateMinutes <= halfDayEnd) {
            status = 'half_day';
        } else {
            status = 'absent';
        }
    }

    return {
        status,
        lateMinutes,
        totalHours: parseFloat((workedMinutes / 60).toFixed(2)),
        otHours: parseFloat((otMinutes / 60).toFixed(2)),
        isSunday
    };
}

function isSundayDate(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 0;
}

// ============================================
// Payroll Functions
// ============================================

function loadPayroll() {
    const employeeFilter = document.getElementById('payrollEmployeeFilter')?.value;
    const monthFilter = document.getElementById('payrollMonthFilter')?.value;
    const enableStatutory = settings.enableStatutoryDeductions !== false;
    document.querySelectorAll('.statutory-col').forEach(el => {
        el.classList.toggle('hidden', !enableStatutory);
    });

    if (!monthFilter) return;

    const [year, month] = monthFilter.split('-');
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    // Set globals for payslip generation
    startDateGlobal = startDate;
    endDateGlobal = endDate;

    let filteredDTR = dtrEntries.filter(d => d.date >= startDate && d.date <= endDate);

    if (employeeFilter) {
        filteredDTR = filteredDTR.filter(d => d.employeeId === employeeFilter);
    }

    const tbody = document.getElementById('payrollTableBody');
    tbody.innerHTML = '';

    const activeEmployees = employees.filter(e => e.status === 'active');

    if (employeeFilter) {
        const emp = employees.find(e => e.id === employeeFilter);
        if (emp) {
            const empDTRs = filteredDTR.filter(d => d.employeeId === employeeFilter);
            const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
            renderPayrollRow(tbody, emp, payrollData);
        }
    } else {
        activeEmployees.forEach(emp => {
            const empDTRs = filteredDTR.filter(d => d.employeeId === emp.id);
            const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
            renderPayrollRow(tbody, emp, payrollData);
        });
    }
}

// PH SSS Contribution Table (2024 rates)
const SSS_TABLE = [
    { range: [0, 4250], ee: 180, er: 420 },
    { range: [4250, 4750], ee: 202.50, er: 472.50 },
    { range: [4750, 5250], ee: 225, er: 525 },
    { range: [5250, 5750], ee: 247.50, er: 577.50 },
    { range: [5750, 6250], ee: 270, er: 630 },
    { range: [6250, 6750], ee: 292.50, er: 682.50 },
    { range: [6750, 7250], ee: 315, er: 735 },
    { range: [7250, 7750], ee: 337.50, er: 787.50 },
    { range: [7750, 8250], ee: 360, er: 840 },
    { range: [8250, 8750], ee: 382.50, er: 892.50 },
    { range: [8750, 9250], ee: 405, er: 945 },
    { range: [9250, 9750], ee: 427.50, er: 997.50 },
    { range: [9750, 10250], ee: 450, er: 1050 },
    { range: [10250, 10750], ee: 472.50, er: 1102.50 },
    { range: [10750, 11250], ee: 495, er: 1155 },
    { range: [11250, 11750], ee: 517.50, er: 1207.50 },
    { range: [11750, 12250], ee: 540, er: 1260 },
    { range: [12250, 12750], ee: 562.50, er: 1312.50 },
    { range: [12750, 13250], ee: 585, er: 1365 },
    { range: [13250, 13750], ee: 607.50, er: 1417.50 },
    { range: [13750, 14250], ee: 630, er: 1470 },
    { range: [14250, 14750], ee: 652.50, er: 1522.50 },
    { range: [14750, 15250], ee: 675, er: 1575 },
    { range: [15250, 15750], ee: 697.50, er: 1627.50 },
    { range: [15750, 16250], ee: 720, er: 1680 },
    { range: [16250, 16750], ee: 742.50, er: 1732.50 },
    { range: [16750, 17250], ee: 765, er: 1785 },
    { range: [17250, 17750], ee: 787.50, er: 1837.50 },
    { range: [17750, 18250], ee: 810, er: 1890 },
    { range: [18250, 18750], ee: 832.50, er: 1942.50 },
    { range: [18750, 19250], ee: 855, er: 1995 },
    { range: [19250, 19750], ee: 877.50, er: 2047.50 },
    { range: [19750, 20250], ee: 900, er: 2100 },
    { range: [20250, 20750], ee: 922.50, er: 2152.50 },
    { range: [20750, 21250], ee: 945, er: 2205 },
    { range: [21250, 21750], ee: 967.50, er: 2257.50 },
    { range: [21750, 22250], ee: 990, er: 2310 },
    { range: [22250, 22750], ee: 1012.50, er: 2362.50 },
    { range: [22750, 23250], ee: 1035, er: 2415 },
    { range: [23250, 23750], ee: 1057.50, er: 2467.50 },
    { range: [23750, 24250], ee: 1080, er: 2520 },
    { range: [24250, 24750], ee: 1102.50, er: 2572.50 },
    { range: [24750, 25250], ee: 1125, er: 2625 },
    { range: [25250, 25750], ee: 1147.50, er: 2677.50 },
    { range: [25750, 26250], ee: 1170, er: 2730 },
    { range: [26250, 26750], ee: 1192.50, er: 2782.50 },
    { range: [26750, 27250], ee: 1215, er: 2835 },
    { range: [27250, 27750], ee: 1237.50, er: 2887.50 },
    { range: [27750, 28250], ee: 1260, er: 2940 },
    { range: [28250, 28750], ee: 1282.50, er: 2992.50 },
    { range: [28750, 29250], ee: 1305, er: 3045 },
    { range: [29250, 29750], ee: 1327.50, er: 3097.50 },
    { range: [29750, 30250], ee: 1350, er: 3150 },
];

// PH PhilHealth Contribution (2024: 5% of monthly salary, split 50/50, max ₱5,000/mo salary base)
function computePhilHealth(monthlySalary) {
    const base = Math.min(monthlySalary, 100000) * 0.05; // 5% of salary, max base 100k
    const total = Math.min(base, 5000); // Max ₱5,000 per month
    return { ee: total / 2, er: total / 2 }; // Split equally
}

// PH Pag-IBIG Contribution (2024: 2% of monthly salary, max ₱100 each for EE/ER)
function computePagibig(monthlySalary) {
    const contribution = Math.min(monthlySalary * 0.02, 100);
    return { ee: contribution, er: contribution };
}

// Get SSS contribution based on monthly salary credit
function computeSSS(monthlySalary) {
    const row = SSS_TABLE.find(r => monthlySalary >= r.range[0] && monthlySalary < r.range[1]);
    if (row) return { ee: row.ee, er: row.er };
    // Max contribution
    return { ee: 1350, er: 3150 };
}

function computeEmployeePayroll(emp, dtrs, startDate, endDate) {
    // Count days worked (present or half_day with full hours)
    const daysWorked = dtrs.filter(d => d.status === 'present' || (d.status === 'half_day' && (d.totalHours || 0) >= 4)).length;

    // Calculate total hours
    const totalHours = dtrs.reduce((sum, d) => sum + (d.totalHours || 0), 0);

    // Regular hours (capped at 8 hrs/day * daysWorked)
    const maxRegularHours = daysWorked * 8;
    const regularHours = Math.min(totalHours, maxRegularHours);
    const otHours = dtrs.reduce((sum, d) => sum + (d.otHours || 0), 0);

    // Daily rate based calculation
    const dailyRate = emp.dailyRate || settings.defaultDailyRate || 500;
    const hourlyRate = emp.hourlyRate || settings.defaultHourlyRate || (dailyRate / 8);
    const baseDailyPay = emp.baseDailyPay || settings.baseDailyPay || dailyRate;

    // Regular pay = daily rate * days worked
    const regularPay = dailyRate * daysWorked;

    // OT pay = hourly rate * 1.25 * OT hours (PH law: 125% for OT on regular days)
    const otRate = settings.otRate || (hourlyRate * 1.25);
    const otPay = otRate * otHours;

    // Late deductions
    let lateDeduction = 0;
    dtrs.forEach(dtr => {
        if (dtr.lateMinutes > 0) {
            if (settings.lateType === 'per_minute') {
                lateDeduction += dtr.lateMinutes * (settings.latePerMinute || 1);
            } else {
                // Per range
                const range = settings.lateRanges?.find(r => dtr.lateMinutes >= r.min && dtr.lateMinutes <= r.max);
                if (range) {
                    lateDeduction += range.amount;
                }
            }
        }
    });

    // Gross pay
    const grossPay = regularPay + otPay;

    // Check if statutory deductions are enabled
    const enableStatutory = settings.enableStatutoryDeductions !== false;

    let sssDeduction = 0, philhealthDeduction = 0, pagibigDeduction = 0;
    let sssER = 0, philhealthER = 0, pagibigER = 0;
    let statutoryDeductions = 0;

    if (enableStatutory) {
        // Monthly salary estimate for statutory deductions
        const monthlySalaryEstimate = grossPay * (30 / Math.max(daysWorked, 1));

        // Statutory deductions (Employee share)
        const sss = computeSSS(monthlySalaryEstimate);
        const philhealth = computePhilHealth(monthlySalaryEstimate);
        const pagibig = computePagibig(monthlySalaryEstimate);

        sssDeduction = sss.ee;
        philhealthDeduction = philhealth.ee;
        pagibigDeduction = pagibig.ee;
        sssER = sss.er;
        philhealthER = philhealth.er;
        pagibigER = pagibig.er;

        statutoryDeductions = sssDeduction + philhealthDeduction + pagibigDeduction;
    }

    const totalDeductions = lateDeduction + statutoryDeductions;

    // Net pay
    const netPay = grossPay - totalDeductions;

    return {
        daysWorked,
        totalHours,
        regularHours,
        otHours,
        dailyRate,
        hourlyRate,
        baseDailyPay,
        regularPay,
        otPay,
        lateDeduction,
        lateMinutes: dtrs.reduce((sum, d) => sum + (d.lateMinutes || 0), 0),
        sssDeduction,
        philhealthDeduction,
        pagibigDeduction,
        statutoryDeductions,
        totalDeductions,
        grossPay,
        netPay,
        // For payslip display
        sssER,
        philhealthER,
        pagibigER
    };
}

function renderPayrollRow(tbody, emp, data) {
    if (data.daysWorked === 0) return;

    const enableStatutory = settings.enableStatutoryDeductions !== false;
    const statutoryCell = enableStatutory ? `
        <td style="color: var(--danger);">
            <small>SSS: ₱${formatNumber(data.sssDeduction)}</small><br>
            <small>PHIC: ₱${formatNumber(data.philhealthDeduction)}</small><br>
            <small>Pag-IBIG: ₱${formatNumber(data.pagibigDeduction)}</small>
        </td>` : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>
            <strong>${emp.firstName} ${emp.lastName}</strong>
            <br><small class="text-muted">${emp.id}</small>
        </td>
        <td>${data.daysWorked} days</td>
        <td>${data.totalHours.toFixed(2)} hrs</td>
        <td>₱${formatNumber(data.regularPay)}</td>
        <td>₱${formatNumber(data.otPay)}</td>
        <td style="color: var(--danger);">-₱${formatNumber(data.lateDeduction)}</td>
        ${statutoryCell}
        <td>₱${formatNumber(data.totalDeductions)}</td>
        <td><strong>₱${formatNumber(data.netPay)}</strong></td>
        <td>
            <span class="badge badge-success">Computed</span>
            <button class="btn btn-sm btn-outline mt-1" onclick="generatePayslip('${emp.id}', '${startDateGlobal}', '${endDateGlobal}')" style="margin-top:4px;">
                <i class="fas fa-file-alt"></i> Payslip
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

// Global variables for payslip generation
let startDateGlobal = '';
let endDateGlobal = '';

function processPayroll() {
    const monthFilter = document.getElementById('payrollMonthFilter')?.value;
    if (!monthFilter) {
        showToast('Please select a month first!', 'error');
        return;
    }

    loadPayroll();

    // Save processed payroll records
    const [year, month] = monthFilter.split('-');
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const activeEmployees = employees.filter(e => e.status === 'active');
    const payrollRecords = [];

    activeEmployees.forEach(emp => {
        const empDTRs = dtrEntries.filter(d =>
            d.employeeId === emp.id &&
            d.date >= startDate &&
            d.date <= endDate
        );
        const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
        if (payrollData.daysWorked > 0) {
            payrollRecords.push({
                id: 'PR-' + Date.now() + '-' + emp.id,
                employeeId: emp.id,
                employeeName: `${emp.firstName} ${emp.lastName}`,
                periodStart: startDate,
                periodEnd: endDate,
                ...payrollData,
                generatedAt: new Date().toISOString()
            });
        }
    });

    // Save to localStorage
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYROLL) || '[]');
    // Remove existing records for same period
    const filtered = existing.filter(p => !(p.periodStart === startDate && p.periodEnd === endDate));
    const updated = [...filtered, ...payrollRecords];
    localStorage.setItem(STORAGE_KEYS.PAYROLL, JSON.stringify(updated));

    showToast(`Payroll processed for ${payrollRecords.length} employees!`, 'success');
}

function generatePayslip(employeeId, startDate, endDate) {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;

    const empDTRs = dtrEntries.filter(d =>
        d.employeeId === employeeId &&
        d.date >= startDate &&
        d.date <= endDate
    );

    const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);

    // Create payslip HTML
    const monthName = new Date(startDate).toLocaleString('default', { month: 'long', year: 'numeric' });
    const payslipHTML = `
        <div class="payslip" style="padding: 20px; max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
            <!-- Header -->
            <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 24px;">${company.name || 'Company Name'}</h2>
                <p style="margin: 4px 0; font-size: 13px;">${company.address || 'Company Address'}</p>
                <p style="margin: 4px 0; font-size: 12px;">TIN: ${company.tin || '000-000-000-000'}</p>
                <hr style="margin: 16px 0; border-color: #ccc;">
                <h3 style="margin: 0; font-size: 18px;">PAYSLIP</h3>
                <p style="margin: 4px 0; font-size: 13px;">Pay Period: ${formatDate(startDate)} - ${formatDate(endDate)}</p>
            </div>

            <!-- Employee Info -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; font-size: 13px;">
                <div><strong>Employee:</strong> ${emp.firstName} ${emp.lastName}</div>
                <div><strong>Employee ID:</strong> ${emp.id}</div>
                <div><strong>Position:</strong> ${emp.position}</div>
                <div><strong>Pay Period:</strong> ${monthName}</div>
            </div>

            <!-- Earnings -->
            <div style="margin-bottom: 20px;">
                <h4 style="border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 12px;">EARNINGS</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr style="background: #f0f0f0;">
                        <th style="text-align: left; padding: 6px; border: 1px solid #ddd;">Description</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Hours/Days</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Rate</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Amount</th>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Basic Pay (${payrollData.daysWorked} days)</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">${payrollData.daysWorked}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.dailyRate)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.regularPay)}</td>
                    </tr>
                    ${payrollData.otHours > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Overtime Pay</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">${payrollData.otHours.toFixed(2)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.otRate || (payrollData.hourlyRate * 1.25))}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.otPay)}</td>
                    </tr>
                    ` : ''}
                    <tr style="font-weight: bold; background: #f9f9f9;">
                        <td colspan="3" style="text-align: right; padding: 8px; border: 1px solid #ddd;">GROSS PAY</td>
                        <td style="text-align: right; padding: 8px; border: 1px solid #ddd;">₱${formatNumber(payrollData.grossPay)}</td>
                    </tr>
                </table>
            </div>

            <!-- Deductions -->
            <div style="margin-bottom: 20px;">
                <h4 style="border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 12px;">DEDUCTIONS</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr style="background: #f0f0f0;">
                        <th style="text-align: left; padding: 6px; border: 1px solid #ddd;">Description</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Amount</th>
                    </tr>
                    ${payrollData.lateDeduction > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Late Deduction (${payrollData.lateMinutes || 0} min)</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.lateDeduction)}</td>
                    </tr>
                    ` : ''}
                    ${settings.enableStatutoryDeductions !== false ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">SSS Contribution</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.sssDeduction)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">PhilHealth Contribution</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.philhealthDeduction)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Pag-IBIG Contribution</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.pagibigDeduction)}</td>
                    </tr>
                    ` : ''}
                    <tr style="font-weight: bold; background: #f9f9f9;">
                        <td style="padding: 8px; border: 1px solid #ddd;">TOTAL DEDUCTIONS</td>
                        <td style="text-align: right; padding: 8px; border: 1px solid #ddd;">₱${formatNumber(payrollData.totalDeductions)}</td>
                    </tr>
                </table>
            </div>

            <!-- Net Pay -->
            <div style="border: 2px solid #333; border-radius: 8px; padding: 20px; text-align: center; background: #f8f9fa;">
                <p style="margin: 0 0 8px; font-size: 14px; color: #666;">NET PAY</p>
                <p style="margin: 0; font-size: 28px; font-weight: bold; color: #2563eb;">₱${formatNumber(payrollData.netPay)}</p>
            </div>

            ${settings.enableStatutoryDeductions !== false ? `
            <!-- Employer Share (for reference) -->
            <div style="margin-top: 20px; padding: 12px; background: #f0f0f0; border-radius: 4px; font-size: 11px;">
                <strong>Employer Contributions (for reference):</strong><br>
                SSS: ₱${formatNumber(payrollData.sssER)} | PhilHealth: ₱${formatNumber(payrollData.philhealthER)} | Pag-IBIG: ₱${formatNumber(payrollData.pagibigER)}
            </div>
` : ''}

            <!-- Footer -->
            <div style="margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 12px;">
                <div>
                    <p style="margin: 0 0 40px;">___________________________</p>
                    <p style="margin: 0;">Employee Signature</p>
                </div>
                <div>
                    <p style="margin: 0 0 40px;">___________________________</p>
                    <p style="margin: 0;">Authorized Signatory</p>
                </div>
            </div>

            <div style="margin-top: 20px; text-align: center; font-size: 10px; color: #999;">
                Generated on ${new Date().toLocaleString()} | This is a computer-generated payslip
            </div>
        </div>
    `;

    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payslip - ${emp.firstName} ${emp.lastName}</title>
            <style>
                @media print {
                    @page { margin: 15mm; }
                    body { margin: 0; }
                }
                body { margin: 20px; }
            </style>
        </head>
        <body>${payslipHTML}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
}

// ============================================
// QR Scanner Functions
// ============================================

let qrScannerActive = false;
let videoStream = null;
let scanInterval = null;

function initializeQRScanner() {
    // Check for camera access
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        setupCamera();
    } else {
        document.getElementById('qrScannerArea').innerHTML = `
            <i class="fas fa-camera-slash" style="font-size: 48px; color: var(--gray-500);"></i>
            <h3>Camera Not Available</h3>
            <p>Camera access is required for QR scanning. Please enable camera permissions.</p>
        `;
    }
}

async function setupCamera() {
    // Stop any existing stream
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        videoStream = stream;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.style.cssText = 'width: 100%; max-width: 300px; border-radius: 8px;';
        video.setAttribute('playsinline', '');
        video.muted = true;

        // Build the surrounding UI first, then attach the REAL video element
        // via appendChild (not innerHTML/outerHTML). Setting innerHTML to a
        // video's outerHTML string drops the live `srcObject` stream - the
        // browser parses a brand-new, streamless <video> tag from the markup.
        // That was the bug: the visible video had no feed, while decoding
        // kept reading frames from the orphaned original element, which
        // mobile browsers throttle/freeze once it's detached from the DOM -
        // so scans were silently never detected.
        document.getElementById('qrScannerArea').innerHTML = `
            <div class="qr-placeholder">
                <div class="qr-frame" id="qrVideoFrame" style="position: relative; overflow: hidden;"></div>
            </div>
            <p>Point the camera at the employee QR code</p>
            <div class="qr-status">
                <span class="badge badge-info"><i class="fas fa-spinner fa-spin"></i> Scanning...</span>
            </div>
            <button class="btn btn-sm btn-outline mt-2" onclick="stopQRScanner()">
                <i class="fas fa-stop"></i> Stop Scanner
            </button>
        `;
        document.getElementById('qrVideoFrame').appendChild(video);
        await video.play();

        // Start QR decoding loop
        qrScannerActive = true;
        startQRDecoding(video);

    } catch (err) {
        console.error('Camera error:', err);
        document.getElementById('qrScannerArea').innerHTML = `
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: var(--danger);"></i>
            <h3>Camera Access Denied</h3>
            <p>Please allow camera access in your browser settings to use QR scanning.</p>
            <button class="btn btn-primary" onclick="setupCamera()">
                <i class="fas fa-camera"></i> Try Again
            </button>
        `;
    }
}

function stopQRScanner() {
    qrScannerActive = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }

    // Reset UI
    document.getElementById('qrScannerArea').innerHTML = `
        <i class="fas fa-camera"></i>
        <h3>QR Scanner</h3>
        <p>Point your camera at the employee QR code</p>
        <div class="qr-placeholder">
            <div class="qr-frame">
                <i class="fas fa-qrcode fa-3x"></i>
            </div>
        </div>
        <div class="qr-status">
            <span class="badge badge-info">Ready to Scan</span>
        </div>
        <button class="btn btn-primary mt-2" onclick="setupCamera()">
            <i class="fas fa-camera"></i> Start Scanner
        </button>
    `;
}

async function startQRDecoding(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    scanInterval = setInterval(async () => {
        if (!qrScannerActive || video.paused || video.ended) return;

        try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Use jsQR library for real QR decoding
            if (typeof jsQR !== 'undefined') {
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'dontInvert',
                });

                if (code) {
                    // QR code detected!
                    handleQRCode(code.data);
                    return; // Stop scanning after successful read
                }
            }
        } catch (e) {
            console.error('QR decode error:', e);
        }
    }, 300); // Scan ~3 times per second
}

function handleQRCode(data) {
    // Stop scanner after successful scan
    stopQRScanner();

    // Expected format: "EMPLOYEE_ID" or "payroll://EMP-ID"
    let employeeId = data;
    if (data.startsWith('payroll://')) {
        employeeId = data.replace('payroll://', '');
    }

    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found: ' + employeeId, 'error');
        // Restart scanner after error
        setTimeout(() => {
            qrScannerActive = true;
            setupCamera();
        }, 2000);
        return;
    }

    processQRScan(employee);
}

function processQRScan(employee) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().slice(0, 5);

    // Check if already scanned today for this employee
    const existingDTR = dtrEntries.find(d =>
        d.employeeId === employee.id &&
        d.date === dateStr &&
        d.status !== 'absent'
    );

    if (existingDTR) {
        // Time out
        existingDTR.timeOut = timeStr;
        existingDTR.totalHours = calculateWorkHours(existingDTR.timeIn, timeStr);
        existingDTR.status = 'present';

        // Calculate late minutes if not set
        if (!existingDTR.lateMinutes || existingDTR.lateMinutes === 0) {
            existingDTR.lateMinutes = calculateLateMinutes(existingDTR.timeIn);
        }

        showToast(`${employee.firstName} ${employee.lastName} - Time Out: ${timeStr}`, 'info');
    } else {
        // Time in
        const lateMinutes = calculateLateMinutes(timeStr);
        const newDTR = {
            id: 'DTR-' + Date.now(),
            employeeId: employee.id,
            date: dateStr,
            timeIn: timeStr,
            timeOut: null,
            totalHours: 0,
            otHours: 0,
            lateMinutes: lateMinutes,
            status: lateMinutes > 0 ? 'late' : 'present',
            createdAt: new Date().toISOString()
        };

        dtrEntries.push(newDTR);
        showToast(`${employee.firstName} ${employee.lastName} - Time In: ${timeStr}`, 'success');
    }

    localStorage.setItem(STORAGE_KEYS.DTR, JSON.stringify(dtrEntries));
    loadDTR();
    updateDashboard();
    updateQRScannerUI(employee);
}

function updateQRScannerUI(employee) {
    const scannerArea = document.getElementById('qrScannerArea');
    const resultDiv = document.getElementById('qrResult');

    resultDiv.classList.remove('hidden');
    scannerArea.classList.add('hidden');

    document.getElementById('qrEmployeeName').textContent = `${employee.firstName} ${employee.lastName} (${employee.id})`;
    document.getElementById('qrTimestamp').textContent = `Time: ${new Date().toLocaleString()}`;
}

function scanAnother() {
    document.getElementById('qrResult').classList.add('hidden');
    document.getElementById('qrScannerArea').classList.remove('hidden');
    qrScannerActive = true;
}

function generateAllQRCodes() {
    const qrGrid = document.getElementById('qrCodeGrid');
    qrGrid.innerHTML = '';

    employees.filter(e => e.status === 'active').forEach(emp => {
        const card = document.createElement('div');
        card.className = 'qr-card';
        card.innerHTML = `
            <div style="display: flex; justify-content: center;">
                <div id="qr-${emp.id}"></div>
            </div>
            <div class="qr-name">${emp.firstName} ${emp.lastName}</div>
            <small class="text-muted">${emp.id}</small>
        `;
        card.onclick = () => viewQREmployee(emp.id);
        qrGrid.appendChild(card);

        // Generate real QR code
        generateRealQRCode(`payroll://${emp.id}`, `qr-${emp.id}`);
    });
}

function printQRCodes() {
    window.print();
}

function viewQREmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('qrEmployeeDisplayName').textContent = `${emp.firstName} ${emp.lastName} - ${emp.id}`;
    const qrDisplay = document.getElementById('qrCodeDisplay');
    qrDisplay.innerHTML = '';
    generateRealQRCode(`payroll://${emp.id}`, 'qrCodeDisplay');
    showModal('qrModal');
}

function generateRealQRCode(data, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Use QRCode library if available
    if (typeof QRCode !== 'undefined') {
        new QRCode(element, {
            text: data,
            width: 150,
            height: 150,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        // Fallback - simple visual
        element.innerHTML = `
            <div style="width:150px;height:150px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:8px;">
                <span style="font-size:12px;color:#666;">QR: ${data}</span>
            </div>
        `;
    }
}

// ============================================
// Dashboard Functions
// ============================================

function updateDashboard() {
    // Total employees
    const activeEmployees = employees.filter(e => e.status === 'active').length;
    document.getElementById('totalEmployees').textContent = activeEmployees;

    // Present today
    const today = new Date().toISOString().split('T')[0];
    const todayDTR = dtrEntries.filter(d => d.date === today && (d.status === 'present' || d.status === 'late'));
    document.getElementById('presentToday').textContent = todayDTR.length;

    // Late today
    const lateToday = todayDTR.filter(d => d.status === 'late');
    document.getElementById('lateToday').textContent = lateToday.length;

    // Total payroll (estimated for current month)
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const monthDTR = dtrEntries.filter(d => d.date >= monthStart);
    const totalPayroll = monthDTR.reduce((sum, d) => {
        const emp = employees.find(e => e.id === d.employeeId);
        if (!emp) return sum;
        if (d.status === 'present' || d.status === 'late') {
            return sum + (emp.baseDailyPay || settings.baseDailyPay || 500);
        }
        return sum;
    }, 0);
    document.getElementById('totalPayroll').textContent = '₱' + formatNumber(totalPayroll);

    // Recent DTR entries
    renderRecentDTR();

    // Attendance chart
    renderAttendanceChart();
}

function renderRecentDTR() {
    const container = document.getElementById('recentDTR');
    container.innerHTML = '';

    const recent = dtrEntries
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

    if (recent.length === 0) {
        container.innerHTML = '<p class="text-muted text-center" style="padding: 20px;">No DTR entries yet</p>';
        return;
    }

    recent.forEach(dtr => {
        const emp = employees.find(e => e.id === dtr.employeeId);
        if (!emp) return;

        const statusClass = dtr.status === 'present' ? 'badge-success' :
                          dtr.status === 'late' ? 'badge-warning' :
                          dtr.status === 'absent' ? 'badge-danger' : 'badge-info';

        const item = document.createElement('div');
        item.className = 'dtr-mini-item';
        item.innerHTML = `
            <span class="dtr-date">${formatDate(dtr.date)}</span>
            <span class="dtr-name">${emp.firstName} ${emp.lastName}</span>
            <span class="dtr-time">${dtr.timeIn || '-'} - ${dtr.timeOut || '-'}</span>
            <span class="dtr-status"><span class="badge ${statusClass}">${capitalize(dtr.status)}</span></span>
        `;
        container.appendChild(item);
    });
}

function renderAttendanceChart() {
    const container = document.getElementById('attendanceChart');
    container.innerHTML = '';

    // Get last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        days.push(date.toISOString().split('T')[0]);
    }

    const maxCount = Math.max(...days.map(date =>
        dtrEntries.filter(d => d.date === date && d.status === 'present').length
    ), 1);

    days.forEach(date => {
        const presents = dtrEntries.filter(d => d.date === date && d.status === 'present').length;
        const lates = dtrEntries.filter(d => d.date === date && d.status === 'late').length;
        const absents = dtrEntries.filter(d => d.date === date && d.status === 'absent').length;

        const height = Math.max((presents / maxCount) * 80, 10);

        const bar = document.createElement('div');
        bar.className = 'attendance-bar present';
        bar.style.height = height + 'px';
        bar.innerHTML = `<span>${formatDateShort(date)}</span>`;
        container.appendChild(bar);
    });
}

// ============================================
// Reports Functions
// ============================================

function generateReport() {
    const monthValue = document.getElementById('reportMonth').value;
    if (!monthValue) {
        showToast('Please select a month!', 'error');
        return;
    }

    const [year, month] = monthValue.split('-');
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    const container = document.getElementById('reportContent');

    let reportHTML = `
        <div class="report-header">
            <h2>Payroll Summary Report</h2>
            <p>${monthName} ${year} | Generated: ${new Date().toLocaleString()}</p>
        </div>
        <div class="report-summary">
    `;

    const activeEmployees = employees.filter(e => e.status === 'active');
    let totalGrossPay = 0;
    let totalDeductions = 0;
    let totalNetPay = 0;

    activeEmployees.forEach(emp => {
        const empDTRs = dtrEntries.filter(d =>
            d.employeeId === emp.id &&
            d.date >= startDate &&
            d.date <= endDate
        );

        const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);

        if (payrollData.daysWorked > 0) {
            totalGrossPay += payrollData.grossPay;
            totalDeductions += payrollData.totalDeductions;
            totalNetPay += payrollData.netPay;

            reportHTML += `
                <div class="summary-row">
                    <span>${emp.firstName} ${emp.lastName} (${emp.id})</span>
                    <span>₱${formatNumber(payrollData.netPay)}</span>
                </div>
            `;
        }
    });

    reportHTML += `
        </div>
        <div class="report-summary" style="margin-top: 16px;">
            <div class="summary-row">
                <span>Total Gross Pay</span>
                <span>₱${formatNumber(totalGrossPay)}</span>
            </div>
            <div class="summary-row">
                <span>Total Deductions</span>
                <span style="color: var(--danger);">-₱${formatNumber(totalDeductions)}</span>
            </div>
            <div class="summary-row" style="font-size: 18px; border-top: 2px solid var(--gray-300); margin-top: 8px; padding-top: 12px;">
                <span>Total Net Pay</span>
                <strong>₱${formatNumber(totalNetPay)}</strong>
            </div>
        </div>
    `;

    container.innerHTML = reportHTML;
}

// ============================================
// Navigation Functions
// ============================================

function navigateTo(page) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Update title
    const titles = {
        dashboard: ['Dashboard', 'Overview of your payroll system'],
        employees: ['Employees', 'Manage your employee records'],
        dtr: ['DTR Entries', 'Daily Time Records for employees'],
        qr: ['QR Scanner', 'Scan employee QR codes for time tracking'],
        payroll: ['Payroll', 'Process and compute employee payroll'],
        settings: ['Settings', 'Configure payroll system settings'],
        reports: ['Reports', 'Generate payroll reports']
    };

    const [title, subtitle] = titles[page] || ['Dashboard', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSubtitle').textContent = subtitle;

    // Load data when navigating
    if (page === 'dtr') loadDTR();
    if (page === 'payroll') loadPayroll();
    if (page === 'reports') generateReport();
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.page);
    });
});

function showAddModal() {
    const activePage = document.querySelector('.page.active');
    if (activePage) {
        const pageId = activePage.id.replace('page-', '');
        if (pageId === 'employees') {
            addEmployee();
        } else if (pageId === 'dtr') {
            showDTRAddModal();
        } else {
            addEmployee();
        }
    }
}

// ============================================
// Modal Functions
// ============================================

function showModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        closeModal(e.target.closest('.modal').id);
    });
});

// Close modal on escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
            modal.classList.add('hidden');
        });
    }
});

// ============================================
// Toast Functions
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };

    toast.innerHTML = `<i class="${icons[type]}"></i> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Export/Import Functions
// ============================================

function exportData() {
    const data = {
        settings: settings,
        employees: employees,
        dtr: dtrEntries,
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Data exported successfully!', 'success');
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (confirm('This will replace all existing data. Are you sure you want to continue?')) {
                if (data.settings) {
                    settings = data.settings;
                    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
                }

                if (data.employees) {
                    employees = data.employees;
                    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
                }

                if (data.dtr) {
                    dtrEntries = data.dtr;
                    localStorage.setItem(STORAGE_KEYS.DTR, JSON.stringify(dtrEntries));
                }

                loadSettings();
                loadEmployees();
                loadDTR();
                updateDashboard();

                showToast('Data imported successfully!', 'success');
            }
        } catch (err) {
            showToast('Invalid file format!', 'error');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

// ============================================
// Utility Functions
// ============================================

function formatNumber(num) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// Search functionality
// ============================================

document.getElementById('employeeSearch')?.addEventListener('input', renderEmployeeTable);

// ============================================
// Handle page visibility for auto calculations
// ============================================

// Recalculate when settings change
document.querySelectorAll('#settings input, #settings select').forEach(el => {
    el.addEventListener('change', () => {
        if (document.getElementById('page-settings').classList.contains('active')) {
            loadPayroll();
        }
    });
});
