/**
 * DRAGON CHASE - Admin Panel Logic
 */

const DATA_URL = '/api/data';
const SAVE_URL = '/api/save';
const FALLBACK_URL = './data/cohort-1.json';

let cohortData = null;
let hasChanges = false;

/**
 * Load cohort data from API (with fallback to JSON file)
 */
async function loadData() {
  try {
    let response = await fetch(DATA_URL);
    if (!response.ok) {
      console.log('API not available, using fallback JSON');
      response = await fetch(FALLBACK_URL + '?t=' + Date.now());
    }
    cohortData = await response.json();
    renderAdmin();
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
 * Open inline textarea to edit a homework section's description.
 * weekIdx / sectionIdx address the section in cohortData.weeks[].sections[].
 */
function editDescription(weekIdx, sectionIdx) {
  const section = cohortData.weeks[weekIdx].sections[sectionIdx];
  const td = document.querySelector(
    `tr.homework-description[data-week="${weekIdx}"][data-section="${sectionIdx}"] td`
  );
  if (!td) return;

  const current = section.description || '';
  td.innerHTML = `<textarea class="description-edit" rows="5" placeholder="Опиши задание: что сделать, ссылки, дедлайн. Поддерживается **жирный**, переносы строк и https-ссылки.">${escapeHtml(current)}</textarea>`;
  const textarea = td.querySelector('textarea');
  // Prevent bubbling to <td onclick=editDescription>, which would rebuild the textarea and wipe input
  textarea.addEventListener('click', (e) => e.stopPropagation());
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  let committed = false;
  const commit = (save) => {
    if (committed) return;
    committed = true;
    if (save) {
      const next = textarea.value;
      if (next !== current) {
        section.description = next;
        hasChanges = true;
        updateSaveButton();
      }
    }
    renderTable();
  };

  textarea.addEventListener('blur', () => commit(true));
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      commit(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      textarea.blur();
    }
  });
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
  return allTasks
    .filter(task => checkins.includes(task.id))
    .reduce((sum, task) => sum + task.points, 0);
}

/**
 * Get max possible points
 */
function getMaxPoints() {
  return getAllTasks().reduce((sum, task) => sum + task.points, 0);
}

/**
 * Toggle a checkin
 */
function toggleCheckin(studentId, taskId) {
  if (!cohortData.checkins[studentId]) {
    cohortData.checkins[studentId] = [];
  }

  const checkins = cohortData.checkins[studentId];
  const index = checkins.indexOf(taskId);

  if (index === -1) {
    checkins.push(taskId);
  } else {
    checkins.splice(index, 1);
  }

  hasChanges = true;
  updateSaveButton();
  renderTable();
}

/**
 * Update save button state
 */
function updateSaveButton() {
  const btn = document.getElementById('save-btn');
  if (hasChanges) {
    btn.textContent = '💾 СОХРАНИТЬ *';
    btn.classList.add('btn-primary');
  } else {
    btn.textContent = '💾 СОХРАНИТЬ';
    btn.classList.remove('btn-primary');
  }
}

/**
 * Save data - sends to API
 */
async function saveData() {
  const btn = document.getElementById('save-btn');
  btn.textContent = '⏳ СОХРАНЯЮ...';
  btn.disabled = true;

  try {
    const response = await fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cohortData)
    });

    if (!response.ok) {
      throw new Error('Failed to save');
    }

    hasChanges = false;
    updateSaveButton();
    showNotification('Данные сохранены!');
  } catch (error) {
    console.error('Save failed:', error);
    showNotification('Ошибка сохранения! Попробуйте ещё раз.');
  } finally {
    btn.disabled = false;
  }
}

/**
 * Show notification
 */
function showNotification(message) {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = message;
  document.body.appendChild(notif);

  setTimeout(() => notif.remove(), 5000);
}

/**
 * Render a single task row
 */
function renderTaskRow(task, indent = false) {
  let html = `<tr class="${indent ? 'homework-task' : 'call-task'}">`;
  html += `<td class="task-name ${indent ? 'indented' : ''}">${task.title} <span style="color: var(--text-dim)">(+${task.points})</span></td>`;

  cohortData.students.forEach(student => {
    const checkins = cohortData.checkins[student.id] || [];
    const done = checkins.includes(task.id);
    html += `
      <td class="clickable" onclick="toggleCheckin('${student.id}', '${task.id}')">
        <span class="check ${done ? 'done' : 'pending'}">${done ? '✓' : '○'}</span>
      </td>
    `;
  });

  html += `</tr>`;
  return html;
}

/**
 * Render the checkins table with clickable cells
 */
function renderTable() {
  const table = document.getElementById('checkins-table');
  if (!table) return;

  const maxPoints = getMaxPoints();
  const studentCount = cohortData.students.length;

  let html = `
    <thead>
      <tr>
        <th class="task-col"></th>
        ${cohortData.students.map(s => `<th class="student-col">${s.name}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
  `;

  cohortData.weeks.forEach((week, weekIdx) => {
    // Week header
    html += `
      <tr class="week-header">
        <td colspan="${studentCount + 1}">НЕДЕЛЯ ${week.week}: ${week.title}</td>
      </tr>
    `;

    week.sections.forEach((section, sectionIdx) => {
      if (section.type === 'call') {
        const dateStr = section.date ? ` (${section.date})` : '';
        html += `
          <tr class="call-header">
            <td class="call-title">${section.title}${dateStr}</td>
            ${cohortData.students.map(() => '<td></td>').join('')}
          </tr>
        `;

        section.tasks.forEach(task => {
          html += renderTaskRow(task);
        });
      } else if (section.type === 'homework') {
        html += `
          <tr class="homework-header">
            <td class="homework-title" colspan="${studentCount + 1}">${section.title}:</td>
          </tr>
        `;

        const hasDesc = section.description && section.description.trim();
        const descBody = hasDesc
          ? renderRichText(section.description)
          : '<span class="placeholder">+ добавить описание</span>';
        html += `
          <tr class="homework-description editable" data-week="${weekIdx}" data-section="${sectionIdx}">
            <td colspan="${studentCount + 1}" onclick="editDescription(${weekIdx}, ${sectionIdx})">
              ${descBody}
            </td>
          </tr>
        `;

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
 * Render entire admin panel
 */
function renderAdmin() {
  document.getElementById('cohort-name').textContent = cohortData.cohort;

  const start = new Date(cohortData.startDate).toLocaleDateString('ru-RU');
  const end = new Date(cohortData.endDate).toLocaleDateString('ru-RU');
  document.getElementById('cohort-dates').textContent = `${start} — ${end}`;

  renderTable();
}

// Warn on unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', loadData);
