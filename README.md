# Payroll Management System

A complete, functional payroll management system built with HTML, CSS, and JavaScript.

## Features

### 🏠 Dashboard
- Overview statistics (Total Employees, Present Today, Late Today, Total Payroll)
- Recent DTR entries
- Weekly attendance chart

### 👥 Employees
- Add, edit, and delete employees
- Search employees by name, position, or ID
- Track employee status (Active, Inactive, On Leave)
- View and generate individual QR codes

### 📋 DTR (Daily Time Record)
- Manual DTR entry
- Filter by employee and date
- Tracks: Time In, Time Out, Total Hours, OT Hours, Late Minutes
- Status tracking (Present, Late, Absent, Half Day)

### 📱 QR Scanner
- Camera-based QR scanning for time tracking
- Automatic Time In/Time Out logging
- Generate QR codes for all employees
- Print employee QR codes

### 💰 Payroll Processing
- Monthly payroll computation
- Auto-calculate:
  - Days Worked
  - Regular Pay (based on base daily pay)
  - Hourly Pay
  - OT Pay
  - Late Deductions
  - Net Pay

### ⚙️ Settings
- **Late Deduction Options:**
  - Per Minute rate
  - Per Time Range (1-15 min, 16-30 min, etc.)
- OT Rate per hour
- Standard Time In/Out
- Break time minutes
- Base Daily Pay (per day)
- Payroll cutoff day
- Payroll frequency
- Default employee rates

### 📊 Reports
- Monthly payroll summary report
- Employee-wise breakdown
- Total Gross Pay, Deductions, Net Pay

## How to Use

1. Open `index.html` in a web browser to see the marketing/landing page, or go straight to `app.html` for the payroll dashboard
2. Sign in on `app.html` with the admin account created in Supabase Auth
3. Use the sidebar navigation to access different pages

## Data Persistence

Employees and DTR entries live in Supabase (see `supabase/migrations`), so a kiosk scan and the admin dashboard read/write the same data live. Settings and payroll run history still live in the browser's localStorage.

Export data to JSON for backup. Import to restore or transfer data.

## Sample Data

On first load, the system creates 3 sample employees:
- Juan Dela Cruz (Software Engineer)
- Maria Santos (HR Manager)
- Pedro Reyes (Accountant)

## Browser Compatibility

- Modern browsers with localStorage support
- Camera access required for QR scanning (optional feature)
- Works on desktop and mobile devices

## File Structure

```
payroll-system/
├── index.html    # Marketing/landing page (public entry point)
├── app.html       # The payroll dashboard itself (Dashboard, Employees, DTR, QR Scanner, Payroll, Reports, Settings) - linked from index.html's Login / Start Free Trial buttons
├── scan.html      # Standalone kiosk page employees hit via their personal QR code, to log Time In/Out
├── styles.css    # Styling for app.html
├── app.js        # Application logic for app.html
├── supabase-config.js  # Supabase project URL/anon key (copy from supabase-config.example.js)
├── supabase/     # Supabase migrations
└── README.md     # This file
```
