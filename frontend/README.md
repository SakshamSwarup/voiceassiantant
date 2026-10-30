# Voice AI Assistant

A responsive voice assistant composition built with React, TypeScript,
Tailwind CSS v4 and Lucide React. The existing HeroUI setup is preserved; the
microphone uses a native accessible button with an audio-reactive WebGL Orb.

The initial screen is a full-viewport landing page with the official React Bits
`LightRays-JS-CSS` registry component and its CSS, installed through shadcn.
The welcome heading, Get Started button, and one glass-panel LogoLoop appear.
The official `LogoLoop-JS-CSS` registry source and CSS are used unchanged,
with `react-icons/si` for React, TypeScript, Vite, Tailwind CSS, Python, FastAPI,
and WebRTC. OpenAI uses a text wordmark because the installed icon set has no
OpenAI export. These identify actual project technologies, not partnerships.
The loop scrolls left at 75px/s, eases to a pause on hover, and shows inline
labels with brand-color hover effects. Logo size and spacing adapt to the
viewport. Its native reduced-motion handling stops automatic scrolling.
Get Started fades out
the landing and mounts the existing assistant screen, now in `src/VoiceAssistant.tsx`.
No router is installed, so navigation uses local application state: the URL
does not change, browser Back is not a screen switch, and reload returns to the
landing. Neither landing mount nor Get Started requests microphone permission
or creates a paid session; only the assistant's microphone control does that.
Reduced motion uses static CSS lighting and instantaneous screen transitions.
Static lighting also remains behind the canvas if WebGL2 fails or is lost.
The installed JS component has a small TypeScript declaration alongside it;
its original shader and interactions remain intact. React Bits licensing is
preserved in `src/components/voice/Orb.LICENSE.md`.

```powershell
npm install
npm run dev
npm run build
npm run lint
```

The page is composed of `VoiceAssistantLayout`, `VoicePanel`,
`MicrophoneButton` and `Orb` in `src/components/voice`.
The original `MicrophoneRings` source is retained but is no longer rendered.
`VoicePanel` accepts children. `MicrophoneButton` accepts `size`
(`small`, `medium`, `large`), `disabled`, an optional `onPress` callback and an
optional `aria-label` and accessible toggle/status attributes.
The page wires the existing button to `useVoiceSession`, which reuses
`useMicrophone` in `src/hooks/useMicrophone.ts`. Click to request microphone
permission and connect; click again to finish the session. Capture never
starts automatically.

Connection UI uses `idle`, `requestingPermission`, `connecting`, `connected`,
`disconnecting`, and `error` states. A small spinner and "Connecting..." appear
during permission and setup; the Orb remains visible. The red End Call control
appears only after both native WebRTC `connectionState === "connected"` and
GPT-Live `session.started`. It reuses the Orb's stop handler, releases microphone
capture and playback immediately, then closes the peer after the existing
bounded server-close acknowledgement wait. Reduced motion disables connecting
pulsing and spinner rotation.

The hook exposes `status` (`idle`, `requesting`, `active`, `error`), `stream`,
`error`, `startMicrophone()` and `stopMicrophone()`. The same stream feeds
WebRTC and the local Orb analyser. Duplicate starts are ignored.
Stopping, unmounting, or a disconnected audio track releases the stream.
Streams returned by a stale permission request are stopped immediately.

### Run and test the voice connection

Start the backend from `backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Start `npm run dev` from `frontend` and open **http://localhost:5173**.
The backend permits that exact origin by default. Check
http://127.0.0.1:8000/health and confirm the voice route appears in `/docs`.
Optionally set `VITE_API_BASE_URL` to a different backend base URL in a local
Vite environment file and restart Vite; never put API keys in Vite variables.
For another frontend origin, configure the backend's `FRONTEND_ORIGIN`.

Starting a real session transmits microphone audio to OpenAI and can incur
charges. The backend must have an API key and access to its configured models.

Open the Vite localhost URL in a browser with a microphone attached:

1. On load, confirm "Ready to talk" and no microphone permission prompt.
2. Click the microphone, allow permission, and confirm "Connecting...",
   followed by "Connected • Listening" and End Call after WebRTC connects
   and the server sends `session.started`.
   Ask a question and listen for the assistant through your speakers/headphones.
   If autoplay is blocked, press play on the audio controls that appear.
   Speak quietly, normally, then loudly: the Orb's edge, glow and deformation should
   respond gently to volume and the label should change to "Speaking".
   Pause and confirm they settle back to rest. If analysis is paused, tap the
   page to resume the browser's AudioContext.
3. Click End Call (or the Orb again) to stop; confirm "Ending call...", then "Ready to talk"
   and that the browser capture indicator stops. Finalization can take up to
   15 seconds. A timeout explicitly warns that final usage is unconfirmed.
   Clicking while connecting cancels startup; a pending browser permission
   result is discarded safely. Repeat to verify start/stop.
4. Deny permission (reset site permissions first if already granted) and
   confirm an actionable error. Allow access in site settings and retry.
5. While active, navigate away or reload to release capture. Disconnecting
   the device or revoking permission should also show an error if the browser
   reports that the audio track ended.

Use localhost or HTTPS; plain HTTP on a LAN address cannot request microphone
access. Operating-system privacy settings can also block the microphone.
No microphone audio is recorded by the frontend. Microphone audio is sent on
the WebRTC media track; only received assistant audio is played locally.

`useVoiceSession` creates the `oai-events` channel before the SDP offer, waits
for ICE gathering, and posts JSON `{ "sdp": "<actual browser offer>" }` to
`POST /api/v1/voice/session`. It validates the backend response, retains
`session.id`, and applies `transport.sdp` as an SDP answer. The backend alone
configures models/delegation and holds the API key. HTTP creation starts
GPT-Live: no `session.start` or audio-append commands are sent.
The stop action sends `session.close`, waits for `session.closed`, then closes
the channel, peer, tracks and playback. During finalization the mic track is
disabled and analysis stops. Unmount/device loss releases resources immediately
and can only make a best-effort close, not guarantee final usage confirmation.
Startup, ICE, disconnection and graceful-close waits are bounded. Requests
are aborted when cancelled and are not automatically retried, to avoid duplicate
billable session creation. An already-submitted upstream creation can still
complete after cancellation; aborting the browser request does not guarantee
that upstream billing was cancelled.

### Idle closure and per-call costs

The idle timeout defaults to 60 seconds of **observable inactivity**, with a
10-second warning and a **Continue call** button. Continuing resets the idle
deadline without creating a session or losing in-call context. Speech or other
activity cancels the warning. Idle close uses the same graceful stop flow as
the microphone button. After closure, the UI clearly offers a new call;
previous in-call memory is not resumed or secretly reinjected.

The session hook shares the existing Orb analyser; it does not create another
AudioContext. Microphone amplitude, Live transcript activity, WebRTC received
audio energy statistics, and pending delegated Responses work prevent idle close.
Streaming remote audio does not reliably emit `ended` between assistant turns,
so `audio.playing`/`ended` alone are not used to guess silence.
Unavailable analysis, unknown remote activity, paused/blocked audio, a hidden tab,
or unknown delegated work **suspend** idle closure rather than risk interrupting
someone. Background noise can also postpone it. Visibility changes reset the
deadline. These conservative guards can leave some silent sessions open:
explicitly stop the call when finished. `pagehide` and React unmount release
resources with a best-effort close command; navigation/network loss cannot
guarantee delivery or final billing confirmation.

Optional **public** Vite environment settings (restart Vite after edits):

| Variable | Default |
| --- | --- |
| `VITE_VOICE_IDLE_TIMEOUT_SECONDS` | `60` (minimum 20) |
| `VITE_VOICE_USD_PER_MINUTE` | `0.05` |
| `VITE_RESPONSES_INPUT_USD_PER_MILLION` | `0.10` |
| `VITE_RESPONSES_CACHED_USD_PER_MILLION` | `0.01` |
| `VITE_RESPONSES_CACHE_WRITE_USD_PER_MILLION` | `0.125` |
| `VITE_RESPONSES_OUTPUT_USD_PER_MILLION` | `0.50` |

Rates are centralized in `src/lib/voiceUsage.ts`, in USD. Defaults were checked
against [official pricing](https://developers.openai.com/api/docs/pricing) and
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) on
2026-10-30: Standard short-context rates and GPT-Live at $0.05/minute.
Luna's documented >272K input-token multipliers are applied when relevant.
Cache-write estimates use the configured short/default TTL write rate; a
cache write flags that assumption rather than claiming a complete total.
Change rates for your agreement/region/cache TTL; taxes and regional premiums
are not included. Other models/tiers or missing usage details produce unknown
costs, not an invented number.

Open browser DevTools **Console**, filter for **`[voice-usage] call`**, and end
a call normally. The structured report contains:

- Session ID, close reason, and whether final duration was confirmed.
- Latest measured `usage.seconds`, replaced by final `session.closed.usage.seconds`.
  Cumulative snapshots are **not summed**, and the 15-second WebRTC initialization
  charge is **not added again** to an already-reported duration.
- Per-response input, output, cached input, and cache-write tokens from nested
  `response.event` terminal snapshots, counted once by response ID. Output
  tokens already include reasoning; they are not added a second time.
- Tool item counts by type from `response.output_item.done`, without arguments,
  search text, or private content. Tools are disabled; any observed tool items
  mark tool charges as unpriced rather than claiming zero.
- Voice/backend estimated USD and a combined estimate only when all required
  data is available. `null`, notes, or `final: false` mean incomplete accounting.

Enable **Preserve log** if you need to inspect a navigation/disconnection report.
Reports are transient browser logs, not trusted billing records; no transcripts,
full session configuration, story content, or API keys are logged. Compare
representative real calls against the OpenAI usage dashboard/invoice to assess
savings. None are claimed from configuration changes alone.

Essential deterministic checks (Node 24+, no extra libraries):

```powershell
node --test tests\voiceUsage.test.mjs
```

For manual idle testing, leave a connected call silent after assistant playback:
the warning should appear in the final 10 idle seconds. Continue and verify
Network shows no new session POST. Test speech, assistant audio and delegated
work around the boundary: none should be cut off. If activity statistics are
unavailable, the console explains that automatic idle closure is suspended.

Reusable layout and fallback Orb styles live in `src/index.css`.
`useVoiceActivity` analyzes the existing stream with one AudioContext and
an unconnected-to-output analyser (1024 time-domain samples). RMS uses
65ms attack/180ms release smoothing, a 0.008 noise floor, and separate
0.018/0.011 speaking thresholds to avoid flicker. This detects amplitude,
not pitch, identity, or speech semantics; thresholds are fixed, so very
quiet speech or noisy rooms may require device gain adjustments.

Sampling uses requestAnimationFrame capped at 30Hz. `audioLevel` (also exposed
as `volume`) is a Motion value, with `isListening` and `isSpeaking` state.
The WebGL renderer reads that value directly without React renders per sample.
React updates only for speaking/context/error state changes.

### React Bits Orb adaptation

The visual foundation is the official
[React Bits TypeScript Orb](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Backgrounds/Orb/Orb.tsx).
Its current implementation uses native WebGL2;
no OGL, Three.js, or other new dependency is required. SplitText is unrelated.
Attribution and the full upstream MIT + Commons Clause terms are preserved in
`src/components/voice/Orb.LICENSE.md`. Use within this application is permitted;
do not redistribute or sell the component itself as a standalone product.

`Orb.tsx` adapts upstream simplex noise, radial lighting and bloom into a
focused voice renderer. Custom `uLevel`, `uListening` and `uReduced` uniforms
drive brightness, glow, edge deformation and a maximum 3.5% radius increase.
The shader corrects reversed smoothstep edges to defined ascending edges.
Pointer coordinates ease toward the cursor, subtly pulling the ring edge and
steering its orbiting light while gentle rotation and glow increase on hover.
The existing button click (including touch and keyboard activation) also
restarts one damped expansion/glow/swirl pulse; it invokes the voice handler
exactly once. Neither effect moves the control's layout or creates audio streams.
Interaction uniforms are separate from measured audio energy. Reduced motion
disables hover deformation, rotation and click pulses; the CSS fallback uses
only restrained hover/pressed color and glow changes. Intro, tilt, trails and
palette customization remain omitted.
Slow idle noise/color movement is decorative. Changes in voice energy use only
the measured audio level. No processing/responding state is fabricated.

Reduced motion freezes shader time and deformation; only capped brightness
updates remain. Hidden tabs pause rendering. The renderer caps pixel ratio
at 1.5, handles resize, and deletes shaders, geometry and programs on cleanup.
Unsupported WebGL2, shader failures or context loss show a CSS Orb with a
"Simplified visual" notice; capture and keyboard-accessible controls still work.
Reload to retry WebGL after context loss. The fallback's border/glow and the
existing status label continue to indicate speaking without movement.

Stopping, replacing the stream or unmounting cancels analysis, disconnects
nodes and closes its AudioContext without taking ownership of microphone
tracks. `useMicrophone` still exclusively owns permission and track cleanup.
Vite and TypeScript configuration remain unchanged.

## Vite development setup

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
