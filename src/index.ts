import express from "express";
import bodyParser from "body-parser";
import moment from "moment";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

let windowStart: moment.Moment | null = null;
let windowEnd: moment.Moment | null = null;

// Initialize SQLite
let db: sqlite3.Database;
const initDb = async () => {
  db = (await open({
    filename: "./votes.db",
    driver: sqlite3.Database,
  })) as unknown as sqlite3.Database;

  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jersey TEXT,
    timestamp TEXT
  )`);
};

const API_KEY =
  "I6svucKvlzZaMD9oXVAhjcyU8KL063eQC7Z5HvCzaWGDWfpXv1g0S01bBhNc4VdXV0DjajAJxPgQsZvH1OwDVEP2fqR6nh7whVYn1LQepuh5yJyrg0OklrVNb3ClnnEg";

app.use("/sms", (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res
      .status(401)
      .type("text/xml")
      .send(`<Response><Message>Unauthorized</Message></Response>`);
  }
  next();
});

app.post("/sms", async (req, res) => {
  const msg = req.body.Body || "";
  const match = msg.match(/MVP:\s*#(\d+)/i);

  if (!match) {
    res.type("text/xml");
    return res.send(
      `<Response><Message>Invalid format. Use: MVP: #23</Message></Response>`,
    );
  }

  const jersey = `#${match[1]}`;
  const now = moment().toISOString();

  db.all(`SELECT * FROM votes ORDER BY id ASC`, [], (err, rows: any[]) => {
    if (rows.length < 2) {
      db.run(`INSERT INTO votes (jersey, timestamp) VALUES (?, ?)`, [
        jersey,
        now,
      ]);
      if (rows.length === 1) {
        windowStart = moment(now);
        windowEnd = moment(now).add(3, "hours");
      }
    } else {
      const nowMoment = moment(now);
      if (
        windowStart &&
        windowEnd &&
        nowMoment.isBetween(windowStart, windowEnd)
      ) {
        db.run(`INSERT INTO votes (jersey, timestamp) VALUES (?, ?)`, [
          jersey,
          now,
        ]);
      }
    }

    res.type("text/xml");
    res.send(
      `<Response><Message>Vote received for ${jersey}. Thanks!</Message></Response>`,
    );
  });
});

app.get("/mvp-results", (req, res) => {
  if (!windowStart || !windowEnd) {
    return res.json({ message: "Voting window not active yet." });
  }

  db.all(
    `SELECT jersey FROM votes WHERE timestamp BETWEEN ? AND ?`,
    [windowStart.toISOString(), windowEnd.toISOString()],
    (err, rows: any[]) => {
      const tally: Record<string, number> = {};

      for (const row of rows) {
        tally[row.jersey] = (tally[row.jersey] || 0) + 1;
      }

      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const results = {
        "3 Stars": sorted[0]?.[0] || "N/A",
        "2 Stars": sorted[1]?.[0] || "N/A",
        "1 Star": sorted[2]?.[0] || "N/A",
      };

      res.json(results);
    },
  );
});

app.get("/", (req, res) => {
  res.send("MVP Voting API (TS) is running.");
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
});
