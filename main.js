const { useEffect, useMemo, useState } = React

const QUESTION_API_ENDPOINT = 'https://api.aquestionaday.in/get_question'
const INCREASE_ATTEMPT_API = 'https://api.aquestionaday.in/increase_attempt'
const LEADERBOARD_API = 'https://api.aquestionaday.in/leaderboard'
const USERS_STORAGE_KEY = 'aqad_users'
const SESSION_STORAGE_KEY = 'aqad_session'

const getAnswersList = (value) => {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.answers)) return value.answers
  return []
}

const normalizeAnswer = (text) => text.trim().toLowerCase()

const getCookie = (name) => {
  const cookieMap = document.cookie
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)

  const found = cookieMap.find((entry) => entry.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : null
}

const setCookie = (name, value, days = 365) => {
  const expires = new Date(Date.now() + days * 86400000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

const getUsers = () => {
  try {
    return JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

const saveUsers = (users) => localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))

function App() {
  const [questionLoaded, setQuestionLoaded] = useState(false)
  const [question, setQuestion] = useState({ question_id: '', question_text: '', valid_answers: [], did_you_know: '' })
  const [attempts, setAttempts] = useState(0)
  const [isCorrect, setIsCorrect] = useState(false)
  const [isAnswered, setIsAnswered] = useState(false)
  const [showQuestion, setShowQuestion] = useState(false)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [showPopup, setShowPopup] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [session, setSession] = useState(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null'))
  const [form, setForm] = useState({ email: '', password: '', screenName: '' })
  const [authError, setAuthError] = useState('')
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardError, setLeaderboardError] = useState('')

  const cookieKeyForQuestion = useMemo(() => `attempts_${question.question_id}`, [question.question_id])
  const answeredCookieKeyForQuestion = useMemo(() => `is_answered_${question.question_id}`, [question.question_id])

  const loadLeaderboard = async (questionId) => {
    try {
      setLeaderboardError('')
      const response = await fetch(`${LEADERBOARD_API}?question_id=${encodeURIComponent(questionId)}`)
      if (!response.ok) throw new Error('Leaderboard unavailable')
      const payload = await response.json()
      const rows = Array.isArray(payload?.data) ? payload.data : []
      setLeaderboard(rows.slice(0, 10))
    } catch {
      setLeaderboard([])
      setLeaderboardError('Leaderboard is currently unavailable.')
    }
  }

  useEffect(() => {
    const loadQuestion = async () => {
      try {
        const response = await fetch(QUESTION_API_ENDPOINT)
        if (!response.ok) throw new Error(`Question fetch failed (${response.status})`)
        const payload = await response.json()
        const row = payload?.data
        if (!payload?.success || !row) throw new Error('No question found in API response')

        const loadedQuestion = {
          question_id: row.id,
          question_text: row.question || '',
          valid_answers: getAnswersList(row.valid_answers),
          did_you_know: row.did_you_know || ''
        }

        setQuestion(loadedQuestion)
        setQuestionLoaded(true)

        const cookieValue = getCookie(`attempts_${loadedQuestion.question_id}`)
        setAttempts(cookieValue ? Number(cookieValue) || 0 : 0)

        const answered = getCookie(`is_answered_${loadedQuestion.question_id}`) === 'true'
        setIsAnswered(answered)
        if (answered) loadLeaderboard(loadedQuestion.question_id)
      } catch (e) {
        console.error(e)
        setError("Could not load today's question. Please refresh and try again.")
      }
    }

    loadQuestion()
  }, [])

  const shareText = () => {
    const attemptLabel = attempts === 1 ? 'attempt' : 'attempts'
    return `🧠✅ I cracked today's A Question a Day quiz in ${attempts} ${attemptLabel}!\n\nThink you can beat me? 🚀 Try it now: https://aquestionaday.in ✨`
  }

  const onShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText() })
        return
      } catch {}
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText())}`, '_blank', 'noopener,noreferrer')
  }

  const registerOrLogin = (event) => {
    event.preventDefault()
    setAuthError('')
    if (!form.email || !form.password || !form.screenName) {
      setAuthError('Please fill all fields.')
      return
    }

    const users = getUsers()
    const existing = users.find((u) => u.email.toLowerCase() === form.email.toLowerCase())

    if (existing && existing.password !== form.password) {
      setAuthError('Wrong password for this email.')
      return
    }

    let current = existing
    if (!existing) {
      current = { email: form.email, password: form.password, screenName: form.screenName, createdAt: Date.now() }
      users.push(current)
      saveUsers(users)
    }

    const sessionObj = { email: current.email, screenName: current.screenName }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionObj))
    setSession(sessionObj)
    setShowAuthModal(false)
  }

  const increaseAttemptForLoggedIn = async () => {
    if (!session?.email || !question.question_id) return
    try {
      await fetch(`${INCREASE_ATTEMPT_API}?question_id=${encodeURIComponent(question.question_id)}&email=${encodeURIComponent(session.email)}&screen_name=${encodeURIComponent(session.screenName || '')}`)
    } catch (e) {
      console.warn('Attempt tracking failed', e)
    }
  }

  const onAnswer = async () => {
    if (!questionLoaded || isAnswered) return

    const nextAttempts = attempts + 1
    setAttempts(nextAttempts)
    setCookie(cookieKeyForQuestion, String(nextAttempts))

    await increaseAttemptForLoggedIn()

    const digest = CryptoJS.MD5(normalizeAnswer(answer)).toString()
    if (question.valid_answers.includes(digest)) {
      setIsAnswered(true)
      setCookie(answeredCookieKeyForQuestion, 'true')
      setIsCorrect(true)
      setShowPopup(false)
      loadLeaderboard(question.question_id)
      return
    }

    setShowPopup(true)
  }

  const onLogout = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setSession(null)
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="top-row">
          <button className="secondary-btn auth-btn" onClick={() => (session ? onLogout() : setShowAuthModal(true))}>
            {session ? `Log out (${session.screenName})` : 'Log in'}
          </button>
        </div>
        <h1>A Question a Day</h1>
        <p className="subtitle">{questionLoaded ? `Let's get quizzing` : "Loading today's question..."}</p>
        {error && <div className="error">{error}</div>}

        {!showQuestion && !isCorrect && (
          <div>
            <button className="primary-btn" disabled={!questionLoaded} onClick={() => setShowQuestion(true)}>View Question</button>
          </div>
        )}

        {showQuestion && !isCorrect && (
          <div>
            <article className="question-box">{question.question_text}</article>
            {!isAnswered && (
              <div>
                <label className="input-label" htmlFor="answer">Your answer</label>
                <input id="answer" className="answer-input" type="text" placeholder="Type your answer here" value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyUp={(e) => e.key === 'Enter' && onAnswer()} />
                <button className="primary-btn" onClick={onAnswer}>Answer</button>
                <p className="attempts">Attempts: {attempts}</p>
              </div>
            )}

            {isAnswered && (
              <div className="answered-block">
                <p className="subtitle">Yay! You've already answered today's question</p>
                <div className="share-row"><button className="secondary-btn" onClick={onShare}>Share 🚀</button></div>
                <div className="trivia-box"><h3>Did you know?</h3><p>{question.did_you_know}</p></div>
                <Leaderboard leaderboard={leaderboard} error={leaderboardError} />
              </div>
            )}
          </div>
        )}

        {isCorrect && (
          <div>
            <h2>You got it! 🎉</h2>
            <p className="subtitle">Share it with your friends!</p>
            <div className="share-row">
              <button className="secondary-btn" onClick={onShare}>Share 🚀</button>
              <button className="secondary-btn" onClick={() => setShowQuestion(true)}>Home</button>
            </div>
            <div className="trivia-box"><h3>Did you know?</h3><p>{question.did_you_know}</p></div>
            <Leaderboard leaderboard={leaderboard} error={leaderboardError} />
          </div>
        )}
      </section>

      {showPopup && (
        <div className="popup-backdrop" onClick={() => setShowPopup(false)}>
          <div className="popup" onClick={(e) => e.stopPropagation()}>
            <p>You're not quite there yet</p>
            <button className="primary-btn" onClick={() => setShowPopup(false)}>Try again</button>
          </div>
        </div>
      )}

      {showAuthModal && (
        <div className="popup-backdrop" onClick={() => setShowAuthModal(false)}>
          <div className="popup auth-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Register / Log in</h3>
            <form onSubmit={registerOrLogin}>
              <input className="answer-input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="answer-input" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <input className="answer-input" type="text" placeholder="Screen name" value={form.screenName} onChange={(e) => setForm({ ...form, screenName: e.target.value })} />
              {authError && <p className="error">{authError}</p>}
              <button type="submit" className="primary-btn">Continue</button>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

function Leaderboard({ leaderboard, error }) {
  return (
    <div className="trivia-box leaderboard-box">
      <h3>Top 10 Leaderboard</h3>
      {error && <p className="error">{error}</p>}
      {!error && leaderboard.length === 0 && <p>No leaderboard data yet.</p>}
      {!error && leaderboard.length > 0 && (
        <ol>
          {leaderboard.map((row, idx) => (
            <li key={`${row.email || row.screen_name || idx}-${idx}`}>
              {(row.screen_name || row.name || 'Anonymous')} — {row.attempts ?? row.total_attempts ?? '-'} attempts
            </li>
          ))}
        </ol>
      )}
      <p className="leaderboard-note">Less attempts rank higher. Ties are resolved by earliest timestamp.</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
