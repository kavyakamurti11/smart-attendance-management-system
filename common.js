/* ============================================================
   common.js — shared helpers for Attendance Management System
   (password hashing, session timeout, cross-faculty data scan)
   ============================================================ */

// ---------- Password hashing (SHA-256 via Web Crypto) ----------
// Note: This is client-side hashing only (no real backend exists in
// this project). It stops passwords being stored/readable as plain
// text in localStorage, but it is NOT a substitute for a real
// server-side auth system with salting + a proper backend.
async function hashPassword(plainText) {
  const enc = new TextEncoder().encode(plainText);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Users store ----------
function getUsers() { return JSON.parse(localStorage.getItem('users') || '[]'); }
function saveUsers(u) { localStorage.setItem('users', JSON.stringify(u)); }

// ---------- Session timeout (auto-logout after inactivity) ----------
// role: 'admin' | 'faculty' | 'student'  — only used for the alert text
// loginPage: file to redirect to after logout
// minutes: inactivity minutes before auto logout (default 30)
function initSessionTimeout(role, loginPage, minutes) {
  const timeoutMs = (minutes || 30) * 60 * 1000;
  let timer = null;

  function doLogout() {
    sessionStorage.removeItem('currentUser');
    alert('You were logged out due to inactivity. Please login again.');
    window.location.href = loginPage;
  }

  function resetTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(doLogout, timeoutMs);
  }

  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetTimer, { passive: true });
  });

  resetTimer();
}

// ---------- Cross-faculty data scanning (used by admin + student) ----------
// Scans every localStorage key that starts with "classes_" (one per
// faculty email) and returns a de-duplicated combined array, plus the
// legacy "classes" key for backward compatibility.
function loadAllClassesData() {
  let allClasses = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('classes_')) {
      try {
        allClasses = allClasses.concat(JSON.parse(localStorage.getItem(key) || '[]'));
      } catch (e) {}
    }
  }
  try {
    allClasses = allClasses.concat(JSON.parse(localStorage.getItem('classes') || '[]'));
  } catch (e) {}

  const seen = new Set();
  return allClasses.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function loadAllTimetablesData() {
  let allTT = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('timetables_')) {
      try {
        allTT = allTT.concat(JSON.parse(localStorage.getItem(key) || '[]'));
      } catch (e) {}
    }
  }
  try {
    allTT = allTT.concat(JSON.parse(localStorage.getItem('timetables') || '[]'));
  } catch (e) {}

  const seen = new Set();
  return allTT.filter(t => {
    if (seen.has(t.classId)) return false;
    seen.add(t.classId);
    return true;
  });
}

// ---------- Notifications (absent-marking + low monthly attendance) ----------
// Stored as one shared "notifications" array in localStorage, tagged with the
// student's roll number so each student's login only sees their own.
function getAllNotifications() {
  try { return JSON.parse(localStorage.getItem('notifications') || '[]'); }
  catch (e) { return []; }
}

function saveAllNotifications(list) {
  localStorage.setItem('notifications', JSON.stringify(list));
}

function pushNotification(notif) {
  const list = getAllNotifications();
  list.unshift({
    id: 'n_' + Math.random().toString(36).slice(2, 9),
    read: false,
    date: new Date().toISOString(),
    ...notif
  });
  // Keep the list from growing forever
  saveAllNotifications(list.slice(0, 500));
}

function getNotificationsForRoll(roll) {
  const r = String(roll).trim().toLowerCase();
  return getAllNotifications().filter(n => String(n.roll).trim().toLowerCase() === r);
}

function markNotificationRead(id) {
  const list = getAllNotifications();
  const n = list.find(x => x.id === id);
  if (n) { n.read = true; saveAllNotifications(list); }
}

function markAllNotificationsRead(roll) {
  const r = String(roll).trim().toLowerCase();
  const list = getAllNotifications();
  list.forEach(n => { if (String(n.roll).trim().toLowerCase() === r) n.read = true; });
  saveAllNotifications(list);
}

// Notify a student they were marked absent on a given date, unless we've
// already sent that exact notification (avoids duplicates on re-save).
function notifyAbsent(cls, student, dateKey) {
  const dup = getAllNotifications().some(n =>
    n.type === 'absent' && n.classId === cls.id &&
    String(n.roll) === String(student.roll) && n.dateKey === dateKey
  );
  if (dup) return;
  pushNotification({
    roll: student.roll,
    studentName: student.name,
    classId: cls.id,
    className: cls.name,
    faculty: cls.faculty,
    type: 'absent',
    dateKey: dateKey,
    message: `You were marked ABSENT in ${cls.name} (${cls.subject || ''}) on ${dateKey}.`
  });
}

// Checks this calendar month's attendance % for a student in a class; if it's
// below 75%, sends one low-attendance alert per student/class/month (not one
// per lecture, so it doesn't spam).
function checkAndNotifyLowMonthlyAttendance(cls, student) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

  let total = 0, present = 0;
  if (cls.attendance) {
    Object.keys(cls.attendance).forEach(dateKey => {
      const d = new Date(dateKey);
      if (isNaN(d)) return;
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
      const rec = cls.attendance[dateKey].find(r => String(r.student.roll) === String(student.roll));
      if (rec) { total++; if (rec.present) present++; }
    });
  }
  if (total === 0) return;
  const pct = Math.round((present / total) * 100);
  if (pct >= 75) return;

  const alreadySent = getAllNotifications().some(n =>
    n.type === 'low_attendance' && n.classId === cls.id &&
    String(n.roll) === String(student.roll) && n.monthKey === monthKey
  );
  if (alreadySent) return;

  pushNotification({
    roll: student.roll,
    studentName: student.name,
    classId: cls.id,
    className: cls.name,
    faculty: cls.faculty,
    type: 'low_attendance',
    monthKey: monthKey,
    message: `⚠️ Your attendance in ${cls.name} this month is ${pct}% — below the 75% requirement.`
  });
}
function exportAllData() {
  const dump = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    dump[key] = localStorage.getItem(key);
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    data: dump
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function restoreAllData(file, onDone) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const parsed = JSON.parse(e.target.result);
      const data = parsed.data || parsed; // allow raw dump too
      Object.keys(data).forEach(key => {
        localStorage.setItem(key, data[key]);
      });
      if (onDone) onDone(true);
    } catch (err) {
      if (onDone) onDone(false, err);
    }
  };
  reader.readAsText(file);
}
