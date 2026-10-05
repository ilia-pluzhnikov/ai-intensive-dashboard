/**
 * DRAGON CHASE - Dashboard Logic
 */

// Live data: written to the bucket by the save function (yandex/save-function)
const DATA_URL = './live/data.json';
const FALLBACK_URL = './data/cohort-1.json';

// Avatar path prefix
const AVATAR_PATH = './assets/avatars/';

// Dragon mechanics
const DRAGON_EXPONENT = 1.5;
const DRAGON_MAX = 90; // dragon reaches 90%, not 100% — rescue zone

// Intro replay: everyone runs from the start line to today's positions
const INTRO_MS = 2000;
const INTRO_STAGGER_MS = 80;

// Bonus points for all students (hotfix)
const BONUS_POINTS = 10;

let cohortData = null;
let hunter = null;
let introPlayed = false;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Load live cohort data (with fallback to the JSON file from the repo)
 */
async function loadData() {
  try {
    let response = await fetch(DATA_URL + '?t=' + Date.now());
    if (!response.ok) {
      console.log('Live data not available, using fallback JSON');
      response = await fetch(FALLBACK_URL);
    }
    cohortData = await response.json();
    renderDashboard();
  } catch (error) {
    console.error('Failed to load data:', error);
    document.body.innerHTML = '<div class="container"><h1>ERROR LOADING DATA</h1></div>';
  }
}

/**
 * Escape HTML and render light markdown: URLs → links, **bold**, \n → <br>
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderRichText(str) {
  let safe = escapeHtml(str);
  safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\n/g, '<br>');
  return safe;
}

/**
 * Get all tasks from nested weeks structure
 */
function getAllTasks() {
  const tasks = [];
  cohortData.weeks.forEach(week => {
    week.sections.forEach(section => {
      section.tasks.forEach(task => {
        tasks.push({ ...task, week: week.week });
      });
    });
  });
  return tasks;
}

/**
 * Calculate total points for a student
 */
function getStudentPoints(studentId) {
  const checkins = cohortData.checkins[studentId] || [];
  const allTasks = getAllTasks();
  const taskPoints = allTasks
    .filter(task => checkins.includes(task.id))
    .reduce((sum, task) => sum + task.points, 0);
  return taskPoints + BONUS_POINTS;
}

/**
 * Get max possible points
 */
function getMaxPoints() {
  return getAllTasks()
    .filter(task => !task.optional)
    .reduce((sum, task) => sum + task.points, 0) + BONUS_POINTS;
}

/**
 * "Now" for the dragon clock; ?now=YYYY-MM-DD previews another day of the cohort
 */
function getNow() {
  const param = new URLSearchParams(location.search).get('now');
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const date = new Date(param + 'T12:00:00');
    if (!isNaN(date)) return date;
  }
  return new Date();
}

/**
 * Calculate dragon position (0–DRAGON_MAX%) with accelerating pace
 */
function getDragonPosition() {
  const now = getNow();
  const start = new Date(cohortData.startDate + 'T00:00:00');
  const end = new Date(cohortData.endDate + 'T23:59:59');
  if (now <= start) return 0;
  if (now >= end) return DRAGON_MAX;
  const elapsed = (now - start) / (end - start); // 0..1
  return Math.max(0, Math.pow(elapsed, DRAGON_EXPONENT) * DRAGON_MAX - 10);
}

/**
 * Calculate student position (0-100%)
 */
function getStudentPosition(studentId) {
  const points = getStudentPoints(studentId);
  const maxPoints = getMaxPoints();
  // Optional tasks add bonus points beyond maxPoints, so a completionist can exceed 100% — clamp to the finish line
  return Math.min(100, (points / maxPoints) * 100);
}

/**
 * Get student state based on ratio to dragon position
 */
function getStudentState(studentId) {
  // Check if student dropped out
  const student = cohortData.students.find(s => s.id === studentId);
  if (student && student.dropped) return 'dropped';

  const studentPos = getStudentPosition(studentId);
  const dragonPos = getDragonPosition();

  if (studentPos >= 100) return 'victory';
  if (dragonPos < 5) return 'fresh'; // course just started

  const ratio = studentPos / dragonPos;
  if (ratio >= 0.9) return 'fresh';    // 90%+ of dragon
  if (ratio >= 0.6) return 'stressed'; // 60-89% of dragon
  return 'bitten';                      // < 60% of dragon
}

/**
 * Render the progress bar
 */
function renderProgressBar() {
  const track = document.getElementById('progress-track');
  if (!track) return;
  if (hunter) hunter.stop();

  const dragonPos = getDragonPosition();
  const playIntro = !introPlayed && !REDUCED_MOTION;
  introPlayed = true;

  // Danger zone reaches the dragon's eye (--dragon-reach: css/dragon-rig.css)
  const dangerWidth = pos => `calc(${pos}% + var(--dragon-reach))`;
  const safeWidth = pos => `calc(90% - ${pos}% - var(--dragon-reach))`;

  let html = `
    <div class="danger-zone" style="width: ${dangerWidth(playIntro ? 0 : dragonPos)}"
         data-final-width="${dangerWidth(dragonPos)}"></div>
    <div class="safe-zone" style="width: ${safeWidth(playIntro ? 0 : dragonPos)}"
         data-final-width="${safeWidth(dragonPos)}"></div>
    <img class="safe-zone-gift" src="assets/gift_only.png" alt="Приз">
    <div class="zone-label danger">Danger Zone</div>
    <div class="zone-label safe">Safe Zone</div>
    <div class="week-markers">
      ${cohortData.weeks.map(w => `<div class="week-marker">Week ${w.week}</div>`).join('')}
    </div>
    <div class="finish-line"></div>
  `;

  // Sort students by points (descending) — leader on top, slowest near dragon
  const sortedStudents = [...cohortData.students].sort((a, b) =>
    getStudentPoints(b.id) - getStudentPoints(a.id)
  );

  // Find leader (most points)
  const leaderPoints = Math.max(...sortedStudents.map(s => getStudentPoints(s.id)));

  html += '<div class="student-lanes">';
  sortedStudents.forEach((student, i) => {
    const pos = getStudentPosition(student.id);
    const state = getStudentState(student.id);
    const avatarSrc = AVATAR_PATH + student.avatar;
    const points = getStudentPoints(student.id);
    const isLeader = points === leaderPoints && points > 0;

    const isDropped = state === 'dropped';
    const inDanger = !isDropped && (state === 'stressed' || state === 'bitten');
    // Dropped students and zero-length runs stay put: no transition, no transitionend
    const runs = playIntro && pos > 0 && !isDropped;
    html += `
      <div class="student-lane">
        <div class="student-marker state-${state} ${isLeader && !isDropped ? 'leader' : ''} ${runs ? 'running' : ''}"
             data-state="${state}" data-final-left="${pos}%" style="left: ${runs ? 0 : pos}%; --i: ${i}">
          <div class="avatar">
            <img src="${avatarSrc}" alt="${student.name}">
          </div>
          ${isDropped ? '' : `<div class="name">${student.name}</div>`}
          ${isDropped ? '<div class="skull">💀</div>' : ''}
          ${isLeader && !isDropped ? '<div class="crown">👑</div>' : ''}
          ${inDanger ? '<div class="panic">😱</div>' : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';

  // Living dragon: cutout rig (js/dragon.js)
  html += `
    <div class="dragon-lane">
      <div class="dragon" style="left: ${playIntro ? 0 : dragonPos}%" data-final-left="${dragonPos}%">
        ${DragonRig.buildRig()}
      </div>
    </div>
  `;

  track.innerHTML = html;
  if (playIntro) playIntroRun(track, dragonPos > 0);
  else startHunting(track);
}

/**
 * Intro replay: markers start at the line, then transition to data-final-* values
 */
function playIntroRun(track, dragonMoves) {
  const dragon = track.querySelector('.dragon');
  const rig = track.querySelector('.dragon-rig');
  track.style.setProperty('--intro-ms', INTRO_MS + 'ms');
  track.style.setProperty('--intro-stagger', INTRO_STAGGER_MS + 'ms');
  track.classList.add('intro');
  if (dragonMoves) rig.classList.add('is-walking');

  // Each runner stops hopping when its own run ends
  track.querySelectorAll('.student-marker.running').forEach(marker => {
    marker.addEventListener('transitionend', e => {
      if (e.target === marker && e.propertyName === 'left') marker.classList.remove('running');
    });
  });
  dragon.addEventListener('transitionend', e => {
    if (e.target === dragon && e.propertyName === 'left') rig.classList.remove('is-walking');
  });

  // Two frames: let the start positions paint before moving to the real ones
  requestAnimationFrame(() => requestAnimationFrame(() => {
    track.querySelectorAll('[data-final-left]').forEach(el => { el.style.left = el.dataset.finalLeft; });
    track.querySelectorAll('[data-final-width]').forEach(el => { el.style.width = el.dataset.finalWidth; });
  }));

  // Safety net for runs that never fire transitionend; the laser waits for the intro
  const total = INTRO_MS + cohortData.students.length * INTRO_STAGGER_MS + 100;
  setTimeout(() => {
    track.classList.remove('intro');
    rig.classList.remove('is-walking');
    track.querySelectorAll('.student-marker.running').forEach(m => m.classList.remove('running'));
    startHunting(track);
  }, total);
}

/**
 * Laser hunter (js/dragon.js); off when the viewer asked for less motion
 */
function startHunting(track) {
  if (REDUCED_MOTION) return;
  hunter = DragonRig.createHunter(track);
  hunter.start();
}

/**
 * Render the checkins table with new structure
 */
function renderCheckinsTable() {
  const table = document.getElementById('checkins-table');
  if (!table) return;

  const maxPoints = getMaxPoints();
  const studentCount = cohortData.students.length;

  let html = `
    <thead>
      <tr>
        <th class="task-col"></th>
        ${cohortData.students.map(s => `<th class="student-col ${s.dropped ? 'dropped' : ''}">${s.dropped ? '💀' : s.name}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
  `;

  cohortData.weeks.forEach(week => {
    // Week header
    html += `
      <tr class="week-header">
        <td colspan="${studentCount + 1}">НЕДЕЛЯ ${week.week}: ${week.title}</td>
      </tr>
    `;

    week.sections.forEach(section => {
      if (section.type === 'call') {
        // Call section - boxed header
        const dateStr = section.date ? ` (${section.date})` : '';
        html += `
          <tr class="call-header">
            <td class="call-title">${section.title}${dateStr}</td>
            ${cohortData.students.map(() => '<td></td>').join('')}
          </tr>
        `;

        // Call tasks (usually just attendance)
        section.tasks.forEach(task => {
          html += renderTaskRow(task);
        });
      } else if (section.type === 'homework') {
        // Homework section - indented
        html += `
          <tr class="homework-header">
            <td class="homework-title" colspan="${studentCount + 1}">${section.title}:</td>
          </tr>
        `;

        if (section.description && section.description.trim()) {
          html += `
            <tr class="homework-description">
              <td colspan="${studentCount + 1}">${renderRichText(section.description)}</td>
            </tr>
          `;
        }

        section.tasks.forEach(task => {
          html += renderTaskRow(task, true);
        });
      }
    });
  });

  // Totals row
  html += `
    <tr class="totals-row">
      <td><strong>ИТОГО</strong></td>
      ${cohortData.students.map(student => {
        const points = getStudentPoints(student.id);
        return `<td class="total-score">${points}/${maxPoints}</td>`;
      }).join('')}
    </tr>
  `;

  html += `</tbody>`;
  table.innerHTML = html;
}

/**
 * Render a single task row
 */
function renderTaskRow(task, indent = false) {
  let html = `<tr class="${indent ? 'homework-task' : 'call-task'}">`;
  const optBadge = task.optional
    ? ' <span class="opt-badge" title="Опционально — не входит в максимум баллов, но даёт бонусные очки">опционально</span>'
    : '';
  html += `<td class="task-name ${indent ? 'indented' : ''}">${task.title}${optBadge}</td>`;

  cohortData.students.forEach(student => {
    const checkins = cohortData.checkins[student.id] || [];
    const done = checkins.includes(task.id);
    html += `
      <td>
        <span class="check ${done ? 'done' : 'pending'}">${done ? '✓' : '○'}</span>
      </td>
    `;
  });

  html += `</tr>`;
  return html;
}

/**
 * Render entire dashboard
 */
function renderDashboard() {
  document.getElementById('cohort-name').textContent = cohortData.cohort;

  const start = new Date(cohortData.startDate).toLocaleDateString('ru-RU');
  const end = new Date(cohortData.endDate).toLocaleDateString('ru-RU');
  document.getElementById('cohort-dates').textContent = `${start} — ${end}`;

  renderProgressBar();
  renderCheckinsTable();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});
