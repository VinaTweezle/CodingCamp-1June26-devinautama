/**
 * To-Do Life Dashboard — app.js
 * All application logic organised as module-like namespaced objects.
 *
 * Modules:  Storage · Theme · Greeting · Timer · Tasks
 * Storage keys:
 *   tld_username — saved user name (string)
 *   tld_theme    — active theme ('light' | 'dark')
 *   tld_tasks    — task array (JSON)
 *   tld_links    — links array (JSON)
 */

'use strict';

/* ── Shared helpers ────────────────────────────────────────────────────── */

/** Shorthand for document.getElementById */
const $ = (id) => document.getElementById(id);

/** Generate a unique ID (crypto.randomUUID when available, else Date.now) */
const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString();

/* ══════════════════════════════════════════════════════════════════════════
   Storage
   Thin wrapper around localStorage with JSON serialisation and error safety.
   ══════════════════════════════════════════════════════════════════════════ */

const Storage = {
  /** Return parsed JSON for key, or null on miss / parse error. */
  get(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  /** Serialise value to JSON and write to localStorage. Logs on failure. */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error(`Storage.set failed for "${key}":`, err);
    }
  },

  /** Remove key from localStorage. */
  remove(key) {
    localStorage.removeItem(key);
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Theme
   Manages light/dark theme: reads from Storage, sets data-theme on <html>,
   and syncs the toggle button icon and aria-label.

   Storage key: tld_theme → 'light' | 'dark'   Default: 'light'
   ══════════════════════════════════════════════════════════════════════════ */

const Theme = {
  _current: /** @type {'light'|'dark'} */ ('light'),
  _btn: /** @type {HTMLButtonElement|null} */ (null),

  init() {
    this._btn = $('theme-toggle');
    const stored = Storage.get('tld_theme');
    this._current = stored === 'dark' ? 'dark' : 'light';
    this._apply();
    this._btn?.addEventListener('click', () => Theme.toggle());
  },

  toggle() {
    this._current = this._current === 'light' ? 'dark' : 'light';
    Storage.set('tld_theme', this._current);
    this._apply();
  },

  _apply() {
    document.documentElement.setAttribute('data-theme', this._current);
    if (!this._btn) return;

    const isDark = this._current === 'dark';
    this._btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    this._btn.textContent = isDark ? '☀️' : '🌙';
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Greeting helpers — pure, stateless functions
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Map hour 0–23 to a greeting string.
 *  5–11  → "Good morning"
 * 12–17  → "Good afternoon"
 * 18–21  → "Good evening"
 * 22–23, 0–4 → "Good night"
 */
function getGreeting(hour) {
  if (hour >= 5  && hour <= 11) return 'Good morning';
  if (hour >= 12 && hour <= 17) return 'Good afternoon';
  if (hour >= 18 && hour <= 21) return 'Good evening';
  return 'Good night';
}

/** Format Date → zero-padded "HH:MM". */
function formatTime(date) {
  return [date.getHours(), date.getMinutes()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** Format Date → "Weekday, D Month YYYY". Day is not zero-padded. */
function formatDate(date) {
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${DAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Append ", name" to greeting when name is non-empty, otherwise return greeting unchanged. */
function formatGreeting(greeting, name) {
  return name ? `${greeting}, ${name}` : greeting;
}

/* ══════════════════════════════════════════════════════════════════════════
   Greeting
   Displays time, date, and a personalised greeting. Persists the user name.
   Updates every 60 seconds via setInterval.

   DOM: #greeting-text · #clock · #date-display · #name-input · #name-submit
   Storage key: tld_username
   ══════════════════════════════════════════════════════════════════════════ */

const Greeting = {
  _intervalId: /** @type {number|null} */ (null),

  init() {
    const savedName = Storage.get('tld_username') || '';
    const nameInput = $('name-input');
    if (nameInput) nameInput.value = savedName;

    this._tick(savedName);
    this._intervalId = setInterval(() => {
      this._tick(Storage.get('tld_username') || '');
    }, 60_000);

    $('name-submit')?.addEventListener('click',   () => Greeting._handleSubmit());
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Greeting._handleSubmit();
    });
  },

  setName(name) {
    name ? Storage.set('tld_username', name) : Storage.remove('tld_username');
    const greetingEl = $('greeting-text');
    if (greetingEl) greetingEl.textContent = formatGreeting(getGreeting(new Date().getHours()), name);
  },

  _handleSubmit() {
    const nameInput = $('name-input');
    this.setName(nameInput ? nameInput.value.trim() : '');
  },

  _tick(name) {
    const now = new Date();
    const greetingEl = $('greeting-text');
    const clockEl    = $('clock');
    const dateEl     = $('date-display');
    if (greetingEl) greetingEl.textContent = formatGreeting(getGreeting(now.getHours()), name);
    if (clockEl)    clockEl.textContent    = formatTime(now);
    if (dateEl)     dateEl.textContent     = formatDate(now);
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Timer
   25-minute Pomodoro countdown with a three-state machine:
     idle ──start──► running ──stop──► paused ──start──► running
      ▲                 │                  │
      └──────reset───────┘◄────reset────────┘
   Reaching 0 triggers auto-reset + alert.

   Timer.formatTime(secs) converts integer seconds → zero-padded "MM:SS".
   DOM: #timer-display · #timer-start · #timer-stop · #timer-reset
   ══════════════════════════════════════════════════════════════════════════ */

const Timer = {
  _state:     /** @type {'idle'|'running'|'paused'} */ ('idle'),
  _remaining: 1500,
  _intervalId: /** @type {number|null} */ (null),

  /** Convert integer seconds [0, 1500] → "MM:SS". */
  formatTime(secs) {
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  },

  init() {
    this._state     = 'idle';
    this._remaining = 1500;
    this._intervalId = null;
    this._render();

    $('timer-start')?.addEventListener('click', () => Timer.start());
    $('timer-stop')?.addEventListener('click',  () => Timer.stop());
    $('timer-reset')?.addEventListener('click', () => Timer.reset());
  },

  start() {
    if (this._state === 'running') return;
    this._state = 'running';

    const startBtn = $('timer-start');
    if (startBtn) startBtn.disabled = true;

    this._intervalId = setInterval(() => {
      this._remaining -= 1;
      this._render();
      if (this._remaining <= 0) {
        Timer.reset();
        alert('Focus session complete!');
      }
    }, 1000);
  },

  stop() {
    if (this._state !== 'running') return;
    this._state = 'paused';
    clearInterval(this._intervalId);
    this._intervalId = null;
  },

  reset() {
    clearInterval(this._intervalId);
    this._intervalId = null;
    this._state     = 'idle';
    this._remaining = 1500;
    const startBtn = $('timer-start');
    if (startBtn) startBtn.disabled = false;
    this._render();
  },

  _render() {
    const display = $('timer-display');
    if (display) display.textContent = this.formatTime(this._remaining);
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Tasks
   Full CRUD task list with drag-and-drop reordering and localStorage persistence.

   Task shape: { id: string, text: string, completed: boolean, order: number }
   DOM: #task-list · #task-input · #task-submit · #task-validation
        #sort-active · #sort-completed
   Storage key: tld_tasks
   ══════════════════════════════════════════════════════════════════════════ */

const Tasks = {
  _tasks:  /** @type {Array<{id:string, text:string, completed:boolean, order:number}>} */ ([]),
  _dragId: /** @type {string|null} */ (null),

  init() {
    const stored = Storage.get('tld_tasks');
    this._tasks = Array.isArray(stored) ? stored : [];
    this.render();

    const taskInput = $('task-input');
    $('task-submit')?.addEventListener('click',   () => Tasks.add(taskInput?.value ?? ''));
    taskInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') Tasks.add(taskInput.value); });

    $('sort-active')?.addEventListener('click',    () => Tasks.sort('active-first'));
    $('sort-completed')?.addEventListener('click', () => Tasks.sort('completed-first'));
  },

  render() {
    const list = $('task-list');
    if (!list) return;

    list.innerHTML = '';
    const sorted = this._tasks.slice().sort((a, b) => a.order - b.order);

    for (const task of sorted) {
      const li = this._createTaskItem(task, list);
      list.appendChild(li);
    }
  },

  /** Build a single <li> element for a task and attach all event listeners. */
  _createTaskItem(task, list) {
    const li = document.createElement('li');
    li.setAttribute('draggable', 'true');
    li.dataset.id = task.id;
    li.className  = 'task-item';

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', `Mark "${task.text}" as ${task.completed ? 'incomplete' : 'complete'}`);
    checkbox.addEventListener('change', () => Tasks.toggle(task.id));

    // Text span
    const label = document.createElement('span');
    label.className   = task.completed ? 'task-text task-text--completed' : 'task-text';
    label.textContent = task.text;

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.type      = 'button';
    editBtn.className = 'task-btn task-btn--edit';
    editBtn.setAttribute('aria-label', `Edit task: ${task.text}`);
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', () => Tasks._startEdit(task.id, li, label));

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type      = 'button';
    deleteBtn.className = 'task-btn task-btn--delete';
    deleteBtn.setAttribute('aria-label', `Delete task: ${task.text}`);
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', () => Tasks.delete(task.id));

    li.append(checkbox, label, editBtn, deleteBtn);
    this._attachDragHandlers(li, task, list);
    return li;
  },

  /** Wire the four drag-and-drop events on a task <li>. */
  _attachDragHandlers(li, task, list) {
    li.addEventListener('dragstart', (e) => {
      Tasks._dragId = task.id;
      li.classList.add('task-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
      Tasks._dragId = null;
      li.classList.remove('task-item--dragging');
      list.querySelectorAll('.task-item--drag-over').forEach((el) =>
        el.classList.remove('task-item--drag-over')
      );
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.task-item--drag-over').forEach((el) =>
        el.classList.remove('task-item--drag-over')
      );
      if (Tasks._dragId !== task.id) li.classList.add('task-item--drag-over');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('task-item--drag-over');
      const fromId = Tasks._dragId;
      const toId   = task.id;
      if (fromId && fromId !== toId) Tasks._reorder(fromId, toId);
    });
  },

  add(text) {
    const trimmed = String(text).trim();
    const validationEl = $('task-validation');

    if (!trimmed) {
      if (validationEl) validationEl.textContent = 'Task description cannot be empty.';
      return;
    }
    if (validationEl) validationEl.textContent = '';

    this._tasks.push({ id: newId(), text: trimmed, completed: false, order: this._tasks.length });
    this._persist();
    this.render();

    const taskInput = $('task-input');
    if (taskInput) taskInput.value = '';
  },

  toggle(id) {
    const task = this._tasks.find((t) => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    this._persist();
    this.render();
  },

  edit(id, newText) {
    const trimmed = String(newText).trim();
    const task = this._tasks.find((t) => t.id === id);
    if (!task) return;
    if (trimmed) { task.text = trimmed; this._persist(); }
    this.render();
  },

  delete(id) {
    this._tasks = this._tasks.filter((t) => t.id !== id);
    this._persist();
    this.render();
  },

  sort(mode) {
    const completedLast  = (a, b) => (a.completed === b.completed ? a.order - b.order : a.completed ? 1 : -1);
    const completedFirst = (a, b) => (a.completed === b.completed ? a.order - b.order : a.completed ? -1 : 1);
    this._tasks.sort(mode === 'active-first' ? completedLast : completedFirst);
    this._tasks.forEach((t, i) => { t.order = i; });
    this._persist();
    this.render();
  },

  _startEdit(id, li, label) {
    const task = this._tasks.find((t) => t.id === id);
    if (!task) return;

    const input = document.createElement('input');
    input.type      = 'text';
    input.value     = task.text;
    input.className = 'task-edit-input';
    input.setAttribute('aria-label', `Edit text for task: ${task.text}`);

    li.replaceChild(input, label);
    input.focus();

    const commit = () => Tasks.edit(id, input.value.trim());

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { input.removeEventListener('blur', commit); commit(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); Tasks.render(); }
    });
  },

  _reorder(fromId, toId) {
    const from = this._tasks.findIndex((t) => t.id === fromId);
    const to   = this._tasks.findIndex((t) => t.id === toId);
    if (from === -1 || to === -1) return;
    const [moved] = this._tasks.splice(from, 1);
    this._tasks.splice(to, 0, moved);
    this._tasks.forEach((t, i) => { t.order = i; });
    this._persist();
    this.render();
  },

  _persist() {
    Storage.set('tld_tasks', this._tasks);
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Bootstrap — initialise all modules after DOM is parsed
   ══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  Greeting.init();
  Timer.init();
  Tasks.init();
});