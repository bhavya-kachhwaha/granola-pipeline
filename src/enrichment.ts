import OpenAI from "openai";
import * as dotenv from "dotenv";
import type { Meeting } from "./granola";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const COMPANY_CONTEXT = `
Company: RIA Insurance -- an insurtech company building digital insurance products for brokers and customers in India.

Key products and systems:
- WhatsApp Broker Bot -- AI-powered WhatsApp interface for insurance brokers
- Partner Admin Workbench -- admin portal for network partners
- Symphony Service -- backend service for policy management
- All Corporate Report -- daily insurance policy tracking report
- Utilization Report -- daily consumption/utilization tracking report
- Capsule -- client-facing insurance product
- AiSensy -- WhatsApp API provider used for the broker bot
- Store Listing / Store Detail Pages -- broker-facing product pages

Key team members who may appear in transcripts:
- Bhavya Kachhwaha -- builder/integrator (likely the local microphone speaker)
- Nipun Virmani -- co-founder, product
- Abhideep Singh -- CTO
- Ajay -- team member
- Rohit -- engineering
- Sandeep -- engineering
- Tanujeep -- engineering
- Anchal -- team member
- Harshit -- team member

IMPORTANT TRANSCRIPT NOTE: Transcripts are captured via system audio with no speaker diarization. The local microphone user is likely Bhavya Kachhwaha. All other speakers come through system audio and cannot be reliably distinguished unless names are mentioned explicitly. Do not invent speaker attribution. Mark all non-local speaker attribution as low confidence inferred.
`;

export interface EnrichedMeeting {
  id: string;
  title: string;
  createdAt: string;
  attendees: string[];
  calendarEventId: string | null;
  calendarLink: string | null;
  meetingType:
    | "standup"
    | "1:1"
    | "client-call"
    | "technical-sync"
    | "product-review"
    | "demo"
    | "planning"
    | "other";
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
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
}

export async function enrichMeeting(
  meeting: Meeting
): Promise<EnrichedMeeting> {
  const content = meeting.transcript || meeting.notes;
  if (content.split(" ").length < 10) {
    return emptyEnrichment(meeting);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: `You are a senior chief of staff and executive meeting analyst with 20 years of experience turning messy meeting transcripts into precise, actionable intelligence.

${COMPANY_CONTEXT}

Your job is to extract signal from noise. You read between the lines. You identify what was actually decided vs what was just discussed. You know the difference between a real action item with an owner and a vague intention. You catch commitments people made even if they did not explicitly say "I will do X".

Examples of implicit action items you MUST catch:
- "I will check on that" → task: follow up on [topic], owner: speaker
- "We need to sort out the payload" → task: define and finalise notification payload, owner: inferred from context
- "Can you send me that document" → task: send document to [person], owner: person being asked
- "Let us revisit this next week" → task: schedule follow-up discussion on [topic]
- "It should be done by Friday" → task: complete [whatever was discussed], deadline: Friday

You return ONLY valid JSON. No markdown. No backticks. No explanation. Just the JSON object.`,
      },
      {
        role: "user",
        content: `Analyze this meeting transcript with extreme precision and return this exact JSON structure:

{
  "meetingType": one of: "standup" | "1:1" | "client-call" | "technical-sync" | "product-review" | "demo" | "planning" | "other",
  "summary": "3-4 sentences. What was the PURPOSE of this meeting, what was the CONTEXT going in, what was COVERED, and what is the STATE OF PLAY coming out. Write this as if briefing a senior executive who was not in the room and needs to understand the situation in 20 seconds. Be specific -- name the actual topics, products, and people discussed.",
  "decisions": [
    "State each decision clearly and completely. Include WHAT was decided and WHY if mentioned. Full sentences only. Example: 'Decided to use master policy number as the unique identifier for the corporate report because it is the only field guaranteed to be unique across all records.'"
  ],
  "actionItems": [
    {
      "task": "Specific concrete task starting with a verb. Include enough context that someone who was not in the meeting knows exactly what to do. Bad example: 'Update the database'. Good example: 'Add new master policy numbers from today s corporate report email to the master database and refresh all related pivot tables.'",
      "owner": "Full name of the person who owns this. If unclear write unassigned. Never leave blank.",
      "deadline": "Exact or relative deadline if mentioned. Empty string if none.",
      "confidence": "high" if owner was explicitly named, "medium" if inferred from context, "low" if uncertain,
      "confidence_reason": "one of: explicitly stated by speaker | inferred from conversational context | unclear attribution"
    }
  ],
  "openQuestions": [
    "Questions raised but NOT resolved. Full sentence. Include who raised it if known. Example: 'Nipun raised the question of how to handle duplicate policy numbers across multiple daily emails -- no resolution was reached.'"
  ],
  "projects": [
    "Specific project, product, system, or initiative names. Use the exact names from the company context where applicable."
  ]
}

Rules:
- Extract ALL action items including implicit ones
- Decisions must be real confirmed decisions not just topics discussed
- Summary must name actual products systems and people -- no generic filler
- Never fabricate information not present in the transcript
- Use company context to correctly identify product and system names

Meeting title: ${meeting.title}
Attendees: ${meeting.attendees.join(", ") || "unknown"}
Date: ${meeting.createdAt}

Full transcript:
${content.slice(0, 6000)}`,
      },
    ],
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
    console.error("Failed to parse OpenAI response for:", meeting.title);
    return emptyEnrichment(meeting);
  }
}

export async function generateStructuredNotes(
  meeting: Meeting,
  previousActionItems?: string
): Promise<string> {
  const content = meeting.transcript || meeting.notes;
  if (content.split(" ").length < 10) return "";

  const previousContext = previousActionItems
    ? `\nPrevious unresolved action items from last meeting -- flag any that appear resolved, still pending, or newly blocked:\n${previousActionItems}\n`
    : "";

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content: `You are an expert Meeting Intelligence and Minutes-of-Meeting (MoM) generation system.

${COMPANY_CONTEXT}

Your job is to convert raw meeting transcripts into highly structured, operationally useful meeting notes.

The transcript may contain missing punctuation, merged sentences, incorrect grammar, partial speaker names, overlapping conversations, and transcription artifacts. You must intelligently reconstruct the meeting.

Your output should feel like it was prepared by a highly competent program manager or chief of staff who attended the meeting live.

PRIMARY OBJECTIVES:
- Identify speakers wherever possible using name mentions and conversational clues
- Infer ownership contextually but always mark inferred attribution explicitly
- Extract tasks, blockers, deadlines, risks, decisions, and dependencies
- Separate updates by functional area or person
- Distinguish between confirmed facts vs inferred assumptions
- Preserve important technical and business context
- Highlight ambiguity where attribution confidence is low

SPEAKER ATTRIBUTION RULES:
- The local microphone speaker is likely Bhavya Kachhwaha
- All other speakers are system audio -- do not guess who is speaking unless a name is explicitly mentioned
- Mark all inferred attribution as: "Likely [name] based on context" or "Speaker unknown"
- Never present uncertain ownership as fact

IMPORTANT FORMATTING RULES:
- Use ## for section headings
- Use - for bullet points
- Use   - (2 spaces then dash) for sub-bullets
- DO NOT use markdown tables -- format all tabular data as structured bullet points instead
- DO NOT use bold text inside bullet points
- Return ONLY the notes content, no intro or outro

OUTPUT STRUCTURE -- follow exactly:

## Executive Summary
3-4 sentence leadership briefing. Name actual products, people, decisions, and risks. No generic filler.

## Transcript Quality Assessment
- Quality level: High / Moderate / Low
- Reason: explain speaker diarization issues, transcription noise, confidence levels

## Meeting Context
- What this meeting was about
- What the situation was going in
- Key background relevant to understanding the discussion

## Discussion Breakdown
One sub-section per major topic discussed. For each topic:
- What was discussed
- Who said what (with confidence level if inferred)
- Current status
- Any decisions or outcomes

## Action Items
For each action item:
- Task: [specific description]
  - Owner: [name or unassigned]
  - Deadline: [deadline or none mentioned]
  - Confidence: [high / medium / low]
  - Reason: [explicitly stated / inferred from context / unclear]

## Decisions Made
Only confirmed decisions. Full sentences. Include rationale if given. Do NOT include topics that were merely discussed.

## Risks and Blockers
- Each risk or blocker on its own bullet
- Include: what it is, who it affects, current status, urgency

## Cross-Team Dependencies
- Each dependency as a bullet
- Include: what is needed, which team needs it, which team provides it, current status

## Open Questions
- Each unresolved question as a bullet
- Include who raised it if known

## Production and Release Readiness
- What is confirmed ready for production
- What is not yet ready
- What still requires testing or validation

QUALITY RULES:
- Be extremely detailed -- preserve every technical nuance and business context
- Avoid generic summaries -- name actual systems, people, and timelines
- Infer intelligently but cautiously -- always separate fact from inference
- Do NOT hallucinate names, deadlines, or decisions
- The output must be useful for engineering leadership, product managers, and founders`,
      },
      {
        role: "user",
        content: `Convert this meeting transcript into comprehensive Minutes of Meeting following the structure in your instructions exactly.
${previousContext}
Meeting title: ${meeting.title}
Date: ${meeting.createdAt}
Attendees: ${meeting.attendees.join(", ") || "unknown"}

Full transcript:
${content.slice(0, 8000)}`,
      },
    ],
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