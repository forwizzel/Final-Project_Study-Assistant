// Cloudflare Worker (modules syntax)
// Handles both "flashcards" and "ask" tasks from your AiClient.

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Only POST supported' }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const task = (payload && payload.task) ? String(payload.task) : 'flashcards';

    try {
      if (task === 'flashcards') {
        return await handleFlashcards(payload, env);
      } else if (task === 'ask') {
        return await handleAsk(payload, env);
      } else {
        return jsonResponse({ error: `Unknown task: ${task}` }, 400);
      }
    } catch (e) {
      return jsonResponse({ error: 'Internal error', detail: String(e) }, 500);
    }
  }
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function callOpenAI(env, messages, { jsonOnly = false } = {}) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in Worker env');
  }

  const body = {
    model: 'gpt-4.1-mini', // change model here if you want
    messages,
    temperature: 0.3,
  };

  // For flashcards we want strict JSON output
  if (jsonOnly) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const completion = await res.json();
  const content = completion.choices?.[0]?.message?.content || '';
  return content.trim();
}

async function handleFlashcards(payload, env) {
  const notes = (payload.notes || '').toString();
  const maxFlashcards = payload.max_flashcards || 30;
  const callerInstructions =
    (payload.instructions || "Return a JSON array of objects with 'question' and 'answer'.").toString();

  if (!notes.trim()) {
    return jsonResponse({ error: 'notes field is required for flashcards' }, 400);
  }

  const systemPrompt = `
You are a study assistant that generates flashcards from notes.
You must output ONLY a JSON array.
Each array element must be an object with exactly two string fields:
  - "question"
  - "answer"
Return at most ${maxFlashcards} flashcards.
Do not include any extra text outside of the JSON array.
  `.trim();

  const userPrompt = `
Caller Instructions:
${callerInstructions}

User Notes:
${notes}
  `.trim();

  const content = await callOpenAI(
    env,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { jsonOnly: false } // we tell it to output JSON, but we'll just trust the content
  );

  // We expect content to be JSON array text; if it's wrapped in an object, you can adjust here.
  // Your AiClient expects either:
  // - a top-level JSON array of flashcards, OR
  // - { "flashcards": [ ... ] } / { "cards": [ ... ] }
  // We'll go with plain array so parseFlashcardsFromResponse(doc.isArray()) works.
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // If parsing fails, wrap in an error object so you can see it in Qt logs
    return jsonResponse({ error: 'AI returned non-JSON', raw: content }, 500);
  }

  if (Array.isArray(parsed)) {
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } else if (parsed && Array.isArray(parsed.flashcards)) {
    return jsonResponse({ flashcards: parsed.flashcards }, 200);
  } else if (parsed && Array.isArray(parsed.cards)) {
    return jsonResponse({ cards: parsed.cards }, 200);
  }

  // Fallback if structure is weird
  return jsonResponse({ error: 'Unexpected AI JSON structure', raw: parsed }, 500);
}

async function handleAsk(payload, env) {
  const notes = (payload.notes || '').toString();
  const question = (payload.question || '').toString();
  const callerInstructions =
    (payload.instructions || 'Answer clearly using the notes as context.').toString();

  if (!question.trim()) {
    return jsonResponse({ error: 'question field is required for ask' }, 400);
  }

  const systemPrompt = `
You are a helpful study assistant.
Use the provided notes as context to answer questions.
If the answer is not in the notes, say you are not sure.
  `.trim();

  const userPrompt = `
Caller Instructions:
${callerInstructions}

Notes:
${notes}

Question:
${question}
  `.trim();

  const answerText = await callOpenAI(
    env,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { jsonOnly: false }
  );

  // Your AiClient::parseAnswerFromResponse expects { "answer": "..." }
  return jsonResponse({ answer: answerText }, 200);
}
