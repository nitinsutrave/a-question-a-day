const { useEffect, useMemo, useState } = React

const QUESTION_API_ENDPOINT = 'https://api.aquestionaday.in/get_question'
const INCREASE_ATTEMPT_API = 'https://api.aquestionaday.in/increase_attempt'
const POCKETBASE_BASE_URL = 'https://api.aquestionaday.in'
const SESSION_STORAGE_KEY = 'aqad_session'

const getAnswersList = (value) => {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.answers)) return value.answers
  return []
}

const normalizeAnswer = (text) => text.trim().toLowerCase()

const getCookie = (name) => {
  const cookieMap = document.cookie.split(';').map((pair) => pair.trim()).filter(Boolean)
  const found = cookieMap.find((entry) => entry.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : null
}

const setCookie = (name, value, days = 365) => {
  const expires = new Date(Date.now() + days * 86400000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

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
  const [authMode, setAuthMode] = useState('login')
  const [session, setSession] = useState(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null'))
  const [form, setForm] = useState({ email: '', password: '', screenName: '' })
  const [authError, setAuthError] = useState('')
  const [leaderboard, setLeaderboard] = useState([])
  const [leaderboardError, setLeaderboardError] = useState('')
  const [myAttempts, setMyAttempts] = useState(null)

  const cookieKeyForQuestion = useMemo(() => `attempts_${question.question_id}`, [question.question_id])
  const answeredCookieKeyForQuestion = useMemo(() => `is_answered_${question.question_id}`, [question.question_id])

  const increaseAttemptForLoggedIn = async () => {
    if (!session?.record?.id || !question.question_id) return false
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session.token) headers.Authorization = `Bearer ${session.token}`
      const resp = await fetch(INCREASE_ATTEMPT_API, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question_id: question.question_id })
      })
      return resp.ok
    } catch {
      return false
    }
  }

  const fetchAttemptsFromPocketBase = async (questionId, currentSession = session) => {
    if (!questionId) return null
    try {
      setLeaderboardError('')
      const leaderboardResponse = await fetch(
        `${POCKETBASE_BASE_URL}/api/collections/attempts/records?page=1&perPage=10&filter=${encodeURIComponent(`question='${questionId}' && has_solved=true`)}&sort=+attempts_taken,+created&expand=user`
      )
      if (!leaderboardResponse.ok) throw new Error('Leaderboard unavailable')
      const leaderboardPayload = await leaderboardResponse.json()
      setLeaderboard(Array.isArray(leaderboardPayload?.items) ? leaderboardPayload.items : [])

      if (currentSession?.record?.id) {
        const meResponse = await fetch(
          `${POCKETBASE_BASE_URL}/api/collections/attempts/records?page=1&perPage=1&filter=${encodeURIComponent(`question='${questionId}' && user='${currentSession.record.id}'`)}`,
          { headers: currentSession.token ? { Authorization: `Bearer ${currentSession.token}` } : {} }
        )
        if (!meResponse.ok) throw new Error('Could not fetch user attempts')
        const mePayload = await meResponse.json()
        const mine = mePayload?.items?.[0] || null
        setMyAttempts(mine?.attempts_taken ?? 0)
        if (mine?.has_solved === true) {
          setIsAnswered(true)
          setIsCorrect(false)
          setShowQuestion(true)
          setCookie(answeredCookieKeyForQuestion, 'true')
        }
        return mine
      }

      setMyAttempts(null)
      return null
    } catch {
      setLeaderboard([])
      setMyAttempts(null)
      setLeaderboardError('Leaderboard is currently unavailable.')
      return null
    }
  }

  const syncLocalAttemptsAfterLogin = async (questionId, currentSession) => {
    if (!currentSession?.record?.id) return
    const localAttemptCount = Number(getCookie(`attempts_${questionId}`) || 0)
    const mine = await fetchAttemptsFromPocketBase(questionId, currentSession)
    const remoteAttempts = Number(mine?.attempts_taken || 0)
    const missing = Math.max(0, localAttemptCount - remoteAttempts)
    for (let i = 0; i < missing; i += 1) {
      // best-effort replay so late login still captures existing attempt count
      await increaseAttemptForLoggedIn()
    }
    await fetchAttemptsFromPocketBase(questionId, currentSession)
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
        if (answered) fetchAttemptsFromPocketBase(loadedQuestion.question_id)
      } catch (e) {
        console.error(e)
        setError("Could not load today's question. Please refresh and try again.")
      }
    }

    loadQuestion()
  }, [])

  useEffect(() => {
    if (questionLoaded && question.question_id && session?.record?.id) {
      syncLocalAttemptsAfterLogin(question.question_id, session)
    }
  }, [questionLoaded, question.question_id, session?.record?.id])

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

  const loginUser = async (email, password) => {
    const response = await fetch(`${POCKETBASE_BASE_URL}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err?.message || 'Login failed')
    }
    return response.json()
  }

  const registerUser = async () => {
    const response = await fetch(`${POCKETBASE_BASE_URL}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        password: form.password,
        passwordConfirm: form.password,
        name: form.screenName,
        screen_name: form.screenName
      })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err?.message || 'Registration failed')
    }
  }

  const registerOrLogin = async (event) => {
    event.preventDefault()
    setAuthError('')

    if (!form.email || !form.password || (authMode === 'register' && !form.screenName)) {
      setAuthError('Please fill all required fields.')
      return
    }

    try {
      if (authMode === 'register') await registerUser()
      const authPayload = await loginUser(form.email, form.password)

      const nextSession = { token: authPayload.token, record: authPayload.record }
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession))
      setSession(nextSession)
      setShowAuthModal(false)
    } catch (e) {
      setAuthError(e.message || 'Authentication failed. Please try again.')
    }
  }

  const onAnswer = async () => {
    if (!questionLoaded || isAnswered) return

    const nextAttempts = attempts + 1
    setAttempts(nextAttempts)
    setCookie(cookieKeyForQuestion, String(nextAttempts))

    if (session?.record?.id) await increaseAttemptForLoggedIn()

    const digest = CryptoJS.MD5(normalizeAnswer(answer)).toString()
    if (question.valid_answers.includes(digest)) {
      setIsAnswered(true)
      setCookie(answeredCookieKeyForQuestion, 'true')
      setIsCorrect(true)
      setShowPopup(false)
      fetchAttemptsFromPocketBase(question.question_id)
      return
    }

    setShowPopup(true)
  }

  const onLogout = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setSession(null)
    setMyAttempts(null)
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="top-row">
          <button className="secondary-btn auth-btn" onClick={() => (session ? onLogout() : setShowAuthModal(true))}>
            {session ? `Log out (${session.record?.screen_name || session.record?.name || 'User'})` : 'Log in'}
          </button>
        </div>
        <h1>A Question a Day</h1>
        <p className="subtitle">{questionLoaded ? `Let's get quizzing` : "Loading today's question..."}</p>
        {error && <div className="error">{error}</div>}

        {!showQuestion && !isCorrect && <button className="primary-btn" disabled={!questionLoaded} onClick={() => setShowQuestion(true)}>View Question</button>}

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
                <Leaderboard leaderboard={leaderboard} error={leaderboardError} myAttempts={myAttempts} session={session} />
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
              <button className="secondary-btn" onClick={() => setIsCorrect(false)}>Home</button>
            </div>
            <div className="trivia-box"><h3>Did you know?</h3><p>{question.did_you_know}</p></div>
            <Leaderboard leaderboard={leaderboard} error={leaderboardError} myAttempts={myAttempts} session={session} />
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
            <h3>{authMode === 'login' ? 'Log in' : 'Register'}</h3>
            <div className="share-row auth-mode-row">
              <button className="secondary-btn" onClick={() => setAuthMode('login')}>Login</button>
              <button className="secondary-btn" onClick={() => setAuthMode('register')}>Register</button>
            </div>
            <form onSubmit={registerOrLogin}>
              <input className="answer-input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="answer-input" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {authMode === 'register' && <input className="answer-input" type="text" placeholder="Screen name" value={form.screenName} onChange={(e) => setForm({ ...form, screenName: e.target.value })} />}
              {authError && <p className="error">{authError}</p>}
              <button type="submit" className="primary-btn">Continue</button>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

function Leaderboard({ leaderboard, error, myAttempts, session }) {
  return (
    <div className="trivia-box leaderboard-box">
      <h3>Top 10 Leaderboard</h3>
      {session?.record?.id && myAttempts !== null && <p className="my-attempts">Your attempts: <strong>{myAttempts}</strong></p>}
      {error && <p className="error">{error}</p>}
      {!error && leaderboard.length === 0 && <p>No leaderboard data yet.</p>}
      {!error && leaderboard.length > 0 && (
        <ol>
          {leaderboard.map((row, idx) => (
            <li key={`${row.id || idx}-${idx}`}>
              {(row?.expand?.user?.screen_name || row?.expand?.user?.name || 'Anonymous')} — {row.attempts_taken ?? '-'} attempts
            </li>
          ))}
        </ol>
      )}
      <p className="leaderboard-note">Less attempts rank higher. Ties are resolved by earliest timestamp.</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
