import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import moment from "moment";
import { DbService } from "./services/db-service"; // Adjust path as needed

const app = express();
const port = 3000;

// Initialize database service
const dbService = new DbService(process.env.DB_PATH || "./poll.db");

app.use(bodyParser.urlencoded({ extended: false }));

// Helper function to clean and parse incoming votes
function parseVotes(body: string): number[] {
  return body
    .replace(/[\n\r]+/g, " ")
    .split(/[\s,]+/)
    .map((vote) => parseInt(vote.trim()))
    .filter((vote) => !isNaN(vote));
}

// Route to handle incoming SMS
app.post("/sms", async (req: Request, res: Response) => {
  const { Body: body, From: from } = req.body; // Twilio uses 'From' and 'Body'
  console.log("🚀 ~ app.post ~ body:", body, "from:", from);

  if (!from) {
    return res.status(400).send("Missing 'From' phone number.");
  }

  try {
    // Get poll state
    const pollState = await dbService.getPollState();
    const pollOpen = pollState.is_open;
    const pollStartTime = pollState.start_time
      ? moment(pollState.start_time)
      : null;

    // Handle "open" command
    if (body.trim().toLowerCase() === "open") {
      if (pollOpen) {
        return res.status(400).send("Poll is already open.");
      }
      await dbService.openPoll();
      console.log("Poll opened");
      return res.set("Content-Type", "text/xml").send(`
        <Response>
          <Message>Poll has been opened! Vote now!</Message>
        </Response>
      `);
    }

    // Handle "close" command
    if (body.trim().toLowerCase() === "close") {
      if (!pollOpen) {
        return res.status(400).send("No active poll to close.");
      }
      await dbService.closePoll();
      console.log("Poll closed");
      return res.set("Content-Type", "text/xml").send(`
        <Response>
          <Message>Poll has been closed. Thank you for participating!</Message>
        </Response>
      `);
    }

    // Handle "results" command
    if (body.trim().toLowerCase() === "results") {
      if (pollOpen && pollStartTime) {
        // Get current poll results
        const results = await dbService.getCurrentResults(
          pollState.start_time!,
        );
        let message = "Current Poll Results:\n";
        results.forEach((row, index) => {
          message += `${index + 1}. Jersey Number: ${
            row.jersey_number
          }, Points: ${row.points}\n`;
        });
        return res.set("Content-Type", "text/xml").send(`
          <Response>
            <Message>${message}</Message>
          </Response>
        `);
      }

      // Get latest closed poll results
      const results = await dbService.getLatestClosedResults();
      if (results.length === 0) {
        return res.status(400).send("No polls have been closed yet.");
      }
      let message = "Latest Closed Poll Results:\n";
      results.forEach((row, index) => {
        message += `${index + 1}. Jersey Number: ${
          row.jersey_number
        }, Points: ${row.points}\n`;
      });
      return res.set("Content-Type", "text/xml").send(`
        <Response>
          <Message>${message}</Message>
        </Response>
      `);
    }

    // Check if poll is closed or expired
    if (
      !pollOpen ||
      !pollStartTime ||
      moment().isAfter(pollStartTime.add(24, "hours"))
    ) {
      return res.status(400).send("The poll is closed or expired.");
    }

    // Parse and record votes
    const votes = parseVotes(body);
    if (votes.length === 0 || votes.length > 3) {
      return res
        .status(400)
        .send("Invalid vote format. Please send 1 to 3 jersey numbers.");
    }

    const voteInserts: [number, number][] = [];
    if (votes[0]) voteInserts.push([votes[0], 3]);
    if (votes[1]) voteInserts.push([votes[1], 2]);
    if (votes[2]) voteInserts.push([votes[2], 1]);

    await dbService.recordVotes(from, pollState.start_time!, voteInserts);
    console.log(
      `Vote received from ${from}: ${votes[0]} (3 points), ${votes[1]} (2 points), ${votes[2]} (1 point)`,
    );

    return res.set("Content-Type", "text/xml").send(`
      <Response>
        <Message>Thank you for your vote! Your vote has been recorded.</Message>
      </Response>
    `);
  } catch (err) {
    console.error("Error processing SMS:", err);
    return res.status(500).send("Server error.");
  }
});

// Route to get the latest poll results
app.get("/poll-results", async (req: Request, res: Response) => {
  try {
    const results = await dbService.getLatestClosedResults();
    if (results.length === 0) {
      return res.status(400).send("No closed polls available.");
    }
    let message = "Latest Poll Results:\n";
    results.forEach((row, index) => {
      message += `${index + 1}. Jersey Number: ${row.jersey_number}, Points: ${
        row.points
      }\n`;
    });
    res.send(message);
  } catch (err) {
    console.error("Error fetching poll results:", err);
    res.status(500).send("Server error.");
  }
});

// Close database on process exit
process.on("SIGINT", () => {
  dbService.close();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
