import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import type { EnrichedMeeting } from "./enrichment";

dotenv.config();

const TOKEN_PATH = path.join(process.cwd(), "token.json");

function getAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2Client.setCredentials(token);
  return oauth2Client;
}

export async function attachDocToCalendarEvent(
  meeting: EnrichedMeeting,
  docUrl: string
): Promise<void> {
  if (!meeting.calendarEventId) {
    console.log("No calendar event ID — skipping calendar patch.");
    return;
  }

  const auth = getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  // find which calendar this event lives in
  const calendarId = "primary";

  // fetch the existing event so we don't overwrite other fields
  const existing = await calendar.events.get({
    calendarId,
    eventId: meeting.calendarEventId,
  });

  const currentDescription = existing.data.description || "";

  // build the addition — only add if not already there
  if (currentDescription.includes(docUrl)) {
    console.log("Doc link already attached to calendar event.");
    return;
  }

  const addition = [
    "",
    "─────────────────────────────",
    "📝 Meeting Notes",
    `Summary: ${meeting.summary}`,
    "",
    `Full notes: ${docUrl}`,
    "─────────────────────────────",
  ].join("\n");

  // patch the event description
  await calendar.events.patch({
    calendarId,
    eventId: meeting.calendarEventId,
    requestBody: {
      description: currentDescription + addition,
    },
  });

  console.log("Calendar event updated with doc link.");
}