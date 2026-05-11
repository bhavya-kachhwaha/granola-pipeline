# Granola Meeting Notes Pipeline

Automatically turns your Granola meeting recordings into structured Google Docs and attaches them to your Google Calendar events.

## What happens automatically

1. You finish a meeting in Granola
2. Pipeline detects it within 2 minutes
3. AI generates a structured doc with summary, decisions, and action items
4. Google Doc is created and shared with everyone at @ria.insure
5. Doc link is attached to the Google Calendar event

## One time setup (~20 minutes)

### Step 1 - Install Node.js
Download and install from https://nodejs.org (choose the LTS version)

### Step 2 - Clone the repo
Open Terminal and run:

    git clone https://github.com/bhavya-kachhwaha/granola-pipeline.git
    cd granola-pipeline

### Step 3 - Install dependencies

    npm install

### Step 4 - Get your Groq API key (free)
1. Go to https://console.groq.com
2. Sign up and click API Keys in the left sidebar
3. Click Create API Key and copy it

### Step 5 - Set up Google API credentials
1. Go to https://console.cloud.google.com
2. Create a new project called granola-pipeline
3. Go to APIs and Services > Library
4. Enable these 3 APIs: Google Docs API, Google Drive API, Google Calendar API
5. Go to APIs and Services > Credentials
6. Click Configure Consent Screen > External > fill in app name and your email
7. Click Clients > Create Client > Desktop app > name it granola-pipeline
8. Copy the Client ID and Client Secret

### Step 6 - Create your .env file

    cp .env.example .env

Open .env and fill in your values:

    GROQ_API_KEY=your_key_from_step_4
    GOOGLE_CLIENT_ID=your_client_id_from_step_5
    GOOGLE_CLIENT_SECRET=your_client_secret_from_step_5

### Step 7 - Authenticate with Google (one time only)

    npx tsx auth.ts

This opens a URL in your terminal. Open it in your browser, sign in with Google, click Allow, and paste the code back into the terminal. You will see "Token saved to token.json". You never need to do this again.

### Step 8 - Make sure Granola is installed and you are signed in
Download from https://granola.ai if not already installed. Sign in with your work Google account.

### Step 9 - Run the pipeline

    npm run watch

You will see dots printing every 2 minutes. That means it is running and checking for new meetings. Leave this terminal window open.

## Daily usage

Just keep the terminal running with npm run watch. Every meeting you have in Granola will automatically get a Google Doc within 2-4 minutes of the meeting ending.

## When Bhavya pushes an update

    git pull
    npm run watch

That is it. Two commands and you are on the latest version.

## Troubleshooting

**No meetings being processed**
- Make sure Granola is open and you are signed in
- Check that you have had at least one meeting in the last 24 hours

**Google authentication error**
- Delete token.json and run npx tsx auth.ts again to re-authenticate

**Groq API error**
- Check your GROQ_API_KEY in .env is correct
- Go to console.groq.com to verify the key is active

## Files in this repo

- src/granola.ts - reads meetings from Granola API
- src/enrichment.ts - sends transcripts to Groq AI for processing
- src/drive.ts - creates formatted Google Docs
- src/calendar.ts - attaches doc links to calendar events
- src/index.ts - main runner, polls every 2 minutes
- auth.ts - one time Google authentication setup

## Security

Never share or commit these files -- they contain your personal credentials:
- .env
- token.json

Both are already in .gitignore so they will never accidentally get pushed to GitHub.