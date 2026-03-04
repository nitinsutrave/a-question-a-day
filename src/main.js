const { createApp, ref, computed, onMounted } = Vue

createApp({
  template: `
    <main class="app-shell">
      <section class="card">
        <h1>A Question a Day</h1>

        <p class="subtitle" v-if="questionLoaded">
          Challenge yourself with one thoughtful question.
        </p>
        <p class="subtitle" v-else>Loading today's question...</p>

        <div v-if="loadError" class="error">{{ loadError }}</div>

        <template v-if="!hasViewedQuestion">
          <button class="primary-btn" :disabled="!questionLoaded" @click="hasViewedQuestion = true">View</button>
        </template>

        <template v-else-if="!isCorrect">
          <article class="question-box">{{ question.question_text }}</article>

          <label class="input-label" for="answer">Your answer</label>
          <input
            id="answer"
            v-model="answer"
            class="answer-input"
            type="text"
            placeholder="Type your answer here"
            @keyup.enter="submitAnswer"
          />

          <button class="primary-btn" @click="submitAnswer">Answer</button>
          <p class="attempts">Attempts: {{ attempts }}</p>
        </template>

        <template v-else>
          <h2>You got it! 🎉</h2>
          <p class="subtitle">Share your success with your friends.</p>
          <div class="share-row">
            <button class="secondary-btn" @click="shareGeneric">Share</button>
            <a class="secondary-btn link-btn" :href="whatsappLink" target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
            <a class="secondary-btn link-btn" :href="twitterLink" target="_blank" rel="noopener noreferrer">
              X / Twitter
            </a>
          </div>
        </template>
      </section>

      <div v-if="showIncorrectPopup" class="popup-backdrop" @click="showIncorrectPopup = false">
        <div class="popup" @click.stop>
          <p>You're not quite there yet</p>
          <button class="primary-btn" @click="showIncorrectPopup = false">Try again</button>
        </div>
      </div>
    </main>
  `,
  setup() {
    const questionLoaded = ref(false)
    const loadError = ref('')
    const question = ref({ question_id: '', question_text: '', valid_answers: [] })
    const hasViewedQuestion = ref(false)
    const answer = ref('')
    const attempts = ref(0)
    const isCorrect = ref(false)
    const showIncorrectPopup = ref(false)

    const cookieKeyForQuestion = computed(() => `attempts_${question.value.question_id}`)

    const shareText = computed(() => `I solved today's A Question a Day challenge in ${attempts.value} attempts!`)
    const encodedShareText = computed(() => encodeURIComponent(shareText.value))
    const whatsappLink = computed(() => `https://wa.me/?text=${encodedShareText.value}`)
    const twitterLink = computed(() => `https://twitter.com/intent/tweet?text=${encodedShareText.value}`)

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
      const cookieValue = getCookie(cookieKeyForQuestion.value)
      attempts.value = cookieValue ? Number(cookieValue) || 0 : 0
    }

    const incrementAttempts = () => {
      attempts.value += 1
      setCookie(cookieKeyForQuestion.value, String(attempts.value))
    }

    const submitAnswer = () => {
      if (!questionLoaded.value) {
        return
      }

      incrementAttempts()

      const digest = CryptoJS.MD5(normalizeAnswer(answer.value)).toString()
      const validSet = new Set(question.value.valid_answers)

      if (validSet.has(digest)) {
        isCorrect.value = true
        showIncorrectPopup.value = false
        return
      }

      showIncorrectPopup.value = true
    }

    const shareGeneric = async () => {
      if (navigator.share) {
        try {
          await navigator.share({ text: shareText.value })
          return
        } catch {
          // user canceled or unsupported payload
        }
      }

      window.open(whatsappLink.value, '_blank', 'noopener,noreferrer')
    }

    onMounted(async () => {
      try {
        const response = await fetch('/api/question')
        if (!response.ok) {
          throw new Error('Unable to load question data')
        }

        const payload = await response.json()
        question.value = payload
        loadAttempts()
        questionLoaded.value = true
      } catch (error) {
        loadError.value = "Could not load today's question. Please refresh and try again."
        console.error(error)
      }
    })

    return {
      questionLoaded,
      loadError,
      question,
      hasViewedQuestion,
      answer,
      attempts,
      isCorrect,
      showIncorrectPopup,
      whatsappLink,
      twitterLink,
      submitAnswer,
      shareGeneric,
    }
  },
}).mount('#app')
