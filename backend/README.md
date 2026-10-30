# Voice AI Bot backend

Run commands from this directory in PowerShell, using the existing virtual
environment (Python 3.14 in this workspace):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

In another terminal, from the same directory:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The workspace's `.vscode/settings.json` selects the existing environment,
adds the backend import root, and configures pytest discovery in VS Code.
The `Verify Voice AI backend on port 8001` VS Code task runs the app on an
alternate local port without disturbing a server already using port 8000.

Alternatively, activate the environment with
`.\.venv\Scripts\Activate.ps1`, then use
`python -m uvicorn app.main:app --reload --port 8000`.
Do not install application source files inside `.venv`.

If Swagger shows only `/` and `/health`, check the Uvicorn import target.
The modular application is `app.main:app`, not `main:app`. Stop the old
server with Ctrl+C in its terminal, then restart from `backend` using the
command above. Refresh `/docs`; `/openapi.json` should include
`POST /api/v1/voice/session`. No router changes are needed for this
entrypoint mismatch.

## Configuration

Settings load `backend/.env` by absolute path, independent of the working
directory. Process environment variables take precedence. Existing secret
values have not been changed. Never send the permanent key to the browser.

| Variable | Default |
| --- | --- |
| `OPENAI_API_KEY` | Unset; session creation returns 503 |
| `OPENAI_LIVE_MODEL` | `gpt-live-1` |
| `OPENAI_RESPONSES_MODEL` | `gpt-6-luna` |
| `OPENAI_RESPONSES_MAX_OUTPUT_TOKENS` | `150` (minimum 16, maximum 4096) |
| `OPENAI_TIMEOUT_SECONDS` | `30` |
| `FRONTEND_ORIGIN` | `http://localhost:5173` |

Both models must be enabled in your OpenAI API project. The delegation guide
currently recommends `gpt-6-luna`; the WebRTC quickstart also demonstrates
`gpt-5.6-terra`. Project access has not been verified by an API call. Set
`OPENAI_RESPONSES_MODEL` to your project's supported model if necessary, then
restart the server. No web search or application tools are enabled by default.

## MVP cost controls

The voice model and delegated model are unchanged. Responses delegation explicitly
uses Low reasoning, low text verbosity, Standard (`default`) service tier,
`max_output_tokens=150`, `tools=[]` and `tool_choice="none"`.
The Live prompt asks it to answer simple interview/story questions directly
from session context and delegate only for genuine extra reasoning or an enabled
tool. Prompting guides delegation; it does not guarantee a particular call count.
The cap includes reasoning tokens as well as visible output. If observed
`response.incomplete` events indicate the cap is too tight, increase
`OPENAI_RESPONSES_MAX_OUTPUT_TOKENS` modestly and restart; there are no automatic
retry/completion calls that could multiply costs.

The story is read once per session creation and included in each model's startup
instructions, not reinjected on each turn. The full story and native conversation
history remain intact; no model, memory truncation, or storage migration was added.
Answers are requested in usually 2-5 sentences.

See the frontend README for the activity-aware 60-second idle timeout and
per-call `[voice-usage] call` console reports. Events travel directly over
WebRTC, so this MVP records usage in the **browser console**, not FastAPI logs.
No transcript persistence or telemetry database/endpoint is added.

## Personal story and in-call memory

Edit [app/data/my_story.md](app/data/my_story.md) with truthful personal facts,
examples, and the exact five 100x interview questions and your answer notes.
Replace `[TO FILL: ...]` placeholders as you learn what you want to say.
The RAG/Bedrock project in the request was illustrative, not confirmed; the
template must not turn it into a claimed achievement. Keep the story concise
and never include credentials. Story content is sent to OpenAI as instructions.

`LiveService` reads this UTF-8 file for **each new call** using a path relative
to its own module, not the terminal's working directory. File reads run off the
async event loop. There is no story cache: edits apply to the next call without
restarting Uvicorn, but do not modify an already-running conversation.
The story is included in both `session.instructions` and
`session.delegation.responses.instructions` so the voice and reasoning models
share the same first-person interview guidance and factual reference.
Unknown details must prompt a brief clarification, never fabricated answers.
Missing, unreadable, invalid-UTF-8 or empty files return a controlled **503**
before an upstream session is created; logs do not include story content.

The existing API is **GPT-Live**, not legacy Realtime. Each start action creates
one session/peer connection; ordinary spoken turns do not POST new sessions.
User audio and assistant responses stay in that session's native conversation
context. Responses delegation receives conversation context from GPT-Live.
Every new call explicitly starts with empty prior `input`, plus the shared
story instructions. There is no application transcript cache, global conversation
dictionary, database, or duplicate summary store that could mix calls.
The existing stop flow sends `session.close`, waits for `session.closed`, and
releases resources and the frontend session ID. Unmount/error cleanup is
best-effort and does not guarantee provider-side deletion or usage finalization.

GPT-Live manages growing context automatically; this is not a guarantee of
verbatim or unlimited recall in very long calls. No custom summary mechanism
has been added without evidence of a context-limit problem.
See [session context](https://developers.openai.com/api/docs/guides/live-conversations)
and [Responses context](https://developers.openai.com/api/docs/guides/live-delegation).

### Test personal context and memory

1. Fill in a few real story facts, start a new call, and ask an interview
   question before mentioning those facts aloud. The answer should use them
   naturally in first person, without treating placeholders as facts.
2. During that same call, state a real project detail (for example, the
   Bedrock RAG project only if it is true). Ask a different question, then ask
   "Which project did I tell you about?" and check the response.
3. Correct a detail and ask again. In browser Network tools, verify there is
   only one `POST /api/v1/voice/session` for the whole call.
4. Stop, wait for closure, and start again. A new call should know the story
   file, not unrecorded facts from the previous call.
5. Edit the story and start a new call to verify fresh loading.

Automated tests mock OpenAI and verify instruction loading, SDK serialization,
per-call reloading/isolation, and sanitized file errors. They cannot prove
model recall or first-person answer quality; the spoken checks above require
a real call and may incur charges.

## HTTP API and browser integration

- `GET /`: existing running message.
- `GET /health`: liveness check, not an OpenAI readiness or model-access check.
- `POST /api/v1/voice/session`: JSON `{"sdp": "<browser SDP offer>"}`.
- `GET /docs`: interactive Swagger documentation.

The session route returns **201**:

```json
{
  "session": {"id": "live_123"},
  "transport": {"type": "webrtc", "sdp": "<SDP answer>"}
}
```

Create microphone tracks and the `oai-events` data channel before the offer.
Set the local description and wait for ICE gathering before posting its SDP.
Apply `result.transport.sdp` using
`peer.setRemoteDescription({type: "answer", sdp: result.transport.sdp})`.
Preserve `result.session.id` unchanged. Wait for `session.started` on the data
channel before sending commands; **do not send `session.start`**.
To finish, send `session.close`, wait for `session.closed`, then release media
tracks and the peer connection.

Invalid/missing SDP returns **422** without echoing the submitted payload.
Missing key/story or upstream authentication/model-access/rate-limit failures return
**503**; upstream connection, request or malformed-response failures return
**502**; upstream timeouts return **504**. Errors and logs exclude upstream
payloads and credentials.

The application reuses one asynchronous SDK client/connection pool per worker,
closes it on shutdown, and disables retries because creation is billable.
Tests replace the SDK call with mocks and do not need a real key or network.
One test also exercises the actual SDK serializer and response parser using an
in-memory transport. `httpx` supports FastAPI's TestClient; `httpx2` is the
transport used by the pinned OpenAI SDK and its transport-level test.

## Layout

- `app/main.py`: application factory, lifecycle, CORS, validation errors, routers.
- `app/core/config.py`: immutable Pydantic Settings.
- `app/api/health.py`: root and health routes.
- `app/api/v1/api.py`: versioned router aggregation.
- `app/api/v1/routes/voice.py`: HTTP and dependency injection only.
- `app/schemas/voice.py`: request and response contracts.
- `app/services/live_service.py`: SDK integration and sanitized domain errors.
- `app/data/my_story.md`: editable personal reference loaded for every new call.
- `tests/`: offline route, validation, configuration and service tests.

The original `.venv/main.py` is retained unchanged for reference; the maintained
application is now `app.main:app`. The existing `.env` was moved out of `.venv`
into this directory without changing its bytes.

## Local-only security boundary

Bind Uvicorn to localhost (its default). CORS is not authentication and does not
prevent direct non-browser requests. This intentionally unauthenticated route
can create paid sessions; do not expose it publicly until authentication,
authorization, request limits and HTTPS are added. Session creation itself
incurs initialization usage, so no live session is created during validation.

## Verified API references

- [GPT-Live guide](https://developers.openai.com/api/docs/guides/live)
- [WebRTC flow](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [SDK create reference](https://developers.openai.com/api/reference/python/resources/live/methods/create)
- [Responses delegation](https://developers.openai.com/api/docs/guides/live-delegation?delegation-mode=responses)

The implementation uses the documented `client.live.create()` WebRTC flow,
not Realtime client secrets or ephemeral tokens. OpenAI SDK 3.41.0 is pinned
to the inspected typed request and response contract.
