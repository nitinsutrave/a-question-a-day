/**
 * A Question a Day — React rewrite
 *
 * Fixes vs the PR branch:
 *  1. Uses the correct /get_question API endpoint and response shape.
 *  2. valid_answers are MD5 hashes — answers are hashed before comparison.
 *  3. Leaderboard queries PocketBase with expand=user so names are shown.
 *  4. On load, existing solved state is checked before showing the answer form.
 *  5. Attempts are only created/incremented server-side — no duplicates.
 *
 * Architecture:
 *  - Vite + React 18 (package.json, vite.config.js)
 *  - Entry: src/main.jsx → mounts <App />
 *  - Styles: src/styles.css  (original design preserved)
 *  - Auth stored in localStorage under "aqad_user"
 *  - Anonymous state tracked via cookies
 */

import { useState, useEffect, useCallback, useRef } from "react";
import CryptoJS from "crypto-js";

// ─── Config ───────────────────────────────────────────────────────────────────
const API_URL = "https://api.aquestionaday.in";
const PB_URL  = "https://api.aquestionaday.in";

// ─── Answer checking (MD5 hash matching) ─────────────────────────────────────
function md5(str) {
  return CryptoJS.MD5(str.trim().toLowerCase()).toString();
}

function checkAnswer(input, validAnswerHashes) {
  const hash = md5(input);
  return validAnswerHashes.includes(hash);
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function fetchTodayQuestion() {
  const res = await fetch(`${API_URL}/get_question`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error("API returned success=false");
  return body.data; // { id, question, valid_answers, did_you_know }
}

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

async function pbGetAttemptForUser(questionId, userId) {
  const filter = encodeURIComponent(`question="${questionId}" && user="${userId}"`);
  const data = await pbFetch(
    `/api/collections/attempts/records?filter=${filter}&perPage=1`
  );
  return data.items?.[0] ?? null;
}

async function pbCreateAttempt(questionId, userId, hasSolved) {
  return pbFetch("/api/collections/attempts/records", {
    method: "POST",
    body: JSON.stringify({
      question: questionId,
      user: userId,
      attempts_taken: 1,
      has_solved: hasSolved,
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
  const filter = encodeURIComponent(`question="${questionId}" && has_solved=true`);
  const data = await pbFetch(
    `/api/collections/attempts/records?filter=${filter}&sort=attempts_taken&perPage=10&expand=user`
  );
  return data.items ?? [];
}

// ─── Cookie helpers (anonymous users) ────────────────────────────────────────
function getCookieAttempts(questionId) {
  const m = document.cookie.match(new RegExp(`aqad_attempts_${questionId}=(\\d+)`));
  return m ? parseInt(m[1], 10) : 0;
}
function setCookieAttempts(questionId, n) {
  const exp = new Date(); exp.setDate(exp.getDate() + 7);
  document.cookie = `aqad_attempts_${questionId}=${n}; expires=${exp.toUTCString()}; path=/`;
}
function getCookieSolved(questionId) {
  return document.cookie.includes(`aqad_solved_${questionId}=1`);
}
function setCookieSolved(questionId) {
  const exp = new Date(); exp.setDate(exp.getDate() + 30);
  document.cookie = `aqad_solved_${questionId}=1; expires=${exp.toUTCString()}; path=/`;
}

// ─── localStorage auth ────────────────────────────────────────────────────────
const AUTH_KEY = "aqad_user";
const loadAuth  = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } };
const saveAuth  = (u) => localStorage.setItem(AUTH_KEY, JSON.stringify(u));
const clearAuth = ()  => localStorage.removeItem(AUTH_KEY);

// ─── Components ───────────────────────────────────────────────────────────────

function AuthModal({ onClose, onAuthSuccess }) {
  const [mode, setMode]       = useState("login");
  const [email, setEmail]     = useState("");
  const [name, setName]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(""); setLoading(true);
    try {
      if (mode === "register") await pbCreateUser(email, password, name);
      const auth = await pbAuthWithPassword(email, password);
      const user = { id: auth.record.id, name: auth.record.name, token: auth.token };
      saveAuth(user);
      onAuthSuccess(user);
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-heading">{mode === "login" ? "Welcome back" : "Join the game"}</h2>

        {mode === "register" && (
          <div className="field">
            <label>Screen name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shown on the leaderboard"
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

        {error && <p className="error" style={{ marginTop: "4px" }}>{error}</p>}

        <button className="primary-btn" onClick={handleSubmit} disabled={loading} style={{ width: "100%", marginTop: "8px" }}>
          {loading ? "Loading…" : mode === "login" ? "Log in" : "Create account"}
        </button>

        <p className="modal-switch">
          {mode === "login"
            ? <> No account? <button className="link-btn" onClick={() => setMode("register")}>Sign up</button> </>
            : <> Have an account? <button className="link-btn" onClick={() => setMode("login")}>Log in</button> </>
          }
        </p>
      </div>
    </div>
  );
}

function Leaderboard({ questionId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    pbGetLeaderboard(questionId)
      .then((items) =>
        setEntries(
          items.map((item) => ({
            id:       item.id,
            name:     item.expand?.user?.name || "Anonymous",
            attempts: item.attempts_taken,
          }))
        )
      )
      .catch(() => setError("Could not load leaderboard"))
      .finally(() => setLoading(false));
  }, [questionId]);

  if (loading) return <p className="subtle-text">Loading leaderboard…</p>;
  if (error)   return <p className="subtle-text">{error}</p>;
  if (entries.length === 0)
    return <p className="subtle-text">No solvers yet — be the first!</p>;

  return (
    <div className="leaderboard">
      <h3 className="leaderboard-title">🏆 Today's top solvers</h3>
      <ol className="leaderboard-list">
        {entries.map((e, i) => (
          <li key={e.id} className={`leaderboard-row${i === 0 ? " leaderboard-row--first" : ""}`}>
            <span className="leaderboard-rank">{i + 1}</span>
            <span className="leaderboard-name">{e.name}</span>
            <span className="leaderboard-attempts">
              {e.attempts} {e.attempts === 1 ? "attempt" : "attempts"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ShareButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ text, url: location.href }); } catch {}
    } else {
      await navigator.clipboard.writeText(`${text} ${location.href}`);
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
export default function App() {
  const [user, setUser]               = useState(loadAuth);
  const [showAuthModal, setShowAuth]  = useState(false);

  const [question, setQuestion]           = useState(null);
  const [loadingQuestion, setLoadingQ]    = useState(true);
  const [questionError, setQuestionError] = useState("");

  // view: "home" | "question" | "success" | "already_solved"
  const [view, setView]         = useState("home");
  const [answerInput, setInput] = useState("");
  const [showWrong, setWrong]   = useState(false);
  const [localAttempts, setLocalAttempts] = useState(0);

  const attemptRecord = useRef(null); // PocketBase attempts record for logged-in user

  // ── Load question ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchTodayQuestion()
      .then(setQuestion)
      .catch(() => setQuestionError("Could not load today's question."))
      .finally(() => setLoadingQ(false));
  }, []);

  // ── Check existing attempt for logged-in user ─────────────────────────────
  useEffect(() => {
    if (!question || !user) return;
    pbGetAttemptForUser(question.id, user.id)
      .then((record) => {
        if (!record) return;
        attemptRecord.current = record;
        setLocalAttempts(record.attempts_taken);
        if (record.has_solved) setView("already_solved");
      })
      .catch(() => {}); // non-fatal
  }, [question, user]);

  // ── Check cookie for anonymous users ──────────────────────────────────────
  useEffect(() => {
    if (!question || user) return;
    setLocalAttempts(getCookieAttempts(question.id));
    if (getCookieSolved(question.id)) setView("already_solved");
  }, [question, user]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  function handleAuthSuccess(u) {
    setUser(u);
    setShowAuth(false);
    // Reset attempt state — the useEffect above will re-check from PocketBase
    attemptRecord.current = null;
  }

  function handleLogout() {
    clearAuth();
    setUser(null);
    attemptRecord.current = null;
    if (question) {
      setLocalAttempts(getCookieAttempts(question.id));
      setView(getCookieSolved(question.id) ? "already_solved" : "home");
    } else {
      setView("home");
    }
  }

  // ── Answer submission ─────────────────────────────────────────────────────
  const handleAnswer = useCallback(async () => {
    if (!question || !answerInput.trim()) return;

    const correct     = checkAnswer(answerInput, question.valid_answers);
    const newAttempts = localAttempts + 1;
    setLocalAttempts(newAttempts);

    // Anonymous: update cookie
    if (!user) setCookieAttempts(question.id, newAttempts);

    // Logged-in: create or increment PocketBase record
    if (user) {
      try {
        if (!attemptRecord.current) {
          const rec = await pbCreateAttempt(question.id, user.id, correct);
          attemptRecord.current = rec;
        } else {
          const updated = await pbIncrementAttempt(
            attemptRecord.current.id,
            attemptRecord.current.attempts_taken,
            correct
          );
          attemptRecord.current = updated;
        }
      } catch { /* non-fatal */ }
    }

    if (correct) {
      if (!user) setCookieSolved(question.id);
      setView("success");
    } else {
      setWrong(true);
      setInput("");
    }
  }, [question, answerInput, localAttempts, user]);

  // ── Share text ────────────────────────────────────────────────────────────
  const shareText = question
    ? `I solved today's A Question a Day in ${localAttempts} ${localAttempts === 1 ? "attempt" : "attempts"}! 🎉`
    : "";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Auth bar */}
      <div className="auth-bar">
        {user ? (
          <>
            <span className="auth-username">👤 {user.name}</span>
            <button className="auth-btn" onClick={handleLogout}>Log out</button>
          </>
        ) : (
          <button className="auth-btn" onClick={() => setShowAuth(true)}>Log in / Sign up</button>
        )}
      </div>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuth(false)} onAuthSuccess={handleAuthSuccess} />
      )}

      <main className="app-shell">
        <section className="card">
          <h1>A Question a Day</h1>

          {loadingQuestion && (
            <p className="subtitle">Loading today's question…</p>
          )}
          {questionError && <p className="error">{questionError}</p>}

          {question && !loadingQuestion && (
            <>
              {/* Home */}
              {view === "home" && (
                <div className="view">
                  <p className="subtitle">A new question every day.<br />How fast can you solve it?</p>
                  <button className="primary-btn" onClick={() => setView("question")}>
                    View Question
                  </button>
                </div>
              )}

              {/* Question */}
              {view === "question" && (
                <div className="view">
                  <article className="question-box">{question.question}</article>

                  <div id="answer-form">
                    <label className="input-label" htmlFor="answer">Your answer</label>
                    <input
                      id="answer"
                      className="answer-input"
                      type="text"
                      value={answerInput}
                      placeholder="Type your answer here"
                      onChange={(e) => { setInput(e.target.value); setWrong(false); }}
                      onKeyDown={(e) => e.key === "Enter" && handleAnswer()}
                      autoFocus
                    />
                    <button className="primary-btn" onClick={handleAnswer}>
                      Answer
                    </button>
                  </div>

                  {showWrong && (
                    <div className="popup-inline">
                      <p>You're not quite there yet</p>
                    </div>
                  )}

                  <p className="attempts">Attempts: {localAttempts}</p>
                </div>
              )}

              {/* Success */}
              {view === "success" && (
                <div className="view">
                  <h2>You got it! 🎉</h2>
                  <p className="subtitle">
                    Solved in <strong>{localAttempts}</strong> {localAttempts === 1 ? "attempt" : "attempts"}
                  </p>
                  <div className="share-row">
                    <ShareButton text={shareText} />
                    <button className="secondary-btn" onClick={() => setView("home")}>Home</button>
                  </div>

                  {question.did_you_know && (
                    <div className="trivia-box">
                      <h3>Did you know?</h3>
                      <p>{question.did_you_know}</p>
                    </div>
                  )}

                  <Leaderboard questionId={question.id} />
                </div>
              )}

              {/* Already solved */}
              {view === "already_solved" && (
                <div className="view">
                  <p className="subtitle">
                    ✅ You've already answered today's question
                    {localAttempts > 0 && ` in ${localAttempts} ${localAttempts === 1 ? "attempt" : "attempts"}`}
                  </p>
                  <div className="share-row">
                    <ShareButton text={shareText} />
                    <button className="secondary-btn" onClick={() => setView("home")}>Home</button>
                  </div>

                  {question.did_you_know && (
                    <div className="trivia-box">
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
