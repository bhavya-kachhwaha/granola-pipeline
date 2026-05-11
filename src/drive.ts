import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import type { EnrichedMeeting } from "./enrichment";

dotenv.config();

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const COMPANY_DOMAIN = "ria.insure";
const ROOT_FOLDER_NAME = "Meeting Notes";

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

// find a folder by name inside a parent, or create it if it doesn't exist
async function findOrCreateFolder(
  drive: any,
  name: string,
  parentId?: string
): Promise<string> {
  const query = [
    `name = '${name}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    parentId ? `'${parentId}' in parents` : "",
  ]
    .filter(Boolean)
    .join(" and ");

  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // folder doesn't exist, create it
  const createRes = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [],
    },
    fields: "id",
  });

  // share the folder with @ria.insure
  await drive.permissions.create({
    fileId: createRes.data.id,
    requestBody: {
      role: "reader",
      type: "domain",
      domain: COMPANY_DOMAIN,
    },
  });

  console.log(`   Created folder: ${name}`);
  return createRes.data.id;
}

// get the month folder name from a date e.g. "2026-05"
function getMonthFolder(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// get or create the full folder path: Meeting Notes > 2026-05
async function getTargetFolder(drive: any, meeting: EnrichedMeeting): Promise<string> {
  // root folder
  const rootId = await findOrCreateFolder(drive, ROOT_FOLDER_NAME);

  // month subfolder
  const monthName = getMonthFolder(meeting.createdAt);
  const monthId = await findOrCreateFolder(drive, monthName, rootId);

  return monthId;
}

interface TextSegment {
  text: string;
  type: "heading" | "bullet" | "subbullet" | "normal";
}

function parseNotes(raw: string): TextSegment[] {
  const lines = raw.split("\n");
  const segments: TextSegment[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      segments.push({ type: "heading", text: line.replace("## ", "").trim() });
    } else if (line.match(/^  - /)) {
      segments.push({ type: "subbullet", text: line.replace(/^  - /, "").trim() });
    } else if (line.startsWith("- ")) {
      segments.push({ type: "bullet", text: line.replace("- ", "").trim() });
    } else if (line.trim().length > 0) {
      segments.push({ type: "normal", text: line.trim() });
    }
  }
  return segments;
}

export async function createMeetingDoc(
  meeting: EnrichedMeeting,
  structuredNotes: string
): Promise<string> {
  const auth = getAuthClient();
  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  // step 1 -- get the target folder
  console.log("   Finding/creating folder structure...");
  const folderId = await getTargetFolder(drive, meeting);

  // step 2 -- create doc inside that folder
  const createResponse = await docs.documents.create({
    requestBody: {
      title: `Meeting Notes: ${meeting.title} -- ${new Date(
        meeting.createdAt
      ).toLocaleDateString("en-IN")}`,
    },
  });

  const docId = createResponse.data.documentId!;

  // step 3 -- move doc into the folder
  const existingParents = createResponse.data.revisionId;
  await drive.files.update({
    fileId: docId,
    addParents: folderId,
    removeParents: "root",
    fields: "id, parents",
  });

  // step 4 -- build and insert content
  const requests: any[] = [];
  const segments = parseNotes(structuredNotes);

  const titleLine = `${meeting.title}\n`;
  const dateLine = `${new Date(meeting.createdAt).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })} · ${meeting.meetingType}\n`;
  const attendeeLine =
    meeting.attendees.length > 0
      ? `Attendees: ${meeting.attendees.join(", ")}\n`
      : null;
  const blankLine = "\n";
  const summaryHeading = "Summary\n";
  const summaryText = `${meeting.summary}\n`;
  const transcriptHeading = "Full Transcript\n";
  const transcriptText = `${meeting.rawTranscript || ""}\n`;

  const allLines: string[] = [];
  allLines.push(titleLine);
  allLines.push(dateLine);
  if (attendeeLine) allLines.push(attendeeLine);
  allLines.push(blankLine);
  allLines.push(summaryHeading);
  allLines.push(summaryText);
  allLines.push(blankLine);
  for (const seg of segments) {
    allLines.push(seg.text + "\n");
  }
  allLines.push(blankLine);
  allLines.push(transcriptHeading);
  allLines.push(transcriptText);

  const fullText = allLines.join("");

  requests.push({
    insertText: { location: { index: 1 }, text: fullText },
  });

  let index = 1;

  requests.push({
    updateParagraphStyle: {
      range: { startIndex: index, endIndex: index + titleLine.length },
      paragraphStyle: { namedStyleType: "HEADING_1" },
      fields: "namedStyleType",
    },
  });
  index += titleLine.length;
  index += dateLine.length;
  if (attendeeLine) index += attendeeLine.length;
  index += blankLine.length;

  requests.push({
    updateParagraphStyle: {
      range: { startIndex: index, endIndex: index + summaryHeading.length },
      paragraphStyle: { namedStyleType: "HEADING_2" },
      fields: "namedStyleType",
    },
  });
  index += summaryHeading.length;
  index += summaryText.length;
  index += blankLine.length;

  for (const seg of segments) {
    const lineLen = seg.text.length + 1;

    if (seg.type === "heading") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + lineLen },
          paragraphStyle: { namedStyleType: "HEADING_2" },
          fields: "namedStyleType",
        },
      });
    } else if (seg.type === "bullet") {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: index, endIndex: index + lineLen },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    } else if (seg.type === "subbullet") {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: index, endIndex: index + lineLen },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + lineLen },
          paragraphStyle: {
            indentStart: { magnitude: 36, unit: "PT" },
            indentFirstLine: { magnitude: 36, unit: "PT" },
          },
          fields: "indentStart,indentFirstLine",
        },
      });
    }

    index += lineLen;
  }

  index += blankLine.length;

  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: index,
        endIndex: index + transcriptHeading.length,
      },
      paragraphStyle: { namedStyleType: "HEADING_2" },
      fields: "namedStyleType",
    },
  });

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  // step 5 -- share with @ria.insure
  await drive.permissions.create({
    fileId: docId,
    requestBody: {
      role: "reader",
      type: "domain",
      domain: COMPANY_DOMAIN,
    },
  });

  console.log(`   Doc shared with @${COMPANY_DOMAIN}`);

  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  console.log(`   Doc created: ${docUrl}`);
  return docUrl;
}