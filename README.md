# Reading Mate

An AI reading companion, built with Expo / React Native. Paste in a passage, snap a photo of a page, or upload a PDF — pick a reading level, and Reading Mate helps you work through it: a real reader for the PDF itself (selectable text, explain/simplify/quiz on anything you select), a rewritten, easier-to-read version for pasted text and photos, and either way a chat-style tutor sticking around afterward — answering follow-ups, explaining words on tap, quizzing you, reading aloud, and tracking your progress over time.

There is no backend server. The app talks directly to Google's Gemini API from the device, using a free API key the user supplies themselves in Settings, and stores everything else (accounts, sessions, progress) in Firebase.

## Core features

- **Start a session from anything** — paste/type text, snap a photo of a page, pick a photo from the library, or upload a `.pdf`/`.docx`/`.txt`/`.md` file.
- **A real PDF reader, not just a chat about one** — upload a PDF and it opens as an actual document: true-to-original page rendering, pinch-zoom, page navigation, and real text selection (not a tap-by-tap workaround). Select any text and a menu pops up — Define, Explain, Simplify, Quiz me on this, or a custom instruction — grounded in the whole conversation so far, not a one-off lookup. A scanned/image-only page gets read via Gemini's vision instead of failing silently. Opening a PDF makes zero AI calls until you actually select something.
- **Rewritten passages for text and photos** — pasted text goes through Reading Mate's original flow: rewritten to the chosen level, then a normal chat about that rewrite. A photo or PDF gets one extra beat first: after picking it, a prompt asks what to do with it — a one-tap "Simplify to my level" default, or your own instruction instead ("translate this," "just check my grammar," a specific question) — since a photo doesn't always mean "simplify this."
- **Three reading levels** — Beginner / Intermediate / Advanced, each mapped to an age-based persona ("a 7-year-old beginner reader," etc.) baked into the AI prompts.
- **Conversational follow-ups** — every reply is grounded in the full conversation so far, whether that conversation started from a rewritten passage or a PDF selection.
- **Quiz me** — a 4-option multiple-choice comprehension quiz, either on the original passage/conversation, on a specific selection from a PDF, or on an entire PDF document (read locally, no re-upload needed) — scored inline with correct/incorrect feedback and haptics.
- **Tap-to-explain** — tap a word to select it, use the arrows to grow the selection to a phrase or sentence, then hit Define/Explain for a kid-friendly explanation. Single words can be marked "Got it!" and saved to your learned-words list.
- **Vocabulary spaced repetition** — every word you mark "Got it!" enters a simple SM-2-style review schedule; the Progress tab surfaces what's due and runs a quick flashcard review.
- **Re-read for me (voice)** — while the text is being read aloud, select a word or sentence you didn't understand and tap *Re-read for me*: the narration pauses, the selection is read again slowly, a plain-language explanation (based on the text around it) is shown and spoken, and *Continue reading* resumes from the start of the interrupted sentence.
- **Listen on loop** — select a word or phrase you couldn't catch and tap *Loop* (in the PDF reader: *Listen on loop*): it repeats aloud until you stop it, with a *Slow* switch, an *Explain it* shortcut, and *Continue reading* to resume the narration from the start of the interrupted sentence.
- **Read aloud** — text-to-speech on any passage, reply, or PDF page, with a live word-by-word highlight synced to the audio (in the PDF reader, right on the rendered page's own text).
- **Bookmarks** — star a passage, a reply, or a PDF page itself to save it for later; browse everything you've bookmarked, across sessions, from the Progress tab — tapping one jumps straight back to that spot.
- **Progress tracking** — daily streak, passages read, words learned (plus what's due for review), and recent quiz scores. If your last 3 quiz scores at your current level average above 80%, the app nudges you to try the next level up.
- **Multi-device sync** — sign in with email/password (Firebase Auth) and your sessions, progress, Gemini key, and appearance preferences follow you to any device.
- **Appearance** — System/Light/Dark theme plus a separate small/medium/large reading-text-size control, both synced to your account.
- **Bring your own (free) Gemini key** — no credit card, no shared backend cost; each user's key lives in their own Firestore profile, never hard-coded in the app.

## How a session works (user's perspective)

1. **Home tab** — a "Start reading" button, plus a "Continue reading" card for whatever session was most recently active.
2. **New reading session** — pick a level, then paste text, snap/choose a photo, or choose a file.
   - **A PDF** opens straight into the reader (below) — nothing rewritten, no AI call made yet.
   - **Pasted text, a photo, or a `.txt`/`.md` file** get simplified to the chosen level first, then drop you into the chat session below with that rewrite as the starting point.
3. **Session screen** — one of two shapes, depending on how the session started:
   - **Reader mode (PDF):** the actual document renders at the top — pinch to zoom, swipe between pages. Select any text and a menu appears: Define, Explain, Simplify, Quiz me on this, or type your own instruction. Explanations and simplifications get logged below as part of the conversation, so later selections can reference earlier ones. A small toolbar reads the current page aloud (with the spoken word highlighted right on the page) and bookmarks it.
   - **Chat mode (everything else):** the simplified passage renders in a page-like "reading pane" (serif type, near full width) at the top. Everything after that — your questions, Reading Mate's answers, quizzes — renders as chat bubbles below it, and you can attach another photo or file mid-conversation at any time.
   - Both modes share the same bottom bar: a row of quick actions ("Quiz me," "Explain this part," "Give an example," "Recap so far" — reader mode adds "Quiz whole document") above a normal text input for anything else.
4. **Sessions list** — every session you've started, searchable by title once you have more than a few, each showing a preview (the passage, or the PDF's filename for a reader-mode session) and reading level. Reopening one restores the full history; a chat-mode session returning after a day or more away also shows a small "Last time, you were reading about…" banner.
5. **Progress tab** — streak, passage count, words you've marked learned (plus what's due for spaced-repetition review), and your saved bookmarks.
6. **Settings** — paste your free Gemini API key, choose your theme, and sign out.

## Tech stack

- **Expo SDK 57**, React Native 0.86, React 19
- **React Navigation** — bottom tabs (Home / Read / Progress / Settings) with a small native-stack inside the Read tab (Sessions list → New session → Session)
- **Firebase JS SDK v12** (the pure-JS `firebase` package, *not* `@react-native-firebase/*`) for Auth and Firestore — chosen specifically because it runs in Expo Go with no native build step
- **A small Cloudflare Worker in front of a private Backblaze B2 bucket** for photo/PDF uploads (Firebase Storage now requires a paid plan; see "Architecture notes" below)
- **Google Gemini API** (`gemini-3.5-flash`), called directly from the client over REST via the `v1beta/interactions` endpoint — no backend server
- **`react-native-webview`** + **PDF.js** (loaded from cdnjs at runtime, not bundled) — the PDF reader's actual rendering engine; see `src/services/pdfReaderHtml.js`'s header comment for why it's an ES-module CDN import with the worker disabled rather than a bundled dependency
- `expo-speech` (read aloud), `expo-image-picker` / `expo-document-picker` / `expo-file-system` (attachments), `expo-haptics` (quiz feedback)
- A custom "reading lamp" design system: Lora (serif, for reading text) + Inter (sans, for UI), with matching light/dark palettes

## Architecture notes

**No backend, by design.** Every AI call in `src/services/gemini.js` goes straight from the device to Gemini using the signed-in user's own API key (cached in memory, synced from `users/{uid}.geminiApiKey` in Firestore — see `src/services/storage.js` and `AuthContext.js`). Firestore Security Rules (at the project root) keep one user's Firestore data private from another; the small Cloudflare Worker in `worker/` plays the equivalent role for uploaded photos/PDFs, since there's no server in between otherwise to enforce either.

**Conversation history is resent, not chained.** Gemini's Interactions API supports server-side chaining via `previous_interaction_id`, but free-tier interactions are only retained server-side for 1 day, while sessions in this app live in Firestore indefinitely and can be reopened weeks later. So every follow-up call resends the conversation as a stateless `steps` array (`store: false`), rebuilt from the messages already stored in Firestore. See the large comment block above `stepsFromMessages()` in `gemini.js` for the full reasoning.

**Long sessions get summarized, not truncated.** Once a session passes 24 messages, everything older than the most recent 16 is collapsed into a short AI-generated running summary instead of being resent verbatim — refreshed incrementally every few turns, not recomputed from scratch each time. This keeps payload size (and cost) from growing unbounded as a session gets longer. See `buildContextSteps()` / `getRunningSummary()` in `gemini.js`.

**Photos and PDFs go to Backblaze B2 through a Cloudflare Worker, not inline into Firestore.** A Firestore document is capped at 1 MiB, and sessions can now gain attachments throughout their life (not just at creation), so uploads go to a private B2 bucket (`users/{uid}/sessions/{sessionId}/{messageId}.ext`), and only a download URL + path are written to the message. The Worker (`worker/`) is what enforces that a signed-in user can only read/write their own uid's files — B2 itself has no equivalent of Firebase's `storage.rules`. Older recorded sessions may still have the original inline-base64 shape; rendering code supports both. See `src/services/uploads.js` and `worker/src/index.js`.

**A PDF renders as-is; everything else gets rewritten.** The two entry points are deliberately different shapes, not one flow with a toggle: a multi-page PDF has real layout worth preserving (see `src/services/pdfReaderHtml.js`), while a pasted paragraph or a single photographed page doesn't, so rewrite-then-chat is still the right treatment for those. A session's Firestore doc gets a `mode: 'reader'` field only for the PDF path — every other session simply has no `mode` field at all, read everywhere as `'chat'`, so nothing about existing sessions or the non-PDF entry points changed shape. Opening a reader-mode session makes zero Gemini calls; the model is only ever called once the student selects something (`src/services/gemini.js`'s `runSelectionAction()`, sharing the same conversation-grounded pipeline `continueConversation()` uses — an "Explain this" on page 12 can reference something asked about on page 3). Single-word "Define" taps stay on the older, ungrounded, unlogged `explainWord()` popup rather than being folded into the conversation log — logging every vocabulary lookup would bury real conversation in noise within a page or two of a dense chapter.

## Data model (Firestore)

```
users/{uid}
  geminiApiKey, themeMode, readingFontSize, createdAt

users/{uid}/sessions/{sessionId}
  title, level, createdAt, updatedAt
  mode: 'reader' | absent (== 'chat')             // reader-mode (PDF) sessions only
  sourceFile: { storagePath, name, mimeType, pageCount } | absent   // reader-mode only
  messages: [{ role: 'user' | 'model', type: 'text' | 'image' | 'file' | 'quiz' | 'selection', content, timestamp }]
  // image/file content: { url, storagePath, mimeType, name? } (Storage-backed)
  // selection content: { selectionText, pageIndex, action, customInstruction } — logged
  //   from the PDF reader's selection-action menu (explain/simplify/quiz/custom only;
  //   single-word "Define" stays an ephemeral, unlogged popup — see architecture notes)

users/{uid}/progress/summary
  streak, passagesRead, lastReadDate, wordsLearned: string[]
  vocabSchedule: { [word]: { word, definition, ease, intervalDays, reps, createdAt, lastReviewedAt, dueAt } }
  recentQuizScores: [{ level, score, timestamp }]

users/{uid}/bookmarks/{bookmarkId}
  sessionId, sessionTitle, text, timestamp
  messageIndex? | pageIndex?   // exactly one — a message-log turn, or a PDF page itself
```

Every Firestore path is scoped to `request.auth.uid == userId` by `firestore.rules`. Uploaded photos/PDFs are scoped the same way — one signed-in user can only touch their own files — by the Cloudflare Worker in `worker/`, which additionally requires uploads to be an image or PDF under 15 MB. `firestore.rules` didn't need changes for the reader-mode fields above — it already scopes everything under `users/{uid}/**`.

## Project structure

```
App.js                      Navigation shell (tabs + stacks), font loading, theme wiring
index.js                    Expo entry point

src/
  screens/
    AuthScreen.js            Sign in / sign up / forgot password
    HomeScreen.js             Landing tab: hero, "continue reading," feature grid
    SessionsListScreen.js    List of all reading sessions, searchable
    NewSessionScreen.js      Start a session: level picker + text/photo/file input
    SessionScreen.js         The session UI (largest screen) — branches between reader mode
                              (PDF.js WebView, selection actions) and chat mode (passage pane,
                              follow-ups); both share quiz, attachments, bookmarks, rename, recap
    ProgressScreen.js        Streak/passages/words stats + bookmarks list
    SettingsScreen.js        Gemini API key, appearance, account

  components/
    ReadingPane.js            The passage itself — page-like, distinct from chat bubbles
    PdfReader.js               Reader-mode's WebView wrapper — PDF.js rendering, selection
                                bridge, read-aloud highlight bridge (see services/pdfReaderHtml.js)
    ChatBubble.js              Ordinary chat messages (text/image/file/quiz/selection/typing)
    TappableText.js           Tap-to-select word/phrase toolbar (Define/Explain) — chat mode's
                                proof-of-concept for the reader's selection-action menu
    QuizInline.js              Interactive multiple-choice quiz renderer
    WordExplainModal.js       Popup for a word/sentence definition
    VocabReviewModal.js       Spaced-repetition flashcard review (see services/spacedRepetition.js)
    ImageViewerModal.js       Full-screen photo viewer
    AppearancePicker.js       System/Light/Dark segmented control
    Button.js, ScreenContainer.js   Small shared UI primitives

  services/
    firebase.js                Firebase app/Auth/Firestore init (config + setup notes)
    firestore.js                All Firestore reads/writes (sessions, progress, bookmarks, profile)
    gemini.js                   All Gemini API calls — simplify, explain, quiz, chat, titles,
                                 recaps, and the PDF reader's runSelectionAction()
    pdfReaderHtml.js             Generates the HTML/JS that runs inside PdfReader.js's WebView
                                 (PDF.js page rendering, selection, pinch-zoom, OCR trigger)
    spacedRepetition.js          Pure-function SM-2-lite scheduler for vocabulary review
    uploads.js                   Upload helpers for photos/PDFs (talks to worker/, see below)
    storage.js                   Tiny in-memory cache of the current user's Gemini key

  contexts/
    AuthContext.js              Firebase Auth state + Gemini key, exposed via useAuth()
    ThemeContext.js             Theme mode, palette, reading font size, exposed via useTheme()

  constants/levels.js          The 3 reading levels + adaptive level-up helper
  theme.js                      Design tokens: fonts, spacing, radius, light/dark palettes

firestore.rules                 Firestore security rules (paste into Firebase console — see below)
app.json                        Expo app config
AGENTS.md / CLAUDE.md           Note for AI coding assistants: check versioned Expo SDK 57
                                 docs (docs.expo.dev/versions/v57.0.0) before writing code —
                                 Expo's API has changed since older training data.

worker/                         Cloudflare Worker: gatekeeper in front of the private
                                 Backblaze B2 bucket that holds uploaded photos/PDFs —
                                 verifies Firebase ID tokens, scopes access per-uid,
                                 holds the actual B2 credentials (see its own comments)
```

## Getting started

```bash
npm install
npx expo start
```

Then press `i` / `a` / `w` in the terminal, or scan the QR code with Expo Go.

### Firebase setup (one-time — needs your own Google account)

The app ships pointing at a specific existing Firebase project (see `src/services/firebase.js`); to run your own instance:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (the free Spark plan is enough).
2. **Build → Authentication → Get started** → enable the **Email/Password** sign-in provider.
3. **Build → Firestore Database → Create database** → any region, production mode.
4. In Firestore's **Rules** tab, paste in `firestore.rules` (project root) and publish.
5. **Project settings → General → Your apps → Add app → Web**, register it, and copy the resulting `firebaseConfig` object into `src/services/firebase.js`, replacing the existing values.

### File uploads: Backblaze B2 + Cloudflare Worker setup (one-time)

Firebase Storage isn't used for uploads (see "Architecture notes" above).
Instead, photos/PDFs go to a private Backblaze B2 bucket through a small
Cloudflare Worker. Setting this up needs your own Backblaze and Cloudflare
accounts — neither requires a credit card, as long as you follow the
steps below exactly (specifically: keep the B2 bucket **Private**, not
Public — a Public bucket is the one thing in this whole setup that does
ask for a card).

1. Sign up at [backblaze.com/sign-up/cloud-storage](https://www.backblaze.com/sign-up/cloud-storage).
2. **B2 Cloud Storage → Buckets → Create a Bucket** — any unique name,
   **Privacy: Private**.
3. Note the bucket's **name** and **Bucket ID** from its details page.
4. **Application Keys → Add a New Application Key** — restrict it to the
   one bucket above, **Read and Write** access. Copy the **keyID** and
   **applicationKey** shown (the applicationKey is shown once only).
5. Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
   (Workers itself needs no card).
6. In `worker/`, run `npm install` then `npx wrangler login`.
7. Fill in `B2_BUCKET_NAME`, `B2_BUCKET_ID`, and `FIREBASE_PROJECT_ID` in
   `worker/wrangler.jsonc`.
8. Set the Worker's secrets:
   ```bash
   npx wrangler secret put B2_KEY_ID
   npx wrangler secret put B2_APPLICATION_KEY
   npx wrangler secret put DOWNLOAD_TOKEN_SECRET   # any long random string, e.g. `openssl rand -hex 32`
   ```
9. `npx wrangler deploy` — copy the printed `*.workers.dev` URL into
   `WORKER_BASE_URL` at the top of `src/services/uploads.js`.

### Turning on the AI features

Sign up in the app, then open **Settings** and paste a free Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no credit card required). The key is stored in your Firestore profile and syncs to any device you sign into.

## Known gaps

- Deleting a session removes the Firestore document but does **not** clean up its uploaded files yet — `deleteSessionMedia()` exists in `uploads.js` for exactly this but isn't called anywhere.
- File uploads support PDF, Word (`.docx`, text extracted locally by `src/services/docx.js` — images/styling are dropped) and plain text/Markdown; other formats (`.doc`, `.epub`, etc.) are rejected with a message asking the user to convert or paste instead. A `.docx` goes through the same simplify-then-chat flow as pasted text, not the PDF reader.
- A PDF attached **mid-conversation** in an existing chat-mode session (as opposed to uploaded to start a new session) still opens externally in whatever the OS handles PDFs with — reader mode is a session-created-from-a-PDF thing, not a mid-conversation attachment thing; see "A PDF renders as-is" in Architecture notes above for why that's a deliberate scope line, not an oversight.
- The PDF reader loads PDF.js from cdnjs at runtime rather than bundling it (see `pdfReaderHtml.js`'s header comment) — opening a PDF requires the device to reach `cdnjs.cloudflare.com`, separately from whatever's already required to reach Gemini and Firebase.
- A reader-mode session reopened after time away doesn't show the "Last time, you were reading about…" recap banner chat-mode sessions get — it would need different source material (the PDF itself, not a message) than the current recap logic uses; left as a known gap rather than shipping one that summarizes the wrong thing.
- Two features sketched in planning but not built: quiz analytics broken down by skill (main idea / vocabulary / inference / detail) on the Progress tab, and a voice-based reading-fluency practice mode. The latter specifically needs a dev build (`expo prebuild` + EAS) rather than Expo Go, since on-device speech recognition isn't an Expo-Go-compatible module — a real infrastructure change, flagged rather than done silently.
- No automated test suite is present in this codebase.

## License

MIT (see `LICENSE` — inherited from the Expo project template this app was bootstrapped from).
