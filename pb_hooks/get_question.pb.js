routerAdd("GET", "/get_question", (e) => {
  const records = $app.findRecordsByFilter(
    "questions",
    "",
    "-created",
    1,
    0
  )

  if (!records || records.length === 0) {
    return e.json(404, { success: false, message: "No question found" })
  }

  const record = records[0]

  let answers = []
  const rawValidAnswers = record.get("valid_answers")

  if (Array.isArray(rawValidAnswers)) {
    answers = rawValidAnswers
  } else if (rawValidAnswers && typeof rawValidAnswers === "object") {
    if (Array.isArray(rawValidAnswers.answers)) {
      answers = rawValidAnswers.answers
    } else if (Array.isArray(rawValidAnswers.valid_answers)) {
      answers = rawValidAnswers.valid_answers
    }
  }

  const md5Answers = answers
    .filter((value) => typeof value === "string")
    .map((answer) => answer.trim().toLowerCase())
    .filter((answer) => answer.length > 0)
    .map((answer) => $security.md5(answer))

  return e.json(200, {
    success: true,
    data: {
      id: record.id,
      question: record.get("question") || "",
      did_you_know: record.get("did_you_know") || "",
      valid_answers: md5Answers
    }
  })
})
