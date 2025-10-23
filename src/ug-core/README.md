# 🚀 UG-Core SDK Documentation

This document provides an overview of the `ug-core` SDK, a framework-agnostic JavaScript library for managing real-time, interactive avatar conversations. It is designed to be decoupled from any specific UI framework, allowing for integration into various environments, such as React, Vue, or vanilla JavaScript projects.

## 1. 🏛️ Core Architecture

The SDK is built around a central `ConversationManager` that orchestrates several specialized managers to handle different aspects of the conversation lifecycle.

```
        ┌──────────────────────────┐
        │  🧞 Conversation Manager │  ⇽ The central orchestrator
        └────────────┬─────────────┘
                     │ holds references to and coordinates ⇩
├────────────────────┬──────────────────────┬────────────────────────┐
│  🎪 Playback Manager │  🎩 User-Input Manager │  🗣️ Conversation Network │
│  (Handles output)  │   (Handles input)    │   (Handles WebSocket)  │
└────────────────────┴──────────────────────┴────────────────────────┘
```

- **🧞 `ConversationManager`**: The main entry point and central nervous system of the SDK. It initializes and coordinates all other managers, manages the overall conversation state (`idle`, `playing`, `userSpeaking`, etc.), and exposes a simple API for controlling the conversation.
- **🗣️ `ConversationNetwork`**: Manages the WebSocket connection to the backend, handling the sending and receiving of all conversation-related messages.
- **🎩 `UserInputManager`**: Captures user input. It uses a `VADManager` (Voice Activity Detection) to detect when the user is speaking and an `AudioRecorder` to capture microphone data. It can also handle text input.
- **🎪 `PlaybackManager`**: Manages the playback of the assistant's response. This includes playing audio (`AudioPlayer`), displaying subtitles (`SubtitleManager`), and triggering avatar animations (`AvatarManager`).

---

## ✨ Key Features

### 🗣️ Full-Duplex & Interrupts (Barge-in)

The SDK is designed for natural, fluid conversations. Users can interrupt the assistant at any time, just like in a real conversation. This is achieved through robust **Acoustic Echo Cancellation (AEC)**. We leverage the browser's native AEC capabilities, which are often hardware-accelerated on modern mobile devices. In environments where hardware AEC is unavailable, a software-based solution is used, ensuring a seamless experience across all platforms.

### 🤫 Smart Turn Detection

No more awkward silences or waiting for a push-to-talk button. The SDK uses the industry-standard **Silero VAD (Voice Activity Detection)** model to intelligently detect when a user has started and, more importantly, finished speaking. This allows for a natural conversational flow, where the assistant responds precisely when the user has completed their thought.

---

## 2. 🛠️ Manager Deep Dive

### 🧞 `ConversationManager.ts`

This is the primary class you will interact with. It simplifies the complex process of managing a real-time conversation into a few simple methods.

- **Key Responsibilities**:
  - Orchestrates the entire conversation flow.
  - Manages state transitions (e.g., from `playing` audio to `listening` for the user).
  - Initializes the WebSocket connection and microphone access.
  - Provides a high-level API: `initialize()`, `pause()`, `resume()`, `interact()`, etc.
- **Configuration**: It's instantiated with a `ConversationConfig` object, which is crucial for defining its behavior. The `hooks` property within this config is the primary way the SDK communicates back to your application UI.

### 🗣️ `ConversationNetwork.ts`

This manager handles all low-level WebSocket communication.

- **Key Responsibilities**:
  - Establishes, maintains, and closes the WebSocket connection.
  - Handles authentication and initial configuration messages.
  - Sends user input (audio/text) to the server.
  - Receives assistant responses (audio, subtitles, metadata) and forwards them to the appropriate managers via events.

### 🎩 `UserInputManager.ts`

This manager is responsible for capturing everything the user says or types.

- **Key Responsibilities**:
  - Initializes and manages the `AudioRecorder` to get raw audio data from the microphone.
  - Uses a `VADManager`, powered by the industry-standard **Silero VAD** model, to detect speech with high accuracy, automatically starting and stopping the recording process.
  - Packages audio data and text into the correct format to be sent over the network.
  - Implements a critical "barge-in" feature: when the assistant's audio playback is about to finish (within 1000ms), it proactively starts buffering the user's audio. This creates a seamless, responsive conversation by minimizing the delay between turns.

- **Sub-components**:
  - **🎤 `AudioRecorder.ts`**: Interfaces with the browser's `MediaRecorder` or an `AudioWorklet` to capture audio chunks.
  - **🤫 `VADManager.ts`**: Runs the lightweight Silero VAD model to determine if the user is speaking.

### 🎪 `PlaybackManager.ts`

This manager handles the rendering of the assistant's response.

- **Key Responsibilities**:
  - Receives messages from `ConversationNetwork` and directs them to the correct player.
  - Coordinates the synchronized playback of audio, subtitles, and avatar animations.

- **Sub-components**:
  - **🎵 `AudioPlayer.ts`**: A robust audio player that handles chunked audio data, ensuring smooth, gapless playback of streamed audio.
  - **📜 `SubtitleManager.ts`**: Manages the display and timing of word-by-word or line-by-line subtitles.
  - **🧒 `AvatarManager.ts`**: Provides a simple API (`playIdle`, `playTalk`, `playListen`) to control high-level avatar animations. It emits events that a UI component can listen to in order to drive the actual animation system (e.g., Spine, Rive, Three.js).

---

## 3. ⚛️ Usage Example: React Integration

The `ug-core` SDK is vanilla JavaScript, making it easy to integrate into any framework. Here’s how it's used in the `YourComponent.tsx` UI component.

### The Core Concept: Decoupling

The SDK is intentionally decoupled from React. It manages all the complex state and logic internally. The React component's job is simply to:

1.  Instantiate the `ConversationManager`.
2.  Provide callback `hooks` to sync the SDK's internal state with the React component's state.
3.  Call high-level methods on the manager in response to user UI interactions (e.g., clicking a play button).

### Implementation in `YourComponent.tsx`

**1. Instantiating the Manager**

The `ConversationManager` is stored in a `useRef` to ensure it persists across component re-renders without triggering them.

```typescript
// In YourComponent.tsx
const conversationManagerRef = useRef<ConversationManager | null>(null)

if (!conversationManagerRef.current) {
  // Configuration is created
  const convConfig: ConversationConfig = {
    /* ... config ... */
  }
  // Manager is instantiated
  conversationManagerRef.current = new ConversationManager(convConfig)
}
```

**2. Bridging State with React Hooks**

The `ConversationConfig`'s `hooks` property is the bridge between the SDK and some UI library (React, Vue, Svelte). We pass `setState` functions from `useState` directly into these hooks.

```typescript
// In YourComponent.tsx
const [state, setState] = useState<ConversationState>()
const [subtitles, setSubtitles] = useState<any>(null)
const [currentImage, setCurrentImage] = useState<string | null>(null)

// ... inside the component
const convConfig: ConversationConfig = {
  // ... other config
  hooks: {
    // When the SDK's state changes, it calls this hook...
    onStateChange: (newState: ConversationState) => {
      // ...which updates the React component's state, triggering a re-render.
      setState(newState)
    },
    onSubtitleChange: (event: SubtitleChangeEvent) => {
      setSubtitles(event)
    },
    onError: (error: ConversationError) => {
      toast.error(error.message)
    },
    onAvatarAnimationChanged: ({ name, layer, loop }) => {
      // Forward the animation command to the Spine character component
      animatedCharacterRef.current?.setAnimation(layer, name, loop)
    },
  },
}
```

**3. Driving the SDK from the UI**

User interactions, like clicking a button, call the simple, high-level methods on the `ConversationManager` instance.

```typescript
// In YourComponent.tsx
const handlePlayButtonClick = () => {
  if (isAudioPlaying) {
    conversationManagerRef.current?.pause()
  } else {
    conversationManagerRef.current?.resume()
  }
}

const handleSendText = () => {
  if (textInput.trim()) {
    conversationManagerRef.current?.interact({
      uid: '',
      kind: 'interact',
      type: 'stream',
      text: textInput,
    })
    setTextInput('')
  }
}
```
