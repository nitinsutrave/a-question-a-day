const state = {
  questionLoaded: false,
  question: { question_id: '', question_text: '', valid_answers: [] },
  attempts: 0,
  isCorrect: false,
}

const subtitleEl = document.getElementById('subtitle')
const errorEl = document.getElementById('error')
const welcomeViewEl = document.getElementById('welcome-view')
const questionViewEl = document.getElementById('question-view')
const successViewEl = document.getElementById('success-view')
const questionTextEl = document.getElementById('question-text')
const answerEl = document.getElementById('answer')
const attemptsEl = document.getElementById('attempts')
const viewBtnEl = document.getElementById('view-btn')
const answerBtnEl = document.getElementById('answer-btn')
const shareBtnEl = document.getElementById('share-btn')
const whatsappLinkEl = document.getElementById('whatsapp-link')
const twitterLinkEl = document.getElementById('twitter-link')
const popupBackdropEl = document.getElementById('popup-backdrop')
const tryAgainBtnEl = document.getElementById('try-again-btn')
const popupEl = document.querySelector('.popup')

const APPWRITE_FUNCTION_ENDPOINT =
  'https://cloud.appwrite.io/v1/functions/YOUR_FUNCTION_ID/executions'

const APPWRITE_PROJECT_ID = 'YOUR_PROJECT_ID'

const cookieKeyForQuestion = () => `attempts_${state.question.question_id}`
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
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

const loadAttempts = () => {
  const cookieValue = getCookie(cookieKeyForQuestion())
  state.attempts = cookieValue ? Number(cookieValue) || 0 : 0
  attemptsEl.textContent = `Attempts: ${state.attempts}`
}

const incrementAttempts = () => {
  state.attempts += 1
  setCookie(cookieKeyForQuestion(), String(state.attempts))
  attemptsEl.textContent = `Attempts: ${state.attempts}`
}

const shareText = () => `I solved today's A Question a Day challenge in ${state.attempts} attempts!`

const updateShareLinks = () => {
  const encoded = encodeURIComponent(shareText())
  whatsappLinkEl.href = `https://wa.me/?text=${encoded}`
  twitterLinkEl.href = `https://twitter.com/intent/tweet?text=${encoded}`
}

const showIncorrectPopup = (show) => {
  popupBackdropEl.classList.toggle('hidden', !show)
}

const render = () => {
  const questionVisible = questionViewEl.dataset.visible === 'true'
  questionViewEl.classList.toggle('hidden', !state.questionLoaded || state.isCorrect || !questionVisible)
  welcomeViewEl.classList.toggle('hidden', questionVisible || state.isCorrect)
  successViewEl.classList.toggle('hidden', !state.isCorrect)
}

const parseQuestionPayload = (payload) => {
  if (!payload || typeof payload.question_id !== 'string' || typeof payload.question_text !== 'string' || !Array.isArray(payload.valid_answers)) {
    throw new Error('Invalid question payload format')
  }

  return payload
}

const fetchQuestion = async () => {
  const response = await fetch(APPWRITE_FUNCTION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': APPWRITE_PROJECT_ID
    },
    body: JSON.stringify({})
  })

  if (!response.ok) {
    throw new Error('Function execution failed')
  }

  const execution = await response.json()

  // Appwrite returns the function output as a string
  const payload = JSON.parse(execution.responseBody)

  if (!payload.success) {
    throw new Error('Invalid function response')
  }

  return {
    question_id: payload.data.id,
    question_text: payload.data.question,
    valid_answers: payload.data.answers
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
  if (!state.questionLoaded) {
    return
  }

  incrementAttempts()
  const digest = CryptoJS.MD5(normalizeAnswer(answerEl.value)).toString()

  if (state.question.valid_answers.includes(digest)) {
    state.isCorrect = true
    showIncorrectPopup(false)
    updateShareLinks()
    render()
    return
  }

  showIncorrectPopup(true)
})

popupBackdropEl.addEventListener('click', () => showIncorrectPopup(false))
tryAgainBtnEl.addEventListener('click', () => showIncorrectPopup(false))
popupEl.addEventListener('click', (event) => event.stopPropagation())

shareBtnEl.addEventListener('click', async () => {
  if (navigator.share) {
    try {
      await navigator.share({ text: shareText() })
      return
    } catch {
      // ignore canceled share
    }
  }

  window.open(whatsappLinkEl.href, '_blank', 'noopener,noreferrer')
})

const loadQuestion = async () => {
  try {
    state.question = await fetchQuestion()
    state.questionLoaded = true

    subtitleEl.textContent = 'Challenge yourself with one thoughtful question.'
    questionTextEl.textContent = state.question.question_text
    viewBtnEl.disabled = false
    loadAttempts()
    updateShareLinks()
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
