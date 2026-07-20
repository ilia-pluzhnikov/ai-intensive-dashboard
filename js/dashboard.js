/**
 * DRAGON CHASE - Dashboard Logic
 */

const DATA_URL = '/api/data';
const FALLBACK_URL = './data/cohort-1.json';

// Avatar path prefix
const AVATAR_PATH = './assets/avatars/';

// Dragon mechanics
const DRAGON_EXPONENT = 1.5;
const DRAGON_MAX = 90; // dragon reaches 90%, not 100% — rescue zone

// Dragon sprite animation (asymmetric: base 3s, laser 1s)
const DRAGON_SPRITE_BASE = './assets/Blood Dragon Sprite Base.png';
const DRAGON_SPRITE_LASER = './assets/Blood Dragon Sprite Attack.png';
const DRAGON_BASE_MS = 4000;
const DRAGON_LASER_MS = 2000;

// Bonus points for all students (hotfix)
const BONUS_POINTS = 10;

let cohortData = null;

/**
 * Load cohort data from API (with fallback to JSON file)
 */
async function loadData() {
  try {
    let response = await fetch(DATA_URL);
    if (!response.ok) {
      console.log('API not available, using fallback JSON');
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
 * Calculate dragon position (0–DRAGON_MAX%) with accelerating pace
 */
function getDragonPosition() {
  const now = new Date();
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

  track.innerHTML = '';

  // Dragon position
  const dragonPos = getDragonPosition();

  // Danger zone (red area behind dragon, +8% to reach dragon's head)
  const dangerWidth = Math.min(dragonPos + 8, 100);
  const safeWidth = Math.max(100 - dangerWidth - 10, 0);
  track.innerHTML += `
    <div class="danger-zone" style="width: ${dangerWidth}%"></div>
    <div class="safe-zone" style="width: ${safeWidth}%"></div>
    <img class="safe-zone-gift" src="assets/gift_only.png" alt="Приз">
    <div class="zone-label danger">Danger Zone</div>
    <div class="zone-label safe">Safe Zone</div>
  `;

  // Week markers
  track.innerHTML += `
    <div class="week-markers">
      ${cohortData.weeks.map(w => `<div class="week-marker">Week ${w.week}</div>`).join('')}
    </div>
  `;

  // Finish line
  track.innerHTML += `
    <div class="finish-line"></div>
  `;

  // Sort students by points (descending) — leader on top, slowest near dragon
  const sortedStudents = [...cohortData.students].sort((a, b) =>
    getStudentPoints(b.id) - getStudentPoints(a.id)
  );

  // Find leader (most points)
  const leaderPoints = Math.max(...sortedStudents.map(s => getStudentPoints(s.id)));

  // Student lanes
  let lanesHtml = '<div class="student-lanes">';
  sortedStudents.forEach((student) => {
    const pos = getStudentPosition(student.id);
    const state = getStudentState(student.id);
    const avatarSrc = AVATAR_PATH + student.avatar;
    const points = getStudentPoints(student.id);
    const isLeader = points === leaderPoints && points > 0;

    const isDropped = state === 'dropped';
    const inDanger = !isDropped && (state === 'stressed' || state === 'bitten');
    lanesHtml += `
      <div class="student-lane">
        <div class="student-marker state-${state} ${isLeader && !isDropped ? 'leader' : ''}" style="left: ${pos}%">
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
  lanesHtml += '</div>';
  track.innerHTML += lanesHtml;

  // Dragon with 2-frame sprite animation
  track.innerHTML += `
    <div class="dragon-lane">
      <div class="dragon" style="left: ${dragonPos}%">
        <img id="dragon-sprite" src="${DRAGON_SPRITE_BASE}" alt="Dragon">
      </div>
    </div>
  `;

  startDragonAnimation();
}

let dragonAnimTimer = null;
function startDragonAnimation() {
  if (dragonAnimTimer) clearTimeout(dragonAnimTimer);
  function showBase() {
    const img = document.getElementById('dragon-sprite');
    if (!img) return;
    img.src = DRAGON_SPRITE_BASE;
    dragonAnimTimer = setTimeout(showLaser, DRAGON_BASE_MS);
  }
  function showLaser() {
    const img = document.getElementById('dragon-sprite');
    if (!img) return;
    img.src = DRAGON_SPRITE_LASER;
    dragonAnimTimer = setTimeout(showBase, DRAGON_LASER_MS);
  }
  dragonAnimTimer = setTimeout(showLaser, DRAGON_BASE_MS);
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
