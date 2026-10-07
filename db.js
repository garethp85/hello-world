const { DatabaseSync } = require('node:sqlite');

function openDb(file = process.env.DB_FILE || 'skills.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS engineers (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      team  TEXT NOT NULL DEFAULT '',
      role  TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS skills (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      category  TEXT NOT NULL DEFAULT 'General'
    );

    -- level: 0 = none, 1 = aware, 2 = beginner, 3 = competent, 4 = proficient, 5 = expert
    CREATE TABLE IF NOT EXISTS ratings (
      engineer_id  INTEGER NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
      skill_id     INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      level        INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
      wants_to_learn INTEGER NOT NULL DEFAULT 0 CHECK (wants_to_learn IN (0, 1)),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (engineer_id, skill_id)
    );
  `);

  const q = {
    engineers: db.prepare('SELECT id, name, team, role FROM engineers ORDER BY name COLLATE NOCASE'),
    skills: db.prepare('SELECT id, name, category FROM skills ORDER BY category COLLATE NOCASE, name COLLATE NOCASE'),
    ratings: db.prepare('SELECT engineer_id, skill_id, level, wants_to_learn, updated_at FROM ratings'),
    addEngineer: db.prepare('INSERT INTO engineers (name, team, role) VALUES (?, ?, ?)'),
    updateEngineer: db.prepare('UPDATE engineers SET name = ?, team = ?, role = ? WHERE id = ?'),
    deleteEngineer: db.prepare('DELETE FROM engineers WHERE id = ?'),
    addSkill: db.prepare('INSERT INTO skills (name, category) VALUES (?, ?)'),
    updateSkill: db.prepare('UPDATE skills SET name = ?, category = ? WHERE id = ?'),
    deleteSkill: db.prepare('DELETE FROM skills WHERE id = ?'),
    upsertRating: db.prepare(`
      INSERT INTO ratings (engineer_id, skill_id, level, wants_to_learn, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT (engineer_id, skill_id)
      DO UPDATE SET level = excluded.level, wants_to_learn = excluded.wants_to_learn, updated_at = excluded.updated_at
    `),
    deleteRating: db.prepare('DELETE FROM ratings WHERE engineer_id = ? AND skill_id = ?'),
  };

  return {
    db,
    state() {
      return { engineers: q.engineers.all(), skills: q.skills.all(), ratings: q.ratings.all() };
    },
    addEngineer({ name, team = '', role = '' }) {
      return Number(q.addEngineer.run(name, team, role).lastInsertRowid);
    },
    updateEngineer(id, { name, team = '', role = '' }) {
      return q.updateEngineer.run(name, team, role, id).changes > 0;
    },
    deleteEngineer(id) {
      return q.deleteEngineer.run(id).changes > 0;
    },
    addSkill({ name, category = 'General' }) {
      return Number(q.addSkill.run(name, category || 'General').lastInsertRowid);
    },
    updateSkill(id, { name, category = 'General' }) {
      return q.updateSkill.run(name, category || 'General', id).changes > 0;
    },
    deleteSkill(id) {
      return q.deleteSkill.run(id).changes > 0;
    },
    setRating(engineerId, skillId, { level = 0, wants_to_learn = false }) {
      if (level === 0 && !wants_to_learn) {
        q.deleteRating.run(engineerId, skillId);
      } else {
        q.upsertRating.run(engineerId, skillId, level, wants_to_learn ? 1 : 0);
      }
    },
  };
}

module.exports = { openDb };
