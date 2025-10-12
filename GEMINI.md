# System Architecture Instructions

## 1  High‑Level Module Map

```
        ┌──────────────────────────┐
        │  Conversation Manager    │  ⇽ orchestration
        └────────────┬─────────────┘
                     │ holds refs to ⇩
├────────────┐     ┌──────────────────────┐
│  Playback  │ …   │  User‑Input Manager  │
│  Manager   │     │  (text+audio)        │
└────────────┘     └──────────────────────┘
                     │
      ┌──────────────┴──────────────┐
      │  Conversation Network (WS)  │
      └─────────────────────────────┘
```

<details>
<summary>Main components</summary>

- **ConversationManager** - Main entry point - orchestrate all and call callbacks in client consumers that uses the SDK
- **PlaybackManager** - Handles audio playing, avatar manager, subtitles manager
- **UserInputManager** - Handles all inputs such as text, audio and VAD
- **ConversationNetwork** - The underlying network layer that communicates with the backend

<summary>Other support components</summary>

- **AudioRecorder** – captures mic → PCM/OGG chunks.
- **VAD Manager** (MicVAD) – starts/stops AudioRecorder based on speech.
- **AudioPlayer** – queued, gap‑free playback.
- **SubtitleManager** – real‑time word‑level captions.

</details>

---

\## 2  Canonical Turn Sequence

Below is the distilled turn‑by‑turn flow:

1. On first interaction we send a auth message such as
   {
   "type": "request",
   "uid":"566c0ad4-fb5b-488c-b935-73e111092711",
   "kind": "authenticate",
   "access_token": "{{accessToken}}"
   }

1.B. we shall get a similar response with the same uid

2. We then send a set_configuration request
   {
   "type": "request",
   "kind": "set_configuration",
   "uid":"123c0ad4-fb5b-488c-b935-73e111092753",
   "config": {
   "prompt": "What is the meaning of life. explain in up to 2 paragraphs"
   }
   }

3. We send an text message with a simple "." to get a response from the server based on the above prompt

```json
{
  "type": "stream",
  "uid": "116c0ad4-fb5b-488c-b935-73e111092798",
  "kind": "interact",
  "text": ".",
  "audio_output": true
}
```

4. **Waiting for assistant**
   - ConversationManager in **waiting**. Playback Manager animates _body_idle_think_.

5. **Receive assistant response**
6. - On first chunk: `AudioPlayer enqueue`, `Ready event`, `waiting -> playing`.
   - `SubtitleManager` enqueues caption; `PlaybackManager` animates _body_talk_to_user_loop_.
7. **Playback completes**
   - `AudioPlayer` counts down remaining duration - then fires `AboutToComplete` (500ms before ending), then fires `Buffer ended`.
   - network layer should emit `interaction_complete` when all audio / text has sent to the client
   - `playing -> idle`; Avatar returns to _body_idle_.

8. **Idle → Speak detection**
   - `VADManager` initialises
   - `Speech started` → `idle -> userSpeaking`.
   - `AudioRecorder` starts; mic chunks (\~1.9 kB) emitted every \~100 ms.

9. **Streaming to backend**

- `UserInputManager.sendAudio` packages chunk → `ConversationNetwork.send (type: audio)`.
  for example:

```json{
    "type": "request",
    "uid":"321c0ad4-fb5b-488c-b935-73e111092321",
    "kind": "add_audio",
    "config": {"sampling_rate": 48000, "mime_type": "audio/mpeg"},
    "audio": "Uk=="
}
```

1.  **Speech end → send completion**

- `Speech ended` → `userSpeaking -> listening`.
- `ConversationNetwork.send (type: input_complete)`.
  Will send a packet of interact

```json
{
    "type": "stream",
    "uid":"116c0ad4-fb5b-488c-b935-73e111092798",
    "kind": "interact",
    "audio_output": true
}
   - Jump back into 1.

---

\## 4  Event Bus / Callback Contract

| Emitter               | Event                           | Payload                 | Typical Consumer      |
| --------------------- | ------------------------------- | ----------------------- | --------------------- |
| `VADManager`          | `onSpeechStart` / `onSpeechEnd` | _none_                  | `ConversationManager` |
| `AudioRecorder`       | `AUDIO_DATA`                    | `{Uint8Array chunk}`    | `UserInputManager`    |
| `ConversationNetwork` | `OnConversationMessage`         | `{type, data}`          | `ConversationManager` |
| `AudioPlayer`         | `onAudioBufferFinish`           | _void_                  | `PlaybackManager`     |
| `SubtitleManager`     | `onSubtitleChange`              | `{subtitle, wordIndex}` | UI widgets            |

All events are broadcast over an **EventEmitter**

---

\## 5  Design Caveats & Non‑reactive BI Layer

- **No React hooks inside BI** – logging is vanilla JS to minimise React render coupling.
- **PlaybackManager** owns _millisecond‑accurate_ clock; other managers subscribe – avoids drift.

---

\## 6  Appendix B – Glossary

- **Chunk** – a single OGG/Opus frame batch (\~1–2 kB).
- **Cumulative Offset** – running subtitle timeline offset to compensate variable server latency.
- **MicVAD** – tiny inference model running in AudioWorklet; params: `silenceTimeoutMs=300`, `posThresh=0.5`, `negThresh=0.35`, `minSpeechFrames=3`.

---

_Last updated: 2025‑10‑30_
```
