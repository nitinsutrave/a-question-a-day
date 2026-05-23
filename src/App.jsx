/**
 * A Question a Day — React rewrite
 *
 * Fixes vs the PR branch:
 *  1. Leaderboard query uses PocketBase `expand=user` and sorts by `attempts_taken` ASC
 *     so "fewest attempts wins", and filters has_solved=true.
 *  2. On load, if the user is logged in we check whether they already have a solved attempt
 *     for today's question. If yes, we jump straight to the solved view and never show the
 *     answer box, so re-submitting cannot increment attempts.
 *  3. Leaderboard rows display `expand.user.name` (the human-readable screen name) instead
 *     of the raw user ID.
 *
 * Architecture:
 *  - Vite + React 18 project (package.json, vite.config.js)
 *  - Entry: src/main.jsx → mounts <App /> from src/App.jsx
 *  - Styles: src/styles.css
 *  - PocketBase is used directly from the browser via its REST API
 *  - Auth is stored in localStorage under key "aqad_user"
 *  - Anonymous attempts use cookies, consistent with the original app
 */

import { useState, useEffect, useCallback, useRef } from "react"

// ─── Config ──────────────────────────────────────────────────────────────────
const PB_URL = "https://api.aquestionaday.in";

// ─── PocketBase helpers ───────────────────────────────────────────────────────
async function pbFetch(path, opts = {}) {
  const res = await fetch(`${PB_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

async function pbAuthWithPassword(email, password) {
  return pbFetch("/api/collections/users/auth-with-password", {
    method: "POST",
    body: JSON.stringify({ identity: email, password }),
  });
}

async function pbCreateUser(email, password, name) {
  return pbFetch("/api/collections/users/records", {
    method: "POST",
    body: JSON.stringify({ email, password, passwordConfirm: password, name }),
  });
}

async function pbGetTodayQuestion() {
  // Returns first question — the app shows one question per day by convention
  const data = await pbFetch("/api/collections/questions/records?perPage=1&sort=-created");
  return data.items?.[0] ?? null;
}

async function pbGetAttemptForUser(questionId, userId) {
  const filter = encodeURIComponent(`question="${questionId}" && user="${userId}"`);
  const data = await pbFetch(
    `/api/collections/attempts/records?filter=${filter}&perPage=1`
  );
  return data.items?.[0] ?? null;
}

async function pbCreateAttempt(questionId, userId) {
  return pbFetch("/api/collections/attempts/records", {
    method: "POST",
    body: JSON.stringify({
      question: questionId,
      user: userId,
      attempts_taken: 1,
      has_solved: false,
    }),
  });
}

async function pbIncrementAttempt(attemptId, currentCount, hasSolved) {
  return pbFetch(`/api/collections/attempts/records/${attemptId}`, {
    method: "PATCH",
    body: JSON.stringify({
      attempts_taken: currentCount + 1,
      has_solved: hasSolved,
    }),
  });
}

async function pbGetLeaderboard(questionId) {
  // Fetch all solved attempts, sorted by fewest attempts, expand user for name
  const filter = encodeURIComponent(`question="${questionId}" && has_solved=true`);
  const data = await pbFetch(
    `/api/collections/attempts/records?filter=${filter}&sort=attempts_taken&perPage=10&expand=user`
  );
  return data.items ?? [];
}

// ─── Cookie helpers (anonymous attempts) ─────────────────────────────────────
function getCookieAttempts(questionId) {
  const match = document.cookie.match(new RegExp(`aqad_attempts_${questionId}=(\\d+)`));
  return match ? parseInt(match[1], 10) : 0;
}

function setCookieAttempts(questionId, count) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  document.cookie = `aqad_attempts_${questionId}=${count}; expires=${expires.toUTCString()}; path=/`;
}

function getCookieSolved(questionId) {
  return document.cookie.includes(`aqad_solved_${questionId}=1`);
}

function setCookieSolved(questionId) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  document.cookie = `aqad_solved_${questionId}=1; expires=${expires.toUTCString()}; path=/`;
}

// ─── Answer checking ──────────────────────────────────────────────────────────
function normalise(s) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function checkAnswer(input, validAnswers) {
  const norm = normalise(input);
  return validAnswers.some((a) => normalise(a) === norm);
}

// ─── localStorage auth ────────────────────────────────────────────────────────
const AUTH_KEY = "aqad_user";
function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY));
  } catch {
    return null;
  }
}
function saveAuth(data) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(data));
}
function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

// ─── Components ───────────────────────────────────────────────────────────────

function AuthModal({ onClose, onAuthSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        await pbCreateUser(email, password, name);
      }
      const authData = await pbAuthWithPassword(email, password);
      const user = { id: authData.record.id, name: authData.record.name, token: authData.token };
      saveAuth(user);
      onAuthSuccess(user);
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">{mode === "login" ? "Welcome back" : "Join the game"}</h2>

        {mode === "register" && (
          <div className="field">
            <label>Screen name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How you'll appear on the leaderboard"
              autoFocus
            />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus={mode === "login"}
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="••••••••"
          />
        </div>

        {error && <p className="modal-error">{error}</p>}

        <button className="primary-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? "Loading…" : mode === "login" ? "Log in" : "Create account"}
        </button>

        <p className="modal-switch">
          {mode === "login" ? (
            <>No account? <button className="link-btn" onClick={() => setMode("register")}>Sign up</button></>
          ) : (
            <>Have an account? <button className="link-btn" onClick={() => setMode("login")}>Log in</button></>
          )}
        </p>
      </div>
    </div>
  );
}

function Leaderboard({ questionId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    pbGetLeaderboard(questionId)
      .then((items) => {
        // Map to display-friendly shape
        const rows = items.map((item) => ({
          id: item.id,
          name: item.expand?.user?.name || "Anonymous",
          attempts: item.attempts_taken,
        }));
        setEntries(rows);
      })
      .catch(() => setError("Could not load leaderboard"))
      .finally(() => setLoading(false));
  }, [questionId]);

  if (loading) return <p className="leaderboard-loading">Loading leaderboard…</p>;
  if (error) return <p className="leaderboard-error">{error}</p>;
  if (entries.length === 0) return <p className="leaderboard-empty">No solvers yet — be the first!</p>;

  return (
    <div className="leaderboard">
      <h3 className="leaderboard-title">🏆 Today's top solvers</h3>
      <ol className="leaderboard-list">
        {entries.map((e, i) => (
          <li key={e.id} className={`leaderboard-row rank-${i + 1}`}>
            <span className="rank">{i + 1}</span>
            <span className="lname">{e.name}</span>
            <span className="lattempts">{e.attempts} {e.attempts === 1 ? "attempt" : "attempts"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ShareButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const shareText = text || "Check out A Question a Day!";
    if (navigator.share) {
      try { await navigator.share({ text: shareText, url: location.href }); } catch {}
    } else {
      await navigator.clipboard.writeText(`${shareText} ${location.href}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <button className="secondary-btn" onClick={share}>
      {copied ? "Copied! ✓" : "Share 🚀"}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
// View states: "home" | "question" | "success" | "already_solved"
export default function App() {
  const [user, setUser] = useState(loadAuth);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [question, setQuestion] = useState(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [questionError, setQuestionError] = useState("");

  const [view, setView] = useState("home"); // home | question | success | already_solved
  const [answerInput, setAnswerInput] = useState("");
  const [showWrong, setShowWrong] = useState(false);

  // Per-question attempt tracking
  const attemptRecord = useRef(null); // PocketBase record for logged-in user
  const [localAttempts, setLocalAttempts] = useState(0); // shown in UI

  // ── Load question ────────────────────────────────────────────────────────
  useEffect(() => {
    pbGetTodayQuestion()
      .then(setQuestion)
      .catch(() => setQuestionError("Could not load today's question."))
      .finally(() => setLoadingQuestion(false));
  }, []);

  // ── When question loads + user known, check existing attempt ────────────
  useEffect(() => {
    if (!question || !user) return;
    pbGetAttemptForUser(question.id, user.id)
      .then((record) => {
        if (!record) return;
        attemptRecord.current = record;
        setLocalAttempts(record.attempts_taken);
        if (record.has_solved) {
          // Already solved — skip to solved view without showing answer form
          setView("already_solved");
        }
      })
      .catch(() => {}); // non-fatal
  }, [question, user]);

  // Also check cookie for anonymous users
  useEffect(() => {
    if (!question || user) return;
    const cookieAttempts = getCookieAttempts(question.id);
    setLocalAttempts(cookieAttempts);
    if (getCookieSolved(question.id)) {
      setView("already_solved");
    }
  }, [question, user]);

  // ── Auth ─────────────────────────────────────────────────────────────────
  function handleAuthSuccess(u) {
    setUser(u);
    setShowAuthModal(false);
  }

  function handleLogout() {
    clearAuth();
    setUser(null);
    // Reset any attempt state so the view refreshes cleanly
    attemptRecord.current = null;
    setLocalAttempts(question ? getCookieAttempts(question.id) : 0);
    if (question && getCookieSolved(question.id)) {
      setView("already_solved");
    } else {
      setView("home");
    }
  }

  // ── Answer submission ────────────────────────────────────────────────────
  const handleAnswer = useCallback(async () => {
    if (!question || !answerInput.trim()) return;

    const validAnswers = question.valid_answers?.answers ?? [];
    const correct = checkAnswer(answerInput, validAnswers);

    const newAttempts = localAttempts + 1;
    setLocalAttempts(newAttempts);

    // Update cookie for anonymous users
    if (!user) {
      setCookieAttempts(question.id, newAttempts);
    }

    // Update PocketBase for logged-in users
    if (user) {
      try {
        if (!attemptRecord.current) {
          // First attempt — create a new record
          const rec = await pbCreateAttempt(question.id, user.id);
          attemptRecord.current = rec;
          if (correct) {
            // Immediately patch to mark solved
            const updated = await pbIncrementAttempt(rec.id, 0, true);
            attemptRecord.current = updated;
          }
        } else {
          // Subsequent attempt — increment
          const updated = await pbIncrementAttempt(
            attemptRecord.current.id,
            attemptRecord.current.attempts_taken,
            correct
          );
          attemptRecord.current = updated;
        }
      } catch {
        // PocketBase failure is non-fatal — game continues
      }
    }

    if (correct) {
      if (!user) setCookieSolved(question.id);
      setView("success");
    } else {
      setShowWrong(true);
      setAnswerInput("");
    }
  }, [question, answerInput, localAttempts, user]);

  // ── Share text ───────────────────────────────────────────────────────────
  const shareText = question
    ? `I solved today's question on A Question a Day in ${localAttempts} ${localAttempts === 1 ? "attempt" : "attempts"}! 🎉`
    : "";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Auth bar */}
      <div className="auth-bar">
        {user ? (
          <>
            <span className="auth-name">👤 {user.name}</span>
            <button className="auth-btn" onClick={handleLogout}>Log out</button>
          </>
        ) : (
          <button className="auth-btn" onClick={() => setShowAuthModal(true)}>Log in / Sign up</button>
        )}
      </div>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onAuthSuccess={handleAuthSuccess} />
      )}

      <main className="app-shell">
        <section className="card">
          <h1 className="app-title">A Question a Day</h1>

          {loadingQuestion && <p className="subtitle">Loading today's question…</p>}
          {questionError && <p className="error">{questionError}</p>}

          {question && !loadingQuestion && (
            <>
              {/* ── Home view ── */}
              {view === "home" && (
                <div className="view fade-in">
                  <p className="subtitle">A new question every day. How fast can you get it?</p>
                  <button className="primary-btn" onClick={() => setView("question")}>
                    View Question
                  </button>
                </div>
              )}

              {/* ── Question view ── */}
              {view === "question" && (
                <div className="view fade-in">
                  <article className="question-box">{question.question}</article>

                  <div className="answer-form">
                    <label className="input-label" htmlFor="answer">Your answer</label>
                    <input
                      id="answer"
                      className="answer-input"
                      type="text"
                      value={answerInput}
                      placeholder="Type your answer here"
                      onChange={(e) => { setAnswerInput(e.target.value); setShowWrong(false); }}
                      onKeyDown={(e) => e.key === "Enter" && handleAnswer()}
                      autoFocus
                    />
                    <button className="primary-btn" onClick={handleAnswer}>
                      Answer
                    </button>
                  </div>

                  {showWrong && (
                    <div className="popup-inline fade-in">
                      <p>Not quite — try again!</p>
                    </div>
                  )}

                  <p className="attempts">Attempts: {localAttempts}</p>
                </div>
              )}

              {/* ── Success view ── */}
              {view === "success" && (
                <div className="view fade-in">
                  <h2 className="success-heading">You got it! 🎉</h2>
                  <p className="subtitle">
                    Solved in <strong>{localAttempts}</strong> {localAttempts === 1 ? "attempt" : "attempts"}
                  </p>
                  <div className="share-row">
                    <ShareButton text={shareText} />
                    <button className="secondary-btn" onClick={() => setView("home")}>Home</button>
                  </div>

                  {question.did_you_know && (
                    <div className="trivia-box fade-in">
                      <h3>Did you know?</h3>
                      <p>{question.did_you_know}</p>
                    </div>
                  )}

                  <Leaderboard questionId={question.id} />
                </div>
              )}

              {/* ── Already solved view ── */}
              {view === "already_solved" && (
                <div className="view fade-in">
                  <p className="subtitle already-solved-msg">
                    ✅ You've already answered today's question
                    {localAttempts > 0 && ` (${localAttempts} ${localAttempts === 1 ? "attempt" : "attempts"})`}
                  </p>
                  <div className="share-row">
                    <ShareButton text={shareText} />
                    <button className="secondary-btn" onClick={() => setView("home")}>Home</button>
                  </div>

                  {question.did_you_know && (
                    <div className="trivia-box fade-in">
                      <h3>Did you know?</h3>
                      <p>{question.did_you_know}</p>
                    </div>
                  )}

                  <Leaderboard questionId={question.id} />
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
