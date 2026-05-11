import * as dotenv from "dotenv";
import { getMeetings } from "./granola";
import { enrichMeeting, generateStructuredNotes } from "./enrichment";
import { createMeetingDoc } from "./drive";
import { attachDocToCalendarEvent } from "./calendar";
import * as fs from "fs";

dotenv.config();

const PROCESSED_LOG = "processed.json";
const POLL_INTERVAL_MINUTES = 2;

function loadProcessed(): Set<string> {
  if (!fs.existsSync(PROCESSED_LOG)) return new Set();
  const data = JSON.parse(fs.readFileSync(PROCESSED_LOG, "utf-8"));
  return new Set(data);
}

function saveProcessed(ids: Set<string>) {
  fs.writeFileSync(PROCESSED_LOG, JSON.stringify([...ids], null, 2));
}

async function processMeeting(meeting: any) {
  console.log(`\n📋 Processing: "${meeting.title}"`);
  console.log("   Date:", meeting.createdAt);
  console.log("   Transcript words:", meeting.transcript.split(" ").length);

  console.log("   Step 1: Enriching with Groq...");
  const enriched = await enrichMeeting(meeting);
  console.log("   Meeting type:", enriched.meetingType);

  console.log("   Step 2: Generating structured notes...");
  const structuredNotes = await generateStructuredNotes(meeting);

  console.log("   Step 3: Creating Google Doc...");
  const docUrl = await createMeetingDoc(enriched, structuredNotes);

  console.log("   Step 4: Attaching to calendar event...");
  await attachDocToCalendarEvent(enriched, docUrl);

  console.log(`   ✓ Done → ${docUrl}`);
  return docUrl;
}

async function runOnce() {
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const allMeetings = await getMeetings(since);
  const processed = loadProcessed();

  const toProcess = allMeetings.filter(
    (m) =>
      m.transcript.split(" ").length > 50 &&
      !processed.has(m.id)
  );

  if (toProcess.length === 0) {
    process.stdout.write(".");
    return;
  }

  console.log(`\n\n🆕 Found ${toProcess.length} new meeting(s)!`);

  for (const meeting of toProcess) {
    try {
      await processMeeting(meeting);
      processed.add(meeting.id);
      saveProcessed(processed);
    } catch (err) {
      console.error(`   ✗ Failed: "${meeting.title}":`, err);
    }
  }

  console.log("\n✅ All meetings processed.");
}

async function startPolling() {
  console.log(`🔍 Polling Granola API every ${POLL_INTERVAL_MINUTES} minutes...`);
  console.log("   Dots = checked, no new meetings. Ctrl+C to stop.\n");

  // run immediately on start
  await runOnce();

  // then poll every 2 minutes
  setInterval(async () => {
    await runOnce();
  }, POLL_INTERVAL_MINUTES * 60 * 1000);
}

startPolling();