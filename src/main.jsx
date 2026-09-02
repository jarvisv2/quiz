import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const LETTERS = ['A', 'B', 'C', 'D'];

function extractVideoId(value) {
  try {
    const u = new URL(value);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || '';
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || '';
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
    }
  } catch (_) {}
  return '';
}

function formatTime(total) {
  const s = Math.max(0, Number(total) || 0);
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${sec}`;
}

async function generateQuiz(url, questionCount, language) {
  const response = await fetch('/api/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, questionCount, language })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Quiz generation failed.');
  return data;
}

function App() {
  const [url, setUrl] = useState('');
  const [count, setCount] = useState('all');
  const [language, setLanguage] = useState('same');
  const [quiz, setQuiz] = useState(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);

  const videoId = useMemo(() => quiz?.videoId || extractVideoId(url), [quiz, url]);
  const current = quiz?.questions?.[index];
  const answered = selected !== null;

  async function onGenerate(e) {
    e.preventDefault();
    setError('');
    setQuiz(null);
    setFinished(false);
    setSelected(null);
    setScore(0);
    setIndex(0);
    const id = extractVideoId(url);
    if (!id) return setError('Paste a valid YouTube video link.');
    setLoading(true);
    try {
      const data = await generateQuiz(url, count, language);
      setQuiz(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function chooseOption(optionIndex) {
    if (!current || answered) return;
    setSelected(optionIndex);
    if (optionIndex === current.correctIndex) setScore(s => s + 1);
  }

  function next() {
    if (!quiz) return;
    if (index >= quiz.questions.length - 1) {
      setFinished(true);
      setSelected(null);
      return;
    }
    setIndex(i => i + 1);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function restart() {
    setFinished(false);
    setIndex(0);
    setSelected(null);
    setScore(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const percent = quiz ? Math.round((score / quiz.questions.length) * 100) : 0;

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">Q</span><span>QuizTube <b>AI</b></span></div>
        <span className="topbar-pill">YouTube → Practice Quiz</span>
      </header>

      <main className="container">
        {!quiz && (
          <section className="hero">
            <div className="eyebrow">EDUCATIONAL VIDEO QUIZ GENERATOR</div>
            <h1>Turn a YouTube lesson into a quiz you can <span>actually practice.</span></h1>
            <p className="hero-copy">Paste an educational or question-answer video. The app extracts the lesson transcript, builds transcript-grounded MCQs, and gives instant feedback as you practice.</p>

            <form className="generator-card" onSubmit={onGenerate}>
              <label className="field-label">YouTube video link</label>
              <div className="url-row">
                <div className="input-wrap"><span>▶</span><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." /></div>
                <button className="generate-btn" disabled={loading}>{loading ? <><span className="spinner" />Generating…</> : <>Generate Quiz <span>→</span></>}</button>
              </div>

              <div className="settings-row">
                <div><label className="field-label small">Questions</label><select value={count} onChange={e => setCount(e.target.value)}><option value="all">All useful questions</option><option value="10">10 questions</option><option value="20">20 questions</option><option value="30">30 questions</option><option value="50">50 questions</option></select></div>
                <div><label className="field-label small">Quiz language</label><select value={language} onChange={e => setLanguage(e.target.value)}><option value="same">Same as video</option><option value="English">English</option><option value="Bengali">Bengali</option><option value="Hindi">Hindi</option></select></div>
              </div>
              {error && <div className="error-box">⚠ {error}</div>}
            </form>

            <div className="feature-grid">
              <Feature icon="◎" title="Transcript-grounded" text="Questions stay tied to what the lesson actually teaches." />
              <Feature icon="✓" title="Instant feedback" text="Right answers turn green; wrong choices turn red immediately." />
              <Feature icon="◴" title="Jump to source" text="Use the question timestamp to revisit the exact lesson moment." />
            </div>
          </section>
        )}

        {quiz && !finished && (
          <section className="quiz-layout">
            <div className="quiz-head">
              <div><div className="eyebrow">PRACTICE MODE</div><h2>Question {index + 1} <span>of {quiz.questions.length}</span></h2></div>
              <div className="score-chip">Score <strong>{score}</strong> / {index + (answered ? 1 : 0)}</div>
            </div>
            <div className="progress"><div style={{ width: `${((index + 1) / quiz.questions.length) * 100}%` }} /></div>

            <div className="content-grid">
              <article className="question-card">
                <div className="question-meta"><span>QUESTION {String(index + 1).padStart(2, '0')}</span>{current.sourceTimestampSeconds > 0 && <a href={`https://www.youtube.com/watch?v=${videoId}&t=${current.sourceTimestampSeconds}s`} target="_blank" rel="noreferrer">↗ Source {formatTime(current.sourceTimestampSeconds)}</a>}</div>
                <h3>{current.question}</h3>
                <div className="options">
                  {current.options.map((option, i) => {
                    const isCorrect = i === current.correctIndex;
                    const isSelected = i === selected;
                    const cls = !answered ? 'option' : isCorrect ? 'option correct' : isSelected ? 'option wrong' : 'option muted';
                    return <button className={cls} key={i} onClick={() => chooseOption(i)} disabled={answered}><span className="letter">{LETTERS[i]}</span><span>{option}</span><span className="state">{answered && isCorrect ? '✓' : answered && isSelected ? '×' : ''}</span></button>;
                  })}
                </div>
                {answered && <div className={`feedback ${selected === current.correctIndex ? 'good' : 'bad'}`}><div className="feedback-title">{selected === current.correctIndex ? 'Correct!' : `Not quite — ${LETTERS[current.correctIndex]} is correct.`}</div><div>{current.explanation}</div></div>}
                <div className="question-footer"><span>{answered ? 'Answer locked' : 'Choose one answer'}</span><button className="next-btn" disabled={!answered} onClick={next}>{index === quiz.questions.length - 1 ? 'See Result →' : 'Next Question →'}</button></div>
              </article>
              <aside className="video-card"><div className="video-frame"><iframe src={`https://www.youtube.com/embed/${videoId}?rel=0`} title="YouTube lesson" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div><div className="video-caption"><span>VIDEO SOURCE</span><b>Watch the lesson alongside your practice</b></div></aside>
            </div>
          </section>
        )}

        {quiz && finished && (
          <section className="result-card">
            <div className="eyebrow">QUIZ COMPLETE</div>
            <div className="score-ring" style={{background:`conic-gradient(#71a5ff ${percent}%, #15253b 0)`}}><div><strong>{percent}%</strong><span>{score} / {quiz.questions.length}</span></div></div>
            <h2>{percent >= 80 ? 'Excellent work.' : percent >= 50 ? 'Good practice — keep going.' : 'Nice start. Review and try again.'}</h2>
            <p>You completed every generated question from this video.</p>
            <div className="result-actions"><button className="generate-btn" onClick={restart}>Practice Again</button><button className="ghost-btn" onClick={() => {setQuiz(null); setUrl('');}}>New Video</button></div>
          </section>
        )}
      </main>
      <footer>QuizTube AI • Built for educational practice • AI-generated questions should still be reviewed for high-stakes exams.</footer>
    </div>
  );
}

function Feature({ icon, title, text }) { return <div className="feature"><div className="feature-icon">{icon}</div><div><b>{title}</b><p>{text}</p></div></div>; }

createRoot(document.getElementById('root')).render(<App />);
