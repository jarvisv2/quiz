const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['*'];

// You can override this order in Vercel with GEMINI_MODELS="gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash"
// The first model is the preferred production model; later models are fallbacks for temporary capacity issues.
const GEMINI_MODELS = (process.env.GEMINI_MODELS || [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash'
].join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)
    ? (ALLOWED_ORIGINS.includes('*') ? '*' : origin)
    : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function json(res, status, body, origin) {
  res.status(status);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.setHeader(k, v));
  return res.end(JSON.stringify(body));
}

function getYoutubeId(input) {
  try {
    const u = new URL(input);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2];
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
    }
  } catch (_) {}
  return null;
}

function normalizeTranscript(data) {
  if (!data) return '';
  if (typeof data.content === 'string') return data.content;
  if (Array.isArray(data.content)) {
    return data.content
      .filter(x => x && typeof x.text === 'string')
      .map(x => {
        const seconds = Math.floor((Number(x.offset) || 0) / 1000);
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
        const ss = String(seconds % 60).padStart(2, '0');
        return `[${mm}:${ss}] ${x.text.trim()}`;
      })
      .join('\n');
  }
  return '';
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (_) {}
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  throw new Error('The AI returned an invalid quiz format. Please try again.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorMessage(status, detail, model) {
  const cleanDetail = String(detail || '').replace(/\s+/g, ' ').trim();
  if (status === 429) return `${model} is temporarily rate-limited (429).`;
  if (status === 503) return `${model} is temporarily unavailable (503).`;
  if (status === 502) return `${model} returned a temporary gateway error (502).`;
  if (status === 500) return `${model} returned a temporary server error (500).`;
  if (status === 504) return `${model} timed out (504).`;
  if (status === 401 || status === 403) return 'Gemini API authentication failed. Check GEMINI_API_KEY in Vercel.';
  if (status === 400) return `Gemini rejected the request (400). ${cleanDetail.slice(0, 240)}`;
  return `Gemini request failed (${status}). ${cleanDetail.slice(0, 240)}`;
}

async function generateWithGemini(model, prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const attempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You create accurate, transcript-grounded educational quizzes. Never invent facts that are not in the source.' }]
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.25,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  question: { type: 'STRING' },
                  options: { type: 'ARRAY', items: { type: 'STRING' } },
                  correctIndex: { type: 'INTEGER' },
                  explanation: { type: 'STRING' },
                  sourceTimestampSeconds: { type: 'INTEGER' }
                },
                required: ['question', 'options', 'correctIndex', 'explanation', 'sourceTimestampSeconds']
              }
            }
          }
        })
      });
    } catch (error) {
      lastError = new Error(`${model} network error: ${error.message}`);
      if (attempt < attempts) {
        await sleep(800 * (2 ** (attempt - 1)));
        continue;
      }
      break;
    }

    const detail = await response.text();

    if (response.ok) {
      try {
        return JSON.parse(detail);
      } catch (_) {
        throw new Error(`${model} returned invalid JSON.`);
      }
    }

    lastError = new Error(getErrorMessage(response.status, detail, model));

    // Temporary capacity / quota errors: retry with backoff, then let the caller try another model.
    if (RETRYABLE_STATUSES.has(response.status) && attempt < attempts) {
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.min(retryAfterHeader * 1000, 8000)
        : Math.min(900 * (2 ** (attempt - 1)), 5000);
      await sleep(delay + Math.floor(Math.random() * 250));
      continue;
    }

    break;
  }

  throw lastError || new Error(`${model} failed without a detailed error.`);
}

function cleanQuestions(questions) {
  const seen = new Set();
  const cleaned = [];

  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length !== 4) continue;

    const question = q.question.trim();
    const options = q.options.map(x => String(x).trim());
    const normalized = question.toLowerCase().replace(/\s+/g, ' ');
    const uniqueOptions = new Set(options.map(x => x.toLowerCase()));
    const correctIndex = Number(q.correctIndex);

    if (!question || !options.every(Boolean) || uniqueOptions.size !== 4) continue;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    cleaned.push({
      question,
      options,
      correctIndex,
      explanation: String(q.explanation || '').trim(),
      sourceTimestampSeconds: Math.max(0, Number(q.sourceTimestampSeconds) || 0)
    });
  }

  return cleaned;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' }, origin);

  const { url, questionCount = 'all', language = 'same' } = req.body || {};
  if (!url || !getYoutubeId(url)) {
    return json(res, 400, { error: 'Please enter a valid YouTube video link.' }, origin);
  }

  if (!process.env.SUPADATA_API_KEY || !process.env.GEMINI_API_KEY) {
    return json(res, 500, { error: 'Server keys are not configured. Add SUPADATA_API_KEY and GEMINI_API_KEY in Vercel Environment Variables.' }, origin);
  }

  try {
    const transcriptUrl = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}`;
    const transcriptResponse = await fetch(transcriptUrl, {
      headers: { 'x-api-key': process.env.SUPADATA_API_KEY }
    });

    if (!transcriptResponse.ok) {
      const detail = await transcriptResponse.text();
      throw new Error(`Transcript service failed (${transcriptResponse.status}). ${detail.slice(0, 300)}`);
    }

    const transcriptData = await transcriptResponse.json();
    const transcript = normalizeTranscript(transcriptData);
    if (!transcript.trim()) throw new Error('No transcript was found for this video.');

    // Gemini 3.x has a 1M-token context window, so this is intentionally generous while
    // still protecting the Vercel function from extremely large input payloads.
    const maxChars = 300000;
    const clippedTranscript = transcript.length > maxChars
      ? transcript.slice(0, maxChars) + '\n[Transcript clipped for processing]'
      : transcript;

    const countInstruction = questionCount === 'all'
      ? 'Generate as many distinct high-quality questions as the educational content reasonably supports. Do not pad with trivial or duplicate questions.'
      : `Generate exactly ${Math.min(Math.max(Number(questionCount) || 10, 5), 50)} questions.`;

    const languageInstruction = language === 'same'
      ? 'Write the quiz in the same primary language used in the transcript.'
      : `Write the quiz in ${language}.`;

    const prompt = `You are an expert educational assessment writer. Turn the supplied YouTube transcript into a multiple-choice practice quiz.

Requirements:
- Only ask questions whose answers are supported by the transcript.
- Prioritize factual recall, concepts, definitions, comparisons, examples, cause/effect, and exam-style understanding.
- Avoid duplicates, vague wording, trick questions, and questions about the video itself (such as “who is speaking?”).
- Each question must have exactly 4 answer options.
- Exactly one option is correct.
- Make distractors plausible but clearly wrong based on the lesson.
- Include a concise explanation of why the correct answer is correct.
- Use the timestamp in square brackets in the transcript to estimate the best sourceTimestampSeconds for each question. Use 0 when not reasonably determinable.
- Keep question and option text concise enough for a quiz interface.
- ${countInstruction}
- ${languageInstruction}

Return ONLY a JSON array in this shape:
[
  {
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "correctIndex": 0,
    "explanation": "...",
    "sourceTimestampSeconds": 0
  }
]

Transcript:
${clippedTranscript}`;

    let geminiData = null;
    const modelErrors = [];

    for (const model of GEMINI_MODELS) {
      try {
        geminiData = await generateWithGemini(model, prompt);
        break;
      } catch (error) {
        console.warn(`Gemini model ${model} failed:`, error.message);
        modelErrors.push(error.message);
      }
    }

    if (!geminiData) {
      const last = modelErrors[modelErrors.length - 1] || 'AI generation failed.';
      const allTemporary = modelErrors.every(message =>
        /\b(429|500|502|503|504)\b|temporarily unavailable|temporarily rate-limited|timed out/i.test(message)
      );

      if (allTemporary) {
        throw new Error('Gemini is temporarily busy across the available models. Please wait a little and try Generate Quiz again. The app automatically retried and switched models.');
      }
      throw new Error(last);
    }

    const raw = extractGeminiText(geminiData);
    const questions = safeJsonParse(raw);
    const cleaned = cleanQuestions(questions);

    if (!cleaned.length) throw new Error('No usable questions were generated. Please try another educational video.');

    return json(res, 200, {
      videoId: getYoutubeId(url),
      language: transcriptData.lang || 'unknown',
      questionCount: cleaned.length,
      questions: cleaned
    }, origin);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Something went wrong while generating the quiz.' }, origin);
  }
}
