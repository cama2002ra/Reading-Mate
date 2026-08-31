// Reading Mate's AI engine.
//
// Talks directly to Google's Gemini API "Interactions" endpoint over REST —
// no backend server needed, which is why this works from a plain React
// Native / Expo app. Free tier docs: https://ai.google.dev/gemini-api/docs/pricing
//
// Get a free API key at https://aistudio.google.com/apikey (no credit card
// needed) and paste it into the app's Settings tab — it's stored only on
// the device (see services/storage.js), never hard-coded here.

import { getApiKey } from './storage';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// gemini-3.5-flash — stable, multimodal, free-tier model. (We originally
// used gemini-2.5-flash, but Google started blocking new API keys from
// that model in mid-2026 ahead of its official shutdown — a "no longer
// available to new users" 404 is the tell. gemini-3.5-flash is what
// Google now points new users to; same free tier, same request format.)
const MODEL = 'gemini-3.5-flash';

class GeminiError extends Error {}

// Pulls the final answer text out of an Interactions API response.
function extractText(interaction) {
  const modelSteps = (interaction.steps || []).filter((s) => s.type === 'model_output');
  const text = modelSteps
    .flatMap((step) => step.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  return text;
}

// Low-level call shared by every AI feature below.
//
// `store` and `systemInstruction` are optional and only used by the
// Milestone 2 multi-turn chat functions further down this file — existing
// callers above don't pass them, so their request bodies (and behavior)
// are byte-for-byte unchanged from Milestone 1.
async function callGemini({ input, responseFormat, store, systemInstruction }) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiError(
      'No Gemini API key yet. Add a free key in the Settings tab to turn the AI features on.'
    );
  }

  const body = { model: MODEL, input };
  if (responseFormat) body.response_format = responseFormat;
  if (typeof store === 'boolean') body.store = store;
  if (systemInstruction) body.system_instruction = systemInstruction;

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new GeminiError('Could not reach Gemini — check your internet connection.');
  }

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message = json?.error?.message || `Gemini request failed (HTTP ${response.status}).`;
    throw new GeminiError(message);
  }

  if (json.status !== 'completed') {
    throw new GeminiError(`Gemini did not finish the request (status: ${json.status}).`);
  }

  return json;
}

// ---------- Core feature 1: simplify a passage to a reading level ----------

export async function simplifyText(text, level = 'a 10-year-old reader') {
  const prompt =
    `Rewrite the following passage so it is easy for ${level} to understand. ` +
    `Keep the original meaning and key facts. Use short sentences and everyday words. ` +
    `If you must keep a hard word, add a tiny explanation in parentheses right after it. ` +
    `Return only the rewritten passage, no preamble.\n\n"""${text}"""`;

  const interaction = await callGemini({ input: prompt });
  return extractText(interaction);
}

// ---------- Core feature 2: explain a single word in context ----------

export async function explainWord(word, context = '') {
  const prompt =
    `Explain the word "${word}" the way you would to a curious kid. ` +
    (context ? `It appears in this context: """${context}""". ` : '') +
    `Give: (1) a one-sentence, simple definition, (2) one short example sentence of your own. ` +
    `Return only those two things, no preamble.`;

  const interaction = await callGemini({ input: prompt });
  return extractText(interaction);
}

// ---------- Core feature 3: generate a comprehension quiz ----------

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
            minItems: 4,
            maxItems: 4,
          },
          correctIndex: { type: 'integer', description: '0-based index of the correct option' },
          explanation: { type: 'string', description: 'One sentence on why that answer is correct' },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

export async function generateQuiz(text, numQuestions = 3) {
  const prompt =
    `Based on this passage, write ${numQuestions} multiple-choice comprehension questions. ` +
    `Each question needs exactly 4 options and one correct answer. ` +
    `Keep questions and options short and clear.\n\n"""${text}"""`;

  const interaction = await callGemini({
    input: prompt,
    responseFormat: { type: 'text', mime_type: 'application/json', schema: QUIZ_SCHEMA },
  });

  const raw = extractText(interaction);
  try {
    const parsed = JSON.parse(raw);
    return parsed.questions || [];
  } catch {
    throw new GeminiError('Gemini returned a quiz in an unexpected format. Try again.');
  }
}

// ---------- Core feature 4: read text straight from a photo ----------
// Sends the photo directly to Gemini (it can read images natively), asking
// it to transcribe AND simplify in one pass — no separate OCR step needed.

export async function simplifyFromImage(base64Image, mimeType = 'image/jpeg', level = 'a 10-year-old reader') {
  const input = [
    {
      type: 'text',
      text:
        `Read the text in this photo of a page. Then rewrite it so it is easy for ${level} ` +
        `to understand, keeping the original meaning. Use short sentences and everyday words. ` +
        `If the photo has no readable text, say so plainly instead of guessing.`,
    },
    { type: 'image', data: base64Image, mime_type: mimeType },
  ];

  const interaction = await callGemini({ input });
  return extractText(interaction);
}

// ---------- Core feature 5: read text straight from an uploaded document ----------
// Mirrors simplifyFromImage() just above: Gemini reads documents (PDFs)
// natively, so this sends the file straight to the API and asks it to read
// AND simplify in one pass — no local text-extraction step needed. See
// NewSessionScreen.js / SessionScreen.js's "Choose file" flow: a picked
// PDF goes through this function, while a picked .txt/.md file is read
// locally instead and sent through simplifyText() above, since there's
// nothing for Gemini to gain from being handed a file it would just decode
// back to the same plain text.

export async function simplifyFromDocument(base64Data, mimeType, level = 'a 10-year-old reader') {
  const input = [
    {
      type: 'text',
      text:
        `Read the text in this document. Then rewrite it so it is easy for ${level} ` +
        `to understand, keeping the original meaning and key facts. Use short sentences ` +
        `and everyday words. If the document has no readable text, say so plainly instead of guessing.`,
    },
    { type: 'document', data: base64Data, mime_type: mimeType },
  ];

  const interaction = await callGemini({ input });
  return extractText(interaction);
}

// ---------- A student-directed alternative to the simplify default ----------
//
// simplifyFromImage()/simplifyFromDocument() above run exactly one fixed
// action — "read this and rewrite it to my level" — the instant a photo or
// PDF is attached, with no way for the student to ask for anything else
// instead (translate it, just check the grammar, answer one specific
// question about it, and so on). AttachmentInstructionModal.js is what
// gives them that choice in the UI (mirroring the PDF reader's own
// selection-action menu, which already offers a default action alongside a
// free-text instruction — see SessionScreen.js's customPrompt); these two
// functions are what that modal's "send instead" path calls. `level` is
// kept as light context even here (not just for the default path) so the
// reply's *tone* stays age-appropriate even when its *task*, per the
// student's own instruction, isn't "simplify."
//
// Split into named text-builders (rather than inlined like
// simplifyFromImage/simplifyFromDocument above) because stepsFromMessages()
// further down needs the exact same instruction text again, without the
// image/document bytes, to correctly replay a custom-instruction turn as
// history — same reasoning as simplifyFromImageInstruction() further below.
function imageCustomInstructionText(instruction, level) {
  return (
    `Look at this photo of a page. The student is ${level}, so keep your wording ` +
    `appropriate for them. Do this: ${instruction}\n\n` +
    `Base your answer only on what's actually in the photo — if you can't make out ` +
    `enough of it to do this, say so plainly instead of guessing.`
  );
}

export async function analyzeImageWithInstruction(base64Image, mimeType, instruction, level = 'a 10-year-old reader') {
  const input = [
    { type: 'text', text: imageCustomInstructionText(instruction, level) },
    { type: 'image', data: base64Image, mime_type: mimeType },
  ];

  const interaction = await callGemini({ input });
  return extractText(interaction);
}

function documentCustomInstructionText(instruction, level) {
  return (
    `Look at this document. The student is ${level}, so keep your wording appropriate ` +
    `for them. Do this: ${instruction}\n\n` +
    `Base your answer only on what's actually in the document — if you can't find enough ` +
    `readable content to do this, say so plainly instead of guessing.`
  );
}

export async function analyzeDocumentWithInstruction(base64Data, mimeType, instruction, level = 'a 10-year-old reader') {
  const input = [
    { type: 'text', text: documentCustomInstructionText(instruction, level) },
    { type: 'document', data: base64Data, mime_type: mimeType },
  ];

  const interaction = await callGemini({ input });
  return extractText(interaction);
}

// ---------- Milestone 2: multi-turn chat sessions ----------
//
// The Interactions API offers two ways to keep a conversation going (see
// https://ai.google.dev/gemini-api/docs/interactions/text-generation):
//
//   - Stateful: chain calls with `previous_interaction_id` and let Google's
//     servers hold the history server-side.
//   - Stateless: resend the conversation so far as an array of `steps` in
//     `input`, with `store: false` so nothing is kept server-side at all.
//
// This app uses the stateless approach on purpose, not by default. Gemini
// free-tier interactions are only retained for 1 day server-side (paid
// tier: 55 days — see https://ai.google.dev/gemini-api/docs/interactions-overview).
// This app is built entirely around a student's own free API key, and
// sessions live in Firestore indefinitely and get reopened days or weeks
// later ("Return to the Sessions list... reopening it restores the full
// message history"). Chaining on previous_interaction_id would silently
// start failing (permission_denied) the moment a free-tier interaction
// aged out — exactly the kind of bug that wouldn't show up in a same-day
// demo but would break the very first time someone revisits an old
// session. Resending history from Firestore's own message log sidesteps
// that entirely, and it's also what's already stored for the chat UI, so
// there's no extra bookkeeping to keep in sync.

// Reconstructs the exact instruction text simplifyText() sends, so that
// when a session's first turn is replayed as history for a follow-up call,
// it matches what actually produced the first reply.
function simplifyInstruction(text, level) {
  return (
    `Rewrite the following passage so it is easy for ${level} to understand. ` +
    `Keep the original meaning and key facts. Use short sentences and everyday words. ` +
    `If you must keep a hard word, add a tiny explanation in parentheses right after it. ` +
    `Return only the rewritten passage, no preamble.\n\n"""${text}"""`
  );
}

// Same idea for simplifyFromImage()'s instruction text (minus the image
// itself — see the note in stepsFromMessages() below on why the raw photo
// isn't resent on every follow-up).
function simplifyFromImageInstruction(level) {
  return (
    `Read the text in this photo of a page. Then rewrite it so it is easy for ${level} ` +
    `to understand, keeping the original meaning. Use short sentences and everyday words. ` +
    `If the photo has no readable text, say so plainly instead of guessing.`
  );
}

// Same idea again for simplifyFromDocument()'s instruction text (minus the
// file itself — same reasoning, see stepsFromMessages() below).
function simplifyFromDocumentInstruction(level) {
  return (
    `Read the text in this document. Then rewrite it so it is easy for ${level} ` +
    `to understand, keeping the original meaning and key facts. Use short sentences ` +
    `and everyday words. If the document has no readable text, say so plainly instead of guessing.`
  );
}

// A session's title (see generateSessionTitle() below, and the manual
// rename in SessionScreen.js) and reading level are folded into every
// system instruction — a small, stable anchor for "what are we reading"
// that survives even once older turns get condensed into a running summary
// (see buildContextSteps() below) and are no longer shown in full.
function buildSystemInstruction(session) {
  return (
    'You are Reading Mate, a friendly reading companion inside a reading app for a student. ' +
    'Keep replies encouraging, clear, and matched to the reading level already established in ' +
    'this conversation. When asked to quiz the student, follow the requested format exactly.\n\n' +
    `Reading session: "${session.title || 'New reading session'}" (level: ${session.level}). ` +
    'Treat this as the durable anchor for what "this passage" or "this session" refers to — ' +
    'especially important once earlier turns have been summarized rather than shown in full.'
  );
}

// A quiz message's `content` is an array of question objects (see
// QUIZ_SCHEMA above). For conversation history we don't want the model
// imitating that JSON shape back at us, so quiz turns get flattened to a
// short plain-text summary instead.
function quizToPlainText(questions) {
  return (questions || [])
    .map((q, i) => `Q${i + 1}: ${q.question} (correct answer: ${q.options?.[q.correctIndex]})`)
    .join('\n');
}

// A `type: 'selection'` message's `content` is the structured object the
// PDF reader posts (see PdfReader.js / SessionScreen.js) —
// { selectionText, pageIndex, action, customInstruction }, not a plain
// string. Anywhere a message gets flattened to text for the model (history
// resent on a follow-up, or folded into the running summary) needs a
// defined plain-text form for that shape, same as quizToPlainText() above
// does for quiz turns — without this, `String(message.content)` on an
// object silently sends the model the literal text "[object Object]".
const ACTION_LABELS = {
  define: 'asked to define',
  explain: 'asked to explain',
  simplify: 'asked to simplify',
  quiz: 'asked to be quizzed on',
  custom: 'asked, with a custom instruction, about',
};

function selectionToPlainText(content) {
  const label = ACTION_LABELS[content?.action] || 'selected';
  const page = content?.pageIndex ? ` (page ${content.pageIndex})` : '';
  const extra = content?.action === 'custom' && content?.customInstruction
    ? ` — "${content.customInstruction}"`
    : '';
  return `Student ${label}${page} this passage: """${content?.selectionText || ''}"""${extra}`;
}

// Turns a session's stored Firestore messages into the `steps` array the
// Interactions API expects for stateless multi-turn input (one step per
// past turn, ending right before the new follow-up, which callers append
// themselves). `session` only needs `level`; `messages` is the array
// already stored on the session doc, in order.
function stepsFromMessages(session, messages) {
  return messages.map((message, index) => {
    const stepType = message.role === 'model' ? 'model_output' : 'user_input';

    if (message.type === 'image') {
      // Don't resend the raw photo on every follow-up call — the very next
      // message (the simplified transcription, or the custom-instruction
      // reply) already carries the content that matters for later context,
      // and photos can be large enough that resending them every turn would
      // bloat payload size and cost for no real benefit.
      //
      // A message attached via AttachmentInstructionModal.js's "send
      // instead" path carries a `customInstruction` the student typed
      // themselves, rather than having gone through the simplify default —
      // replay the exact instruction text that actually produced the
      // reply (imageCustomInstructionText(), same helper the live call
      // used), not the default's, or a reopened session's history would
      // silently misrepresent what was actually asked.
      const instructionText = message.content?.customInstruction
        ? imageCustomInstructionText(message.content.customInstruction, session.level)
        : simplifyFromImageInstruction(session.level);
      return {
        type: stepType,
        content: [{ type: 'text', text: instructionText }],
      };
    }

    if (message.type === 'file') {
      // Same reasoning as the image case just above, for uploaded PDFs.
      const instructionText = message.content?.customInstruction
        ? documentCustomInstructionText(message.content.customInstruction, session.level)
        : simplifyFromDocumentInstruction(session.level);
      return {
        type: stepType,
        content: [{ type: 'text', text: instructionText }],
      };
    }

    if (index === 0 && message.role === 'user') {
      return {
        type: stepType,
        content: [{ type: 'text', text: simplifyInstruction(message.content, session.level) }],
      };
    }

    if (message.type === 'quiz') {
      return { type: stepType, content: [{ type: 'text', text: quizToPlainText(message.content) }] };
    }

    if (message.type === 'selection') {
      return { type: stepType, content: [{ type: 'text', text: selectionToPlainText(message.content) }] };
    }

    return { type: stepType, content: [{ type: 'text', text: String(message.content) }] };
  });
}

// ---------- Keeping context correct as a session grows (§5 of the M2
// continuation brief) ----------
//
// stepsFromMessages() above resends a session's *entire* stored history on
// every follow-up, which is the right call for a short session (see the
// big comment block above it) but doesn't scale forever: uploads-in-session
// (see services/uploads.js / SessionScreen.js) mean conversations can now grow
// larger and more often, and every follow-up resending the whole thing
// means payload size, latency, and cost all grow with it, unbounded.
//
// The strategy: once a session passes SUMMARY_TRIGGER_MESSAGES, everything
// older than the most recent MAX_VERBATIM_MESSAGES gets collapsed into a
// short running summary instead of being resent turn-by-turn. That summary
// is itself incremental — each refresh folds only the *new* older messages
// since the last refresh into the previous summary text, rather than
// re-summarizing the whole growing history from scratch, so the
// summarization call's own input stays small no matter how long the
// session eventually gets. And it's not refreshed on every single new
// turn — SUMMARY_REFRESH_INTERVAL lets a handful of turns pass between
// refreshes, since a summary that's a few turns stale is still far more
// useful than paying for a fresh one every time.
//
// The most recent MAX_VERBATIM_MESSAGES messages are always kept
// word-for-word (never summarized) for conversational coherence — a
// student asking "what did you mean by that?" needs the literal previous
// reply, not a paraphrase of it.
//
// The summary cache is in-memory only (keyed by session id), not persisted
// to Firestore — it's a request-shaping optimization, not new data the app
// needs to remember, and this app already has no backend server to hold it
// server-side either. A cold app start just recomputes it the first time a
// session crosses the threshold again, which is cheap relative to what it's
// saving.

const MAX_VERBATIM_MESSAGES = 16; // ~8 turns kept exactly as they were
const SUMMARY_TRIGGER_MESSAGES = 24; // below this, resend everything verbatim (unchanged behavior)
const SUMMARY_REFRESH_INTERVAL = 6; // don't recompute the summary on every single new turn

const summaryCache = new Map(); // sessionId -> { summarizedCount, summaryText }

// Flattens messages to plain "Speaker: text" lines for the summarizer
// prompt below. Images and files are described, never resent as bytes —
// same rule stepsFromMessages() applies for regular context-building.
function messagesToPlainText(messages) {
  return messages
    .map((message) => {
      const speaker = message.role === 'user' ? 'Student' : 'Reading Mate';
      if (message.type === 'image') {
        return message.content?.customInstruction
          ? `${speaker}: [uploaded a photo of a page — asked: "${message.content.customInstruction}"]`
          : `${speaker}: [uploaded a photo of a page]`;
      }
      if (message.type === 'file') {
        return message.content?.customInstruction
          ? `${speaker}: [uploaded a document — asked: "${message.content.customInstruction}"]`
          : `${speaker}: [uploaded a document]`;
      }
      if (message.type === 'quiz') return `${speaker}: [gave a quiz]\n${quizToPlainText(message.content)}`;
      if (message.type === 'selection') return `${speaker}: ${selectionToPlainText(message.content)}`;
      return `${speaker}: ${message.content}`;
    })
    .join('\n');
}

// One lightweight, standalone Gemini call (same shape as generateSessionTitle
// below) that folds `newMessages` into `previousSummary`, producing an
// updated running summary. Called by getRunningSummary(), never directly.
async function summarizeForContext(previousSummary, newMessages) {
  const newText = messagesToPlainText(newMessages);
  const prompt = previousSummary
    ? `Here is a running summary of a reading session so far:\n"""${previousSummary}"""\n\n` +
      `Here is what was said next:\n"""${newText}"""\n\n` +
      `Write an updated running summary of the whole conversation so far, in 4-6 short sentences. ` +
      `Keep any facts, names, or numbers a later follow-up question might need. ` +
      `Return only the updated summary, no preamble.`
    : `Here is the start of a reading session conversation between a student and Reading Mate, ` +
      `an AI reading companion:\n"""${newText}"""\n\n` +
      `Write a short running summary of it in 4-6 sentences, keeping any facts, names, or numbers ` +
      `a later follow-up question might need. Return only the summary, no preamble.`;

  const interaction = await callGemini({ input: prompt });
  return extractText(interaction);
}

// Returns the running summary for everything in `olderMessages`, refreshing
// it (incrementally — see summarizeForContext above) only if more than
// SUMMARY_REFRESH_INTERVAL new older-messages have accumulated since the
// last refresh; otherwise reuses the cached text as-is.
async function getRunningSummary(sessionId, olderMessages) {
  const cached = summaryCache.get(sessionId);
  const alreadySummarized = cached?.summarizedCount || 0;

  if (cached && olderMessages.length - alreadySummarized < SUMMARY_REFRESH_INTERVAL) {
    return cached.summaryText;
  }

  const newMessages = olderMessages.slice(alreadySummarized);
  const summaryText = await summarizeForContext(cached?.summaryText, newMessages);
  summaryCache.set(sessionId, { summarizedCount: olderMessages.length, summaryText });
  return summaryText;
}

// The actual replacement for a plain stepsFromMessages() call in the
// functions below — same output shape (a `steps` array), but summarized
// once a session has grown past SUMMARY_TRIGGER_MESSAGES.
async function buildContextSteps(session, messages) {
  if (messages.length <= SUMMARY_TRIGGER_MESSAGES) {
    return stepsFromMessages(session, messages);
  }

  const olderMessages = messages.slice(0, messages.length - MAX_VERBATIM_MESSAGES);
  const recentMessages = messages.slice(-MAX_VERBATIM_MESSAGES);
  const summaryText = await getRunningSummary(session.id, olderMessages);

  const summaryStep = {
    type: 'user_input',
    content: [
      {
        type: 'text',
        text: `[Summary of the earlier part of this reading session, before the messages below:]\n${summaryText}`,
      },
    ],
  };

  return [summaryStep, ...stepsFromMessages(session, recentMessages)];
}
// `priorMessages` is everything in the session BEFORE this follow-up;
// `followUpText` is the new question. Every follow-up is sent with the full
// accumulated conversation as context — that's the core of Milestone 2.

export async function continueConversation(session, priorMessages, followUpText) {
  const steps = await buildContextSteps(session, priorMessages);
  steps.push({ type: 'user_input', content: [{ type: 'text', text: followUpText }] });

  const interaction = await callGemini({
    input: steps,
    store: false,
    systemInstruction: buildSystemInstruction(session),
  });
  return extractText(interaction);
}

function parseQuizResponse(interaction) {
  const raw = extractText(interaction);
  try {
    const parsed = JSON.parse(raw);
    return parsed.questions || [];
  } catch {
    throw new GeminiError('Gemini returned a quiz in an unexpected format. Try again.');
  }
}

// ---------- Core feature 6: a quiz grounded in the whole conversation ----------
// Like generateQuiz(), but triggered mid-conversation from the "Quiz me"
// action in the chat — grounded in everything discussed so far, not just
// the original passage.

export async function continueConversationQuiz(session, priorMessages, numQuestions = 3) {
  const steps = await buildContextSteps(session, priorMessages);
  steps.push({
    type: 'user_input',
    content: [
      {
        type: 'text',
        text: `Quiz me with ${numQuestions} multiple-choice questions on everything we've covered so far in this conversation.`,
      },
    ],
  });

  const interaction = await callGemini({
    input: steps,
    responseFormat: { type: 'text', mime_type: 'application/json', schema: QUIZ_SCHEMA },
    store: false,
    systemInstruction: buildSystemInstruction(session),
  });
  return parseQuizResponse(interaction);
}

// ---------- PDF reader pivot: one flexible, conversation-grounded ----------
// ---------- selection action (§4.4 of the PDF-Native Reader Pivot plan) ----
//
// Explain / Simplify / "Quiz me on this" / a custom instruction, all
// triggered by selecting text in the WebView reader (PdfReader.js), route
// through here instead of a one-shot call. Deliberately built on the exact
// same buildContextSteps()/buildSystemInstruction() pipeline
// continueConversation() uses just above, not a fresh ungrounded prompt —
// the whole point is that "Explain this" on page 12 can reference
// something the student asked about on page 3.
//
// Single-word "Define" taps do NOT go through this function — those stay
// on the existing ungrounded explainWord() path (see SessionScreen.js),
// fast and ephemeral, not logged to the session. Everything else here
// (explain/simplify/quiz/custom on a selection) is substantive enough to
// log as a normal { role, type: 'selection', content } / model-reply pair
// in the session's message list — see §6's data model and ChatBubble.js's
// selection-chip rendering.
//
// pageContext is truncated, not resent in full — a whole dense textbook
// page easily runs to several thousand characters, and the selection text
// itself is almost always what actually needs grounding; the surrounding
// page just disambiguates "this" versus quoting the whole page back at
// the model on every single selection.
const MAX_PAGE_CONTEXT_CHARS = 1500;

function truncateForContext(text) {
  if (!text || text.length <= MAX_PAGE_CONTEXT_CHARS) return text || '';
  return `${text.slice(0, MAX_PAGE_CONTEXT_CHARS)}…`;
}

function buildSelectionFollowUpText({ selectionText, pageIndex, pageContext, action, customInstruction }) {
  const pageNote = pageIndex ? ` (page ${pageIndex})` : '';
  const contextNote = pageContext
    ? ` For context, here is surrounding text from the same page: """${truncateForContext(pageContext)}"""`
    : '';

  switch (action) {
    case 'simplify':
      return (
        `Simplify this passage${pageNote} from the document I'm reading: """${selectionText}""".` +
        `${contextNote} Rewrite it in short sentences and everyday words, keeping the original meaning.`
      );
    case 'quiz':
      return (
        `Quiz me with 2-3 short questions (with answers) about this passage${pageNote} from the ` +
        `document I'm reading: """${selectionText}""".${contextNote}`
      );
    case 'custom':
      return (
        `About this passage${pageNote} from the document I'm reading: """${selectionText}""".` +
        `${contextNote} ${customInstruction || 'Tell me more about it.'}`
      );
    case 'explain':
    default:
      return (
        `Explain this passage${pageNote} from the document I'm reading: """${selectionText}""".` +
        `${contextNote} Give a short, clear explanation.`
      );
  }
}

export async function runSelectionAction(session, priorMessages, options) {
  const { selectionText, pageIndex, pageContext, action, customInstruction } = options;
  const steps = await buildContextSteps(session, priorMessages);
  const followUpText = buildSelectionFollowUpText({
    selectionText,
    pageIndex,
    pageContext,
    action,
    customInstruction,
  });
  steps.push({ type: 'user_input', content: [{ type: 'text', text: followUpText }] });

  const interaction = await callGemini({
    input: steps,
    store: false,
    systemInstruction: buildSystemInstruction(session),
  });
  return extractText(interaction);
}


// Companion to explainWord() above: selecting more than one word (see
// TappableText's tap-to-select-and-expand UI) explains that whole
// selection instead of a single word. This is a standalone popup like the
// word-definition one, not part of the conversation thread.

export async function explainSentence(selection, context = '') {
  const prompt =
    `Explain this passage the way you would to a curious kid: """${selection}""" ` +
    (context ? `It was selected from this larger passage: """${context}""". ` : '') +
    `Give a short, clear explanation in 1-2 sentences. Return only that, no preamble.`;

  const interaction = await callGemini({ input: prompt });
  return extractText(interaction);
}

// ---------- Core feature 8: a short AI-generated session title ----------

export async function generateSessionTitle(passageOrSummary) {
  const prompt =
    `Write a short 3-6 word title summarizing what this passage/conversation is about. ` +
    `Return only the title itself — no quotes, no trailing punctuation, no preamble.\n\n"""${passageOrSummary}"""`;

  const interaction = await callGemini({ input: prompt });
  return extractText(interaction).trim();
}

// ---------- Core feature 9: a one-line recap for reopening after a gap ----------
// See SessionScreen.js — shown once, above the resumed conversation, when a
// session is reopened after a day or more away. Same "short prompt against
// existing text" shape as generateSessionTitle() just above.

export async function generateSessionRecap(passageOrSummary) {
  const prompt =
    `In one short, warm sentence starting with "Last time, you were reading about", summarize ` +
    `what this reading session has covered so far, as a bookmark reminder for returning to it. ` +
    `Return only that one sentence, no preamble.\n\n"""${passageOrSummary}"""`;

  const interaction = await callGemini({ input: prompt });
  return extractText(interaction).trim();
}

export { GeminiError };
