const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'clinic-control.db');

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('No se pudo abrir la base de datos:', err.message);
    process.exit(1);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      age TEXT,
      document TEXT,
      notes TEXT,
      createdAt TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      type TEXT,
      date TEXT,
      doctor TEXT,
      reason TEXT,
      notes TEXT,
      total REAL,
      paid REAL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('clinic', '{"clinicName":"Clinic Control","clinicAddress":"Dirección de la clínica","clinicPhone":"(000) 000-0000","clinicEmail":"admin@clinic.com"}')
  `);

  console.log('Base de datos lista en', dbPath);
});

function readSettings() {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM settings WHERE key = ?', ['clinic'], (err, row) => {
      if (err) return reject(err);
      resolve(row ? JSON.parse(row.value) : {});
    });
  });
}

function writeSettings(settings) {
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['clinic', JSON.stringify(settings)], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/data', async (req, res) => {
  try {
    const patients = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM patients ORDER BY createdAt DESC', [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    const visits = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM visits ORDER BY date DESC', [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    const settings = await readSettings();

    res.json({ patients, visits, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/patients', async (req, res) => {
  try {
    const patient = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO patients (id, name, phone, age, document, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [patient.id, patient.name, patient.phone, patient.age, patient.document, patient.notes, patient.createdAt],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/patients/:id', async (req, res) => {
  try {
    const patient = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE patients SET name = ?, phone = ?, age = ?, document = ?, notes = ?, createdAt = ? WHERE id = ?',
        [patient.name, patient.phone, patient.age, patient.document, patient.notes, patient.createdAt, req.params.id],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/patients/:id', async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM patients WHERE id = ?', [req.params.id], (err) => err ? reject(err) : resolve());
    });
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM visits WHERE patientId = ?', [req.params.id], (err) => err ? reject(err) : resolve());
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/visits', async (req, res) => {
  try {
    const visit = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO visits (id, patientId, type, date, doctor, reason, notes, total, paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [visit.id, visit.patientId, visit.type, visit.date, visit.doctor, visit.reason, visit.notes, visit.total, visit.paid],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/visits/:id', async (req, res) => {
  try {
    const visit = req.body;
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE visits SET patientId = ?, type = ?, date = ?, doctor = ?, reason = ?, notes = ?, total = ?, paid = ? WHERE id = ?',
        [visit.patientId, visit.type, visit.date, visit.doctor, visit.reason, visit.notes, visit.total, visit.paid, req.params.id],
        (err) => err ? reject(err) : resolve()
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/visits/:id', async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM visits WHERE id = ?', [req.params.id], (err) => err ? reject(err) : resolve());
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    await writeSettings(req.body);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port}`);
});
