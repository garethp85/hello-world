// Populates the database with sample data so you can see how the app looks.
// Usage: npm run seed   (refuses to run if the database already has engineers)
const { openDb } = require('./db');

const store = openDb();
if (store.state().engineers.length) {
  console.log('Database already has data; not seeding.');
  process.exit(0);
}

const skills = {
  Languages: ['TypeScript', 'Python', 'Go', 'Java'],
  Frontend: ['React', 'CSS / Design systems', 'Accessibility'],
  Backend: ['REST APIs', 'PostgreSQL', 'Kafka'],
  Infra: ['AWS', 'Kubernetes', 'Terraform', 'CI/CD'],
  Practices: ['Incident response', 'System design', 'Mentoring'],
};

const engineers = [
  ['Alex Morgan', 'Platform', 'Senior Engineer'],
  ['Priya Shah', 'Platform', 'Staff Engineer'],
  ['Sam Lee', 'Payments', 'Engineer'],
  ['Jordan Kim', 'Payments', 'Senior Engineer'],
  ['Taylor Brooks', 'Web', 'Engineer'],
  ['Chris Okafor', 'Web', 'Senior Engineer'],
  ['Robin Patel', 'Data', 'Engineer'],
  ['Casey Nguyen', 'Data', 'Engineering Manager'],
];

const skillIds = [];
for (const [category, names] of Object.entries(skills)) {
  for (const name of names) skillIds.push(store.addSkill({ name, category }));
}
const engineerIds = engineers.map(([name, team, role]) => store.addEngineer({ name, team, role }));

// Deterministic pseudo-random so the sample data is stable between runs
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

for (const e of engineerIds) {
  for (const s of skillIds) {
    const x = rand();
    const level = x < 0.35 ? 0 : x < 0.5 ? 1 : x < 0.65 ? 2 : x < 0.82 ? 3 : x < 0.94 ? 4 : 5;
    const wants_to_learn = level < 3 && rand() < 0.15;
    store.setRating(e, s, { level, wants_to_learn });
  }
}

console.log(`Seeded ${engineerIds.length} engineers and ${skillIds.length} skills.`);
