const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database(":memory:", (openError) => {
  if (openError) throw openError;
  db.run("CREATE TABLE runtime_check (id INTEGER PRIMARY KEY, value TEXT)", (createError) => {
    if (createError) throw createError;
    db.run("INSERT INTO runtime_check (value) VALUES (?)", ["ok"], (insertError) => {
      if (insertError) throw insertError;
      db.get("SELECT value FROM runtime_check WHERE id = 1", (readError, row) => {
        if (readError) throw readError;
        if (row?.value !== "ok") throw new Error("SQLite did not return the expected value.");
        db.close((closeError) => {
          if (closeError) throw closeError;
          console.log("SQLite runtime check passed.");
        });
      });
    });
  });
});
