# Nova Architect — Voice Guide

## Getting Started with Voice

1. Click the **mic button** (left side of input bar)
2. Button turns green with pulsing border — recording active
3. Speak your instruction
4. Click mic again to stop
5. Confirmation appears: "Send: your instruction?" → Execute

---

## Voice vs Text

| Feature | Voice | Text (typed) |
|---------|-------|------|
| Input method | Mic button → speak → mic button | Type in input bar → Enter |
| Confirmation to send | Yes (can review transcript) | Configurable |
| Task execution confirmation | Yes | Configurable |
| Language support | 16 languages | Any |
| Best for | Hands-free, quick descriptions | Precise technical terms |

---

## Language Selection

Click the **language button** (right side of input bar, shows "Auto" by default).

### Supported Languages

| Code | Language | Button Label |
|------|----------|:---:|
| (empty) | Auto-detect | Auto |
| en-US | English | EN |
| ru-RU | Russian | RU |
| de-DE | German | DE |
| fr-FR | French | FR |
| es-ES | Spanish | ES |
| uk-UA | Ukrainian | UA |
| ja-JP | Japanese | JP |
| zh-CN | Chinese | ZH |
| ko-KR | Korean | KO |
| pt-BR | Portuguese | PT |
| it-IT | Italian | IT |
| pl-PL | Polish | PL |
| nl-NL | Dutch | NL |
| tr-TR | Turkish | TR |
| ar-SA | Arabic | AR |
| hi-IN | Hindi | HI |

Language choice is saved in localStorage — persists across reloads and sessions.

### Auto-detect vs Fixed Language

- **Auto** — browser guesses the language. Works well for common languages but can confuse similar ones (e.g. Russian/Ukrainian).
- **Fixed** — set a specific language for better accuracy. Especially useful if you mix languages (e.g. Russian speech with English technical terms).

---

## Gesture Mode

Combine voice with cursor pointing for precise element targeting.

### Enable

- Press **Option+G** or select from star menu
- Indicator shows "Gesture Mode ON"

### How It Works

1. Start voice recording (mic button)
2. Point cursor at an element
3. Say "make **this** button bigger"
4. Nova matches "this" with the element under your cursor

### Detected Gestures

| Gesture | How | Use Case |
|---------|-----|----------|
| **Dwell** | Hover on element for 500ms+ | "Change **this** color" |
| **Path** | Move cursor from A to B | "Move **this** to **there**" |
| **Circle** | Draw circle around elements | "Update everything **here**" |

### Trigger Words

Nova links gestures to specific words in your speech:

**English:** this, that, here, there, these, those
**Russian:** этот, эта, это, тут, здесь, сюда, вот, там, туда

### Tips

- Gesture Mode works best when voice is active (recording)
- Point **before** you say the deictic word — Nova uses a 200ms window
- For complex layouts, use Quick Edit (Option+I) instead — more precise

---

## Voice + Quick Edit

You can speak inside the Quick Edit popup:

1. Press Option+I, click an element
2. Popup appears with text field and mic button
3. Click mic in the popup → speak your edit
4. Transcript fills the text field
5. Click Execute

This is useful for hands-free element-by-element editing.

---

## Voice Engine Options

### Web Speech API (default)

```toml
[voice]
engine = "web"
```

- Uses browser's built-in speech recognition
- **Chrome recommended** — best accuracy and stability
- Requires internet connection
- Free

### Whisper (local)

```toml
[voice]
engine = "whisper"
```

- Uses Whisper model via Ollama
- Runs completely locally — no internet needed
- Requires: `ollama serve` running with a Whisper model
- Free, private

---

## Voice Workflow Tips

### Accumulating Speech

When recording, Nova accumulates all speech into one transcript. You can pause and continue — it all gets merged:

```
"add a navigation bar..."
(pause)
"...with home, about, and contact links..."
(pause)
"...and make it sticky at the top"
```

All three parts become one instruction.

### Refining Before Sending

After stopping mic, the confirmation shows your full transcript. You can:
1. **Edit** the text in the input bar before confirming
2. **Cancel** and try again
3. **Execute** as-is

### Appending to Pending Tasks

If tasks are already pending (waiting for confirmation), speaking again **appends** to the original request:

```
You: "Add a contact form"
Nova: "2 tasks ready. Execute?"
You: "Also add email validation"
Nova: (re-analyzes with both requirements)
Nova: "3 tasks ready. Execute?"
```

### Revert by Voice

Say "revert" or "undo" — works in English and Russian:
- `откати` (roll back)
- `верни назад` (return back)
- `отмени последнее` (undo last)

---

## Troubleshooting

### "No speech detected"

- Check mic permissions in browser (Settings → Site Settings → Microphone)
- Try a different browser (Chrome recommended)
- Make sure no other app is using the mic

### Wrong language detected

- Switch from "Auto" to a specific language
- Speak clearly and avoid mixing languages in one sentence

### Transcript cuts off mid-sentence

Web Speech API has timeout limits. For long instructions:
- Break into shorter sentences with pauses
- Or type the instruction instead

### Mic button doesn't respond

- Reload the page
- Check if another Nova tab is using the mic
- Try closing and reopening the browser
