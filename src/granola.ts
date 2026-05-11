import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as zlib from "zlib";
import * as https from "https";
import * as dotenv from "dotenv";

dotenv.config();

const STORED_ACCOUNTS_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Granola",
  "stored-accounts.json"
);

export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  attendees: string[];
  calendarEventId: string | null;
  calendarLink: string | null;
  transcript: string;
  notes: string;
}

function getAccessToken(): string {
  const raw = fs.readFileSync(STORED_ACCOUNTS_PATH, "utf-8");
  const data = JSON.parse(raw);
  const accounts = JSON.parse(data.accounts);
  if (!accounts || accounts.length === 0) {
    throw new Error("No Granola accounts found. Please sign into Granola.");
  }
  const tokens = JSON.parse(accounts[0].tokens);
  return tokens.access_token;
}

function granolaPost(endpoint: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const payload = JSON.stringify(body);

    const options = {
      hostname: "api.granola.ai",
      path: endpoint,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Granola/5.354.0",
        "X-Client-Version": "5.354.0",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk) => chunks.push(chunk));

      res.on("end", () => {
        const raw = Buffer.concat(chunks);

        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(
              `Granola API error ${res.statusCode}: ${raw.toString("utf-8").slice(0, 200)}`
            )
          );
          return;
        }

        zlib.gunzip(raw, (err, decompressed) => {
          const text = err
            ? raw.toString("utf-8")
            : decompressed.toString("utf-8");
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(
              new Error(`Failed to parse response: ${text.slice(0, 200)}`)
            );
          }
        });
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function getTranscript(docId: string): Promise<string> {
  try {
    const result = await granolaPost("/v1/get-document-transcript", {
      document_id: docId,
    });
    // result is directly an array of utterances
    const utterances = Array.isArray(result) ? result : (result.transcript || result.utterances || []);
    return utterances
      .filter((u: any) => u.is_final)
      .map((u: any) => u.text || "")
      .filter(Boolean)
      .join(" ");
  } catch {
    return "";
  }
}

function extractTextFromProseMirror(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromProseMirror).join(" ");
  }
  return "";
}

export async function getMeetings(since?: Date): Promise<Meeting[]> {
  const result = await granolaPost("/v2/get-documents", {
    limit: 50,
    offset: 0,
    include_last_viewed_panel: true,
  });

  const docs = result.docs || [];
  const meetings: Meeting[] = [];

  for (const doc of docs) {
    if (since) {
      const createdAt = new Date(doc.created_at);
      if (createdAt < since) continue;
    }

    const panel = doc.last_viewed_panel;
    const notes = panel?.content
      ? extractTextFromProseMirror(panel.content)
      : "";

    const transcript = await getTranscript(doc.id);

    const cal = doc.google_calendar_event || {};
    const attendees = (cal.attendees || [])
      .map((a: any) => a.email || "")
      .filter(Boolean);

    meetings.push({
      id: doc.id,
      title: doc.title || "Untitled Meeting",
      createdAt: doc.created_at,
      attendees,
      calendarEventId: cal.id || null,
      calendarLink: cal.htmlLink || null,
      transcript,
      notes,
    });
  }

  return meetings.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}