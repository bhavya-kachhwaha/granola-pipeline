import Groq from "groq-sdk";
import * as dotenv from "dotenv";
import type { Meeting } from "./granola";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export interface EnrichedMeeting {
  id: string;
  title: string;
  createdAt: string;
  attendees: string[];
  calendarEventId: string | null;
  calendarLink: string | null;
  meetingType: "standup" | "planning" | "technical" | "1:1" | "team" | "other";
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions: string[];
  projects: string[];
  rawTranscript: string;
}

export interface ActionItem {
  task: string;
  owner: string;
  deadline: string;
}

export async function enrichMeeting(meeting: Meeting): Promise<EnrichedMeeting> {
  const content = meeting.transcript || meeting.notes;
  if (content.split(" ").length < 10) {
    return emptyEnrichment(meeting);
  }

  const prompt = `You are an expert meeting analyst. Analyze this meeting and return ONLY a JSON object — no preamble, no markdown, no backticks.

Meeting title: ${meeting.title}
Attendees: ${meeting.attendees.join(", ") || "unknown"}
Date: ${meeting.createdAt}

Transcript:
${content.slice(0, 6000)}

Return this exact JSON structure:
{
  "meetingType": "standup" | "planning" | "technical" | "1:1" | "team" | "other",
  "summary": "2-3 sentence summary of what this meeting was about",
  "decisions": ["decision 1", "decision 2"],
  "actionItems": [
    { "task": "what needs to be done", "owner": "person's name or email", "deadline": "mentioned deadline or empty string" }
  ],
  "openQuestions": ["unresolved question 1", "unresolved question 2"],
  "projects": ["project or topic name mentioned"]
}`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });

  const raw = response.choices[0].message.content || "{}";

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      ...meeting,
      rawTranscript: meeting.transcript,
      meetingType: parsed.meetingType || "other",
      summary: parsed.summary || "",
      decisions: parsed.decisions || [],
      actionItems: parsed.actionItems || [],
      openQuestions: parsed.openQuestions || [],
      projects: parsed.projects || [],
    };
  } catch {
    console.error("Failed to parse Groq response for:", meeting.title);
    return emptyEnrichment(meeting);
  }
}

export async function generateStructuredNotes(meeting: Meeting): Promise<string> {
  const content = meeting.transcript || meeting.notes;
  if (content.split(" ").length < 10) return "";

  const prompt = `You are an expert note-taker. Convert this meeting transcript into comprehensive, detailed notes that capture EVERYTHING discussed.

Be thorough — do not summarize or skip details. Every topic, every sub-point, every example mentioned should appear as a bullet or sub-bullet.

Use this exact format:
- ## for section headings (create as many sections as needed to cover all topics)
- - for bullet points
- (2 spaces)- for sub-bullets under a bullet

Example of the level of detail I want:

## Database Report Automation Process
- Two main report types to manage daily
  - All Corporate Report: unique field = master policy number
  - Utilization Report: unique field = order ID
- Daily email updates require database maintenance and pivot table refreshes
  - Email arrives each morning with new data
  - Must check for new entries not yet in master database
  - Pivot tables must be refreshed after every update

## All Corporate Report Workflow
- Receive daily email with new corporate data
- Check for new master policy numbers not in master database
  - Compare incoming data against existing master list
  - Flag any policy numbers that are new
- Add new policy numbers to master database
- Update related pivot tables automatically

## Key Decisions
- Use master policy number as unique identifier for corporate report
- Use order ID as unique identifier for utilization report
- Delete restore transaction types before deduplication

## Action Items
- Update master database with new master policy numbers
  - Owner: Ajay
  - Do this every morning after email arrives
- Remove duplicate order IDs from utilization report
  - Delete entries where transaction type = restore
  - Cross-check against existing master data

## Open Questions
- Unclear how to handle edge cases where same policy appears in multiple emails

Now convert this transcript — be comprehensive and detailed, capture everything:

Title: ${meeting.title}
Date: ${meeting.createdAt}
Attendees: ${meeting.attendees.join(", ") || "unknown"}

Full transcript:
${content.slice(0, 8000)}

Return ONLY the structured notes. No preamble. No closing remarks.`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 4000,
  });

  return response.choices[0].message.content || "";
}

function emptyEnrichment(meeting: Meeting): EnrichedMeeting {
  return {
    ...meeting,
    rawTranscript: meeting.transcript,
    meetingType: "other",
    summary: "Not enough content to analyse.",
    decisions: [],
    actionItems: [],
    openQuestions: [],
    projects: [],
  };
}