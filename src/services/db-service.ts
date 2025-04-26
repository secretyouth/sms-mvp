import sqlite3 from "sqlite3";
import moment from "moment";

// Interface for poll state
interface PollState {
  is_open: boolean;
  start_time: string | null;
}

// Interface for vote results
interface VoteResult {
  jersey_number: number;
  points: number;
}

// Interface for vote record
interface VoteRecord {
  phone_number: string;
  jersey_number: number;
  points: number;
}

export class DbService {
  private db: sqlite3.Database;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error opening database:", err.message);
      } else {
        console.log("Connected to SQLite database.");
      }
    });

    // Initialize tables
    this.initializeTables();
  }

  private initializeTables() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS poll_state (
          id INTEGER PRIMARY KEY,
          is_open BOOLEAN NOT NULL,
          start_time TEXT
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT NOT NULL,
          poll_start_time TEXT NOT NULL,
          jersey_number INTEGER NOT NULL,
          points INTEGER NOT NULL,
          UNIQUE(phone_number, poll_start_time, jersey_number)
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS poll_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          phone_number TEXT NOT NULL,
          jersey_number INTEGER NOT NULL,
          points INTEGER NOT NULL
        )
      `);
    });
  }

  // Get poll state
  async getPollState(): Promise<PollState> {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT * FROM poll_state WHERE id = 1", (err, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || { is_open: false, start_time: null });
        }
      });
    });
  }

  // Open poll
  async openPoll(): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = moment().toISOString();
      this.db.run(
        `INSERT OR REPLACE INTO poll_state (id, is_open, start_time) VALUES (1, ?, ?)`,
        [true, startTime],
        (err) => {
          if (err) {
            reject(err);
          } else {
            // Clear current votes
            this.db.run("DELETE FROM votes", (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
        },
      );
    });
  }

  // Close poll and save to history
  async closePoll(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT phone_number, jersey_number, points, poll_start_time FROM votes",
        (err, votes) => {
          if (err) {
            reject(err);
            return;
          }

          const timestamp = moment().toISOString();
          const inserts = votes.map(
            (vote: any) =>
              new Promise<void>((res, rej) => {
                this.db.run(
                  `INSERT INTO poll_history (timestamp, phone_number, jersey_number, points) VALUES (?, ?, ?, ?)`,
                  [
                    timestamp,
                    vote.phone_number,
                    vote.jersey_number,
                    vote.points,
                  ],
                  (err) => {
                    if (err) rej(err);
                    else res();
                  },
                );
              }),
          );

          Promise.all(inserts)
            .then(() => {
              // Update poll state and clear votes
              this.db.run(
                `UPDATE poll_state SET is_open = ? WHERE id = 1`,
                [false],
                (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    this.db.run("DELETE FROM votes", (err) => {
                      if (err) reject(err);
                      else resolve();
                    });
                  }
                },
              );
            })
            .catch(reject);
        },
      );
    });
  }

  // Record votes (update if exists)
  async recordVotes(
    phoneNumber: string,
    pollStartTime: string,
    votes: [number, number][],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Delete existing votes for this phone number in the current poll
      this.db.run(
        `DELETE FROM votes WHERE phone_number = ? AND poll_start_time = ?`,
        [phoneNumber, pollStartTime],
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Insert new votes
          const insertPromises = votes.map(
            ([jersey, points]) =>
              new Promise<void>((res, rej) => {
                this.db.run(
                  `INSERT INTO votes (phone_number, poll_start_time, jersey_number, points) VALUES (?, ?, ?, ?)`,
                  [phoneNumber, pollStartTime, jersey, points],
                  (err) => {
                    if (err) rej(err);
                    else res();
                  },
                );
              }),
          );

          Promise.all(insertPromises)
            .then(() => resolve())
            .catch(reject);
        },
      );
    });
  }

  // Get current poll results (top 5)
  async getCurrentResults(pollStartTime: string): Promise<VoteResult[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT jersey_number, SUM(points) as points
         FROM votes
         WHERE poll_start_time = ?
         GROUP BY jersey_number
         ORDER BY points DESC
         LIMIT 5`,
        [pollStartTime],
        (err, rows: VoteResult[]) => {
          if (err) reject(err);
          else resolve(rows);
        },
      );
    });
  }

  // Get latest closed poll results (top 3)
  async getLatestClosedResults(): Promise<VoteResult[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT jersey_number, SUM(points) as points
         FROM poll_history
         WHERE timestamp = (SELECT MAX(timestamp) FROM poll_history)
         GROUP BY jersey_number
         ORDER BY points DESC
         LIMIT 3`,
        (err, rows: VoteResult[]) => {
          if (err) reject(err);
          else resolve(rows);
        },
      );
    });
  }

  // Close database connection
  close(): void {
    this.db.close((err) => {
      if (err) {
        console.error("Error closing database:", err.message);
      } else {
        console.log("Database connection closed.");
      }
    });
  }
}
