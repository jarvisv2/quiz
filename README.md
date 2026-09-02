# QuizTube AI

YouTube educational video → transcript → AI-generated MCQ practice quiz.

## Stack

- React + Vite frontend
- Vercel serverless API
- Supadata for YouTube transcript retrieval
- Google Gemini for quiz generation

## Deploy

1. Push this folder to GitHub.
2. Import the repository into Vercel.
3. Add these Environment Variables in Vercel:

```text
SUPADATA_API_KEY=your_supadata_key
GEMINI_API_KEY=your_gemini_api_key
```

Optional:

```text
GEMINI_MODELS=gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash
```

The API automatically retries temporary Gemini 429/5xx errors with exponential backoff and then falls back to the next model. This prevents a temporary capacity spike on one model from breaking quiz generation.

## Notes

- Keep API keys only in Vercel Environment Variables. Never put them in React code or commit them to GitHub.
- The frontend calls `/api/quiz`, so the keys remain server-side.
- "All useful questions" means all distinct, useful questions the model can reasonably derive from the available transcript; it does not generate filler duplicates.
- Generated questions are educational aids and should be reviewed before use in high-stakes exams.
