import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import type { EnrichedMeeting } from "./enrichment";

dotenv.config();

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const SHEET_NAME = "RIA Meeting Action Items";
const SHEET_ID_FILE = path.join(process.cwd(), "sheet-id.txt");

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

function getSavedSheetId(): string | null {
  if (fs.existsSync(SHEET_ID_FILE)) {
    return fs.readFileSync(SHEET_ID_FILE, "utf-8").trim();
  }
  return null;
}

function saveSheetId(id: string) {
  fs.writeFileSync(SHEET_ID_FILE, id);
}

async function getOrCreateSheet(sheets: any, drive: any): Promise<string> {
  const savedId = getSavedSheetId();
  if (savedId) return savedId;

  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SHEET_NAME },
    },
  });

  const sheetId = createRes.data.spreadsheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Sheet1!A1:J1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        "Date",
        "Meeting",
        "Meeting Type",
        "Task",
        "Owner",
        "Deadline",
        "Confidence",
        "Confidence Reason",
        "Status",
        "Doc Link",
      ]],
    },
  });

  await drive.permissions.create({
    fileId: sheetId,
    requestBody: {
      role: "writer",
      type: "domain",
      domain: "ria.insure",
    },
  });

  saveSheetId(sheetId);
  console.log(
    `   Created tracker: https://docs.google.com/spreadsheets/d/${sheetId}`
  );
  return sheetId;
}

export async function appendActionItems(
  meeting: EnrichedMeeting,
  docUrl: string
): Promise<void> {
  if (!meeting.actionItems || meeting.actionItems.length === 0) {
    console.log("   No action items to track.");
    return;
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  const sheetId = await getOrCreateSheet(sheets, drive);

  const date = new Date(meeting.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const rows = meeting.actionItems.map((item) => [
    date,
    meeting.title,
    meeting.meetingType,
    item.task,
    item.owner || "unassigned",
    item.deadline || "--",
    item.confidence || "medium",
    item.confidence_reason || "--",
    "Pending",
    docUrl,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Sheet1!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  console.log(`   Added ${rows.length} action item(s) to tracker.`);
  console.log(
    `   Sheet: https://docs.google.com/spreadsheets/d/${sheetId}`
  );
}

export async function getRecentActionItems(
  sheets: any,
  sheetId: string,
  limit: number = 10
): Promise<string> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!A:J",
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "";

    const dataRows = rows.slice(1).slice(-limit);
    const pending = dataRows.filter((row: string[]) => row[8] === "Pending");

    if (pending.length === 0) return "";

    return pending
      .map(
        (row: string[]) =>
          `- ${row[3]} (Owner: ${row[4]}, Deadline: ${row[5]}, From: ${row[1]})`
      )
      .join("\n");
  } catch {
    return "";
  }
}