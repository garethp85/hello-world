'use strict';

const LEVELS = ['None', 'Aware', 'Beginner', 'Competent', 'Proficient', 'Expert'];
const BUS_FACTOR_LEVEL = 3;

let state = { engineers: [], skills: [], ratings: [] };
let ratingIndex = new Map();
let coverageSort = { key: 'bus', dir: 1 };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const key = (e, s) => `${e}:${s}`;
const rating = (e, s) => ratingIndex.get(key(e, s)) || { level: 0, wants_to_learn: 0 };

// ---------- API ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refresh() {
  state = await api('GET', '/api/state');
  ratingIndex = new Map(state.ratings.map((r) => [key(r.engineer_id, r.skill_id), r]));
  render();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2500);
}

async function attempt(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Rendering ----------

function render() {
  renderFilters();
  renderMatrix();
  renderCoverage();
  renderManage();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(sel, values, allLabel) {
  const current = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('');
  sel.value = values.includes(current) ? current : '';
}

function renderFilters() {
  const teams = uniqueSorted(state.engineers.map((e) => e.team));
  const cats = uniqueSorted(state.skills.map((s) => s.category));
  fillSelect($('#team-filter'), teams, 'All teams');
  fillSelect($('#category-filter'), cats, 'All categories');
  $('#team-list').innerHTML = teams.map((t) => `<option value="${esc(t)}">`).join('');
  $('#category-list').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
  $('#legend').innerHTML = LEVELS.map((l, i) => `<span><i class="swatch l${i}"></i>${i} ${l}</span>`).join('')
    + '<span><b style="color:var(--star)">★</b> Wants to learn</span>';
}

function visibleData() {
  const q = $('#search').value.trim().toLowerCase();
  const team = $('#team-filter').value;
  const cat = $('#category-filter').value;
  const min = Number($('#min-level').value);

  let skills = state.skills.filter((s) => !cat || s.category === cat);
  const skillHits = q ? skills.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)) : [];
  if (skillHits.length) skills = skillHits;

  const engineers = state.engineers.filter((e) => {
    if (team && e.team !== team) return false;
    if (q && !skillHits.length && ![e.name, e.team, e.role].some((v) => v.toLowerCase().includes(q))) return false;
    if (min > 0 && !skills.some((s) => rating(e.id, s.id).level >= min)) return false;
    return true;
  });

  return { engineers, skills, min };
}

function renderMatrix() {
  const table = $('#matrix');
  const { engineers, skills, min } = visibleData();
  const empty = !state.engineers.length || !state.skills.length;
  $('#matrix-empty').hidden = !empty;
  table.parentElement.hidden = empty;
  if (empty) return;

  // Category header row: group consecutive skills by category
  const groups = [];
  for (const s of skills) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.category) last.count++;
    else groups.push({ name: s.category, count: 1 });
  }

  const head = `
    <thead>
      <tr class="cats"><th class="who"></th>${groups.map((g) => `<th colspan="${g.count}">${esc(g.name)}</th>`).join('')}</tr>
      <tr class="names"><th class="who">${engineers.length} engineer${engineers.length === 1 ? '' : 's'}</th>
        ${skills.map((s) => `<th class="skill" title="${esc(s.name)}"><div>${esc(s.name)}</div></th>`).join('')}
      </tr>
    </thead>`;

  const body = engineers.map((e) => `
    <tr>
      <th class="who">${esc(e.name)}<small>${esc([e.role, e.team].filter(Boolean).join(' · '))}</small></th>
      ${skills.map((s) => {
        const r = rating(e.id, s.id);
        const dim = min > 0 && r.level < min ? ' dim' : '';
        const title = `${e.name} — ${s.name}: ${LEVELS[r.level]}${r.wants_to_learn ? ' (wants to learn)' : ''}`;
        return `<td class="cell l${r.level}${dim}" data-e="${e.id}" data-s="${s.id}" title="${esc(title)}">${r.level || ''}${r.wants_to_learn ? '<span class="star">★</span>' : ''}</td>`;
      }).join('')}
    </tr>`).join('');

  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

function coverageRows() {
  return state.skills.map((s) => {
    const rated = state.engineers.map((e) => ({ e, r: rating(e.id, s.id) }));
    const capable = rated.filter((x) => x.r.level >= BUS_FACTOR_LEVEL).sort((a, b) => b.r.level - a.r.level);
    const withLevel = rated.filter((x) => x.r.level > 0);
    return {
      skill: s,
      bus: capable.length,
      experts: rated.filter((x) => x.r.level === 5).length,
      avg: withLevel.length ? withLevel.reduce((n, x) => n + x.r.level, 0) / withLevel.length : 0,
      learners: rated.filter((x) => x.r.wants_to_learn).map((x) => x.e.name),
      capable,
    };
  });
}

function renderCoverage() {
  const rows = coverageRows();
  const atRisk = rows.filter((r) => r.bus <= 1).length;
  const cells = state.engineers.length * state.skills.length;
  const filled = state.ratings.filter((r) => r.level > 0).length;

  $('#coverage-stats').innerHTML = [
    [state.engineers.length, 'Engineers'],
    [state.skills.length, 'Skills'],
    [atRisk, 'Skills with bus factor ≤ 1'],
    [cells ? `${Math.round((filled / cells) * 100)}%` : '—', 'Matrix filled in'],
  ].map(([v, l]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('');

  const { key: k, dir } = coverageSort;
  const sorters = {
    skill: (r) => r.skill.name.toLowerCase(),
    category: (r) => r.skill.category.toLowerCase(),
    bus: (r) => r.bus,
    experts: (r) => r.experts,
    avg: (r) => r.avg,
    learners: (r) => r.learners.length,
  };
  rows.sort((a, b) => {
    const x = sorters[k](a), y = sorters[k](b);
    return (x < y ? -1 : x > y ? 1 : a.skill.name.localeCompare(b.skill.name)) * dir;
  });

  const th = (id, label) => `<th data-sort="${id}">${label}${k === id ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  $('#coverage').innerHTML = `
    <thead><tr>${th('skill', 'Skill')}${th('category', 'Category')}${th('bus', 'Bus factor')}${th('experts', 'Experts')}${th('avg', 'Avg level')}${th('learners', 'Want to learn')}<th>Competent or above</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td>${esc(r.skill.name)}</td>
        <td>${esc(r.skill.category)}</td>
        <td class="num ${r.bus <= 1 ? 'risk' : ''}">${r.bus}</td>
        <td class="num">${r.experts}</td>
        <td class="num">${r.avg ? r.avg.toFixed(1) : '—'}</td>
        <td class="people" title="${esc(r.learners.join(', '))}">${r.learners.length || ''}</td>
        <td class="people">${r.capable.map((x) => `<b>${esc(x.e.name)}</b> ${x.r.level}`).join(', ') || '—'}</td>
      </tr>`).join('')}
    </tbody>`;
}

function renderManage() {
  $('#engineer-list').innerHTML = state.engineers.map((e) => `
    <li data-id="${e.id}">
      <span class="grow">${esc(e.name)} <span class="meta">${esc([e.role, e.team].filter(Boolean).join(' · '))}</span></span>
      <button data-act="edit-engineer">Edit</button>
      <button class="del" data-act="del-engineer">Delete</button>
    </li>`).join('') || '<li class="meta">No engineers yet.</li>';

  $('#skill-list').innerHTML = state.skills.map((s) => `
    <li data-id="${s.id}">
      <span class="grow">${esc(s.name)} <span class="meta">${esc(s.category)}</span></span>
      <button data-act="edit-skill">Edit</button>
      <button class="del" data-act="del-skill">Delete</button>
    </li>`).join('') || '<li class="meta">No skills yet.</li>';
}

// ---------- Level picker ----------

function closePicker() {
  $('#picker').hidden = true;
}

function openPicker(cell) {
  const e = Number(cell.dataset.e), s = Number(cell.dataset.s);
  const r = rating(e, s);
  const picker = $('#picker');
  picker.innerHTML = LEVELS.map((l, i) =>
    `<button data-level="${i}" class="${r.level === i ? 'current' : ''}"><i class="swatch l${i}"></i>${i} — ${l}</button>`
  ).join('') + `<hr><button data-toggle-learn>${r.wants_to_learn ? '☆ Clear “wants to learn”' : '★ Wants to learn'}</button>`;
  picker.dataset.e = e;
  picker.dataset.s = s;

  const rect = cell.getBoundingClientRect();
  picker.hidden = false;
  const left = Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - picker.offsetWidth - 8);
  picker.style.left = `${Math.max(8, left)}px`;
  picker.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

function saveRating(e, s, changes) {
  const r = { ...rating(e, s), ...changes };
  return attempt(async () => {
    await api('PUT', `/api/ratings/${e}/${s}`, { level: r.level, wants_to_learn: Boolean(r.wants_to_learn) });
    await refresh();
  });
}

// ---------- Inline editing in Manage ----------

function startEdit(li, kind) {
  const id = Number(li.dataset.id);
  const item = (kind === 'engineer' ? state.engineers : state.skills).find((x) => x.id === id);
  const fields = kind === 'engineer' ? ['name', 'team', 'role'] : ['name', 'category'];
  li.innerHTML = `<form class="row-form grow" style="margin:0">
      ${fields.map((f) => `<input name="${f}" value="${esc(item[f])}" placeholder="${f}" maxlength="100" ${f === 'name' ? 'required' : ''}>`).join('')}
      <button type="submit">Save</button><button type="button" data-act="cancel">Cancel</button>
    </form>`;
  const form = li.querySelector('form');
  form.querySelector('input').focus();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    attempt(async () => {
      await api('PUT', `/api/${kind}s/${id}`, body);
      await refresh();
    });
  });
}

// ---------- Events ----------

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${btn.dataset.view}`; });
    closePicker();
    try { localStorage.setItem('skills-tab', btn.dataset.view); } catch { /* storage unavailable */ }
  });
});

['#search', '#team-filter', '#category-filter', '#min-level'].forEach((sel) =>
  $(sel).addEventListener('input', renderMatrix));

$('#matrix').addEventListener('click', (ev) => {
  const cell = ev.target.closest('td.cell');
  if (!cell) return;
  ev.stopPropagation();
  const e = Number(cell.dataset.e), s = Number(cell.dataset.s);
  if (ev.shiftKey) {
    saveRating(e, s, { wants_to_learn: !rating(e, s).wants_to_learn });
  } else {
    openPicker(cell);
  }
});

$('#picker').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const picker = $('#picker');
  const e = Number(picker.dataset.e), s = Number(picker.dataset.s);
  closePicker();
  if (btn.dataset.level !== undefined) saveRating(e, s, { level: Number(btn.dataset.level) });
  else saveRating(e, s, { wants_to_learn: !rating(e, s).wants_to_learn });
});

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#picker')) closePicker();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closePicker();
});

$('#coverage').addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-sort]');
  if (!th) return;
  const k = th.dataset.sort;
  coverageSort = { key: k, dir: coverageSort.key === k ? -coverageSort.dir : 1 };
  renderCoverage();
});

function bindAddForm(sel, url) {
  const form = $(sel);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    attempt(async () => {
      await api('POST', url, body);
      form.reset();
      form.querySelector('input').focus();
      await refresh();
    });
  });
}
bindAddForm('#engineer-form', '/api/engineers');
bindAddForm('#skill-form', '/api/skills');

function bindList(sel, kind) {
  $(sel).addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const li = btn.closest('li');
    const id = Number(li.dataset.id);
    const act = btn.dataset.act;
    if (act === `edit-${kind}`) startEdit(li, kind);
    else if (act === 'cancel') renderManage();
    else if (act === `del-${kind}`) {
      const item = (kind === 'engineer' ? state.engineers : state.skills).find((x) => x.id === id);
      if (!confirm(`Delete ${item.name}? Their ratings will be removed too.`)) return;
      attempt(async () => {
        await api('DELETE', `/api/${kind}s/${id}`);
        await refresh();
      });
    }
  });
}
bindList('#engineer-list', 'engineer');
bindList('#skill-list', 'skill');

// Restore last tab
try {
  const tab = localStorage.getItem('skills-tab');
  if (tab) document.querySelector(`.tabs button[data-view="${tab}"]`)?.click();
} catch { /* storage unavailable */ }

attempt(refresh);
