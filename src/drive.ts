import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import type { EnrichedMeeting } from "./enrichment";

dotenv.config();

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const COMPANY_DOMAIN = "ria.insure";

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

  // step 1 — create empty doc
  const createResponse = await docs.documents.create({
    requestBody: {
      title: `Meeting Notes: ${meeting.title} — ${new Date(
        meeting.createdAt
      ).toLocaleDateString("en-IN")}`,
    },
  });

  const docId = createResponse.data.documentId!;
  const requests: any[] = [];
  const segments = parseNotes(structuredNotes);

  // build all lines
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

  // insert all text in one request
  requests.push({
    insertText: { location: { index: 1 }, text: fullText },
  });

  // track index and apply formatting
  let index = 1;

  // title → Heading 1
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: index, endIndex: index + titleLine.length },
      paragraphStyle: { namedStyleType: "HEADING_1" },
      fields: "namedStyleType",
    },
  });
  index += titleLine.length;

  // date line — advance only
  index += dateLine.length;

  // attendee line — advance only
  if (attendeeLine) index += attendeeLine.length;

  // blank line
  index += blankLine.length;

  // summary heading → Heading 2
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: index, endIndex: index + summaryHeading.length },
      paragraphStyle: { namedStyleType: "HEADING_2" },
      fields: "namedStyleType",
    },
  });
  index += summaryHeading.length;

  // summary text — advance only
  index += summaryText.length;

  // blank line
  index += blankLine.length;

  // format each structured note segment
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

  // blank line before transcript
  index += blankLine.length;

  // transcript heading → Heading 2
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

  // send all formatting in one batch
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  // step 2 — share with everyone at ria.insure
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