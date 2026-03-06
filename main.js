const state = {
  questionLoaded: false,
  question: { question_id: '', question_text: '', valid_answers: [], did_you_know: '' },
  attempts: 0,
  isCorrect: false,
  isAnswered: false
}

const subtitleEl = document.getElementById('subtitle')
const errorEl = document.getElementById('error')
const welcomeViewEl = document.getElementById('welcome-view')
const questionViewEl = document.getElementById('question-view')
const successViewEl = document.getElementById('success-view')
const questionTextEl = document.getElementById('question-text')
const answerFormEl = document.getElementById('answer-form')
const answerEl = document.getElementById('answer')
const attemptsEl = document.getElementById('attempts')
const answeredBlockEl = document.getElementById('answered-block')
const answeredShareBtnEl = document.getElementById('answered-share-btn')
const triviaTextEl = document.getElementById('trivia-text')
const viewBtnEl = document.getElementById('view-btn')
const answerBtnEl = document.getElementById('answer-btn')
const shareBtnEl = document.getElementById('share-btn')
const successHomeBtnEl = document.getElementById('success-home-btn')
const popupBackdropEl = document.getElementById('popup-backdrop')
const tryAgainBtnEl = document.getElementById('try-again-btn')
const popupEl = document.querySelector('.popup')

const APPWRITE_FUNCTION_ENDPOINT =
  'https://api.aquestionaday.in/v1/functions/69a872f1001651517b77/executions'

const APPWRITE_PROJECT_ID = '69a6f4ab003617880c6a'

const cookieKeyForQuestion = () => `attempts_${state.question.question_id}`
const answeredCookieKeyForQuestion = () => `is_answered_${state.question.question_id}`
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

const loadAttempts = () => {
  const cookieValue = getCookie(cookieKeyForQuestion())
  state.attempts = cookieValue ? Number(cookieValue) || 0 : 0
  attemptsEl.textContent = `Attempts: ${state.attempts}`
}

const loadAnsweredState = () => {
  state.isAnswered = getCookie(answeredCookieKeyForQuestion()) === 'true'
}

const markAnswered = () => {
  state.isAnswered = true
  setCookie(answeredCookieKeyForQuestion(), 'true')
}

const incrementAttempts = () => {
  state.attempts += 1
  setCookie(cookieKeyForQuestion(), String(state.attempts))
  attemptsEl.textContent = `Attempts: ${state.attempts}`
}

const shareText = () => {
  const attemptLabel = state.attempts === 1 ? 'attempt' : 'attempts'
  return `🧠✅ I cracked today's A Question a Day quiz in ${state.attempts} ${attemptLabel}!\n\nThink you can beat me? 🚀 Try it now: https://aquestionaday.in ✨`
}

const showIncorrectPopup = (show) => {
  popupBackdropEl.classList.toggle('hidden', !show)
}

const render = () => {
  const questionVisible = questionViewEl.dataset.visible === 'true'

  questionViewEl.classList.toggle('hidden', !state.questionLoaded || state.isCorrect || !questionVisible)
  welcomeViewEl.classList.toggle('hidden', questionVisible || state.isCorrect)
  successViewEl.classList.toggle('hidden', !state.isCorrect)

  if (state.isAnswered) {
    answerFormEl.classList.add('hidden')
    attemptsEl.classList.add('hidden')
    answeredBlockEl.classList.remove('hidden')
  } else {
    answerFormEl.classList.remove('hidden')
    attemptsEl.classList.remove('hidden')
    answeredBlockEl.classList.add('hidden')
  }
}

function parseResponseBody(obj) {
  try {
    return JSON.parse(obj)
  } catch (err) {
    console.error('Invalid JSON in responseBody:', err)
    return null
  }
}

const fetchQuestion = async () => {
  const response = await fetch(APPWRITE_FUNCTION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': APPWRITE_PROJECT_ID
    },
    body: '{}'
  })

  if (!response.ok) {
    throw new Error(`Function execution failed (${response.status})`)
  }

  const execution = await response.json()

  if (!execution.responseBody) {
    throw new Error('Missing function response body')
  }

  const payload = parseResponseBody(execution.responseBody)

  if (!payload || !payload.data) {
    throw new Error('Invalid question payload format')
  }

  return {
    question_id: payload.data.id,
    question_text: payload.data.question,
    valid_answers: payload.data.answers,
    did_you_know: payload.data.did_you_know
  }
}

viewBtnEl.addEventListener('click', () => {
  questionViewEl.dataset.visible = 'true'
  render()
})

answerEl.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    answerBtnEl.click()
  }
})

answerBtnEl.addEventListener('click', () => {
  if (!state.questionLoaded || state.isAnswered) return

  incrementAttempts()

  const digest = CryptoJS.MD5(normalizeAnswer(answerEl.value)).toString()

  if (state.question.valid_answers.includes(digest)) {
    markAnswered()
    state.isCorrect = true

    triviaTextEl.textContent = state.question.did_you_know || ''

    showIncorrectPopup(false)
    render()
    return
  }

  showIncorrectPopup(true)
})

popupBackdropEl.addEventListener('click', () => showIncorrectPopup(false))
tryAgainBtnEl.addEventListener('click', () => showIncorrectPopup(false))
popupEl.addEventListener('click', (event) => event.stopPropagation())

const onShare = async () => {
  if (navigator.share) {
    try {
      await navigator.share({ text: shareText() })
      return
    } catch {}
  }

  window.open(
    `https://wa.me/?text=${encodeURIComponent(shareText())}`,
    '_blank',
    'noopener,noreferrer'
  )
}

shareBtnEl.addEventListener('click', onShare)
answeredShareBtnEl.addEventListener('click', onShare)

successHomeBtnEl.addEventListener('click', () => {
  state.isCorrect = false
  questionViewEl.dataset.visible = 'true'
  render()
})


const loadQuestion = async () => {
  try {
    state.question = await fetchQuestion()
    state.questionLoaded = true

    subtitleEl.textContent = `Let's get quizzing`
    questionTextEl.textContent = state.question.question_text

    viewBtnEl.disabled = false

    loadAttempts()
    loadAnsweredState()

    if (state.isAnswered) {
      triviaTextEl.textContent = state.question.did_you_know || ''
    }

    render()
  } catch (error) {
    console.error(error)
    errorEl.textContent = "Could not load today's question. Please refresh and try again."
    errorEl.classList.remove('hidden')
  }
}

questionViewEl.dataset.visible = 'false'

render()
loadQuestion()
