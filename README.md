# QuizTube AI — YouTube to Practice Quiz

A GitHub-ready React + Vercel project that turns educational YouTube videos into interactive MCQ practice quizzes.

## What it does

1. User pastes a YouTube URL.
2. The server fetches the transcript through Supadata.
3. Gemini generates transcript-grounded multiple-choice questions.
4. The UI gives instant green/red feedback, score tracking, explanations, and source timestamps.

The project intentionally keeps API keys on the server. Do **not** put your API keys into the React source code.

## Deploy from GitHub

### 1) Put this folder in a GitHub repository

Push the entire project, including `api/`, `src/`, `package.json`, and `vercel.json`.

### 2) Import the repo into Vercel

Create a Vercel project from the GitHub repository. Vercel can deploy the Vite frontend and the `api/quiz.js` serverless function together.

### 3) Add Environment Variables in Vercel

- `SUPADATA_API_KEY` — get a Supadata API key from https://supadata.ai/
- `GEMINI_API_KEY` — get a Gemini API key from https://ai.google.dev/

Optional:
- `ALLOWED_ORIGINS` — comma-separated allowed origins. Leave unset for the simplest same-project deployment.

### 4) Deploy

Open the Vercel URL and paste a YouTube educational video URL.

## Local development

You can build the frontend with:

```bash
npm install
npm run build
```

For full local serverless development, use Vercel's local development workflow so `/api/quiz` is available.

## Notes

- “All useful questions” means the model generates as many distinct, supportable questions as the transcript reasonably allows; it does not create artificial duplicates just to inflate the count.
- Videos without an accessible transcript may fail because transcript availability depends on the source service.
- AI-generated questions can contain mistakes, so review them before using them for high-stakes examinations.
