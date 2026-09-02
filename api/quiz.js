const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['*'];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? (ALLOWED_ORIGINS.includes('*') ? '*' : origin) : ALLOWED_ORIGINS[0];
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

    // Keep the prompt bounded while preserving as much of the lesson as possible.
    // The timestamps are useful to let the learner jump back to the source.
    const maxChars = 180000;
    const clippedTranscript = transcript.length > maxChars
      ? transcript.slice(0, maxChars) + '\n[Transcript clipped for processing]'
      : transcript;

    const countInstruction = questionCount === 'all'
      ? 'Generate as many distinct high-quality questions as the educational content reasonably supports. Do not pad with trivial or duplicate questions.'
      : `Generate exactly ${Math.min(Math.max(Number(questionCount) || 10, 5), 80)} questions.`;

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

    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent', {
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

    if (!geminiResponse.ok) {
      const detail = await geminiResponse.text();
      throw new Error(`AI generation failed (${geminiResponse.status}). ${detail.slice(0, 300)}`);
    }

    const geminiData = await geminiResponse.json();
    const raw = extractGeminiText(geminiData);
    const questions = safeJsonParse(raw);

    const cleaned = Array.isArray(questions)
      ? questions
          .filter(q => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4)
          .map(q => ({
            question: q.question.trim(),
            options: q.options.map(x => String(x).trim()),
            correctIndex: Math.min(3, Math.max(0, Number(q.correctIndex) || 0)),
            explanation: String(q.explanation || '').trim(),
            sourceTimestampSeconds: Math.max(0, Number(q.sourceTimestampSeconds) || 0)
          }))
      : [];

    if (!cleaned.length) throw new Error('No usable questions were generated.');

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
