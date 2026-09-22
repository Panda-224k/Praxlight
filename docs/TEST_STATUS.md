# PraxLight â€” Test Status

Every result below was produced by actually running the command shown,
against the real cloned repository (`Panda-224k/PraxSlight`, commit
`f4ffc1a`), during the Phase 1 baseline audit. Nothing here is inferred.

## JavaScript â€” `node --test tests/test_pii_lib.cjs tests/test_perception.cjs`

```
node --version  # v22.22.2
npm install     # installs jsdom@30.0.1, dev-only, declared in package.json
```

**Result: 24/24 passed, 0 failed** (11 in `test_pii_lib.cjs`, unchanged from
Phase 1; 13 new in `test_perception.cjs`, added in Phase 2).

```
# tests 24
# suites 0
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`test_perception.cjs` covers: disabled/required/checked state on form
fields, `.form`-based form association, password values never being read,
ARIA metadata resolution (including resolving `aria-describedby` to actual
referenced text), disabled interactive controls (including
`aria-disabled`), `isVisible` correctly excluding `display:none` and
zero-size elements, `isInViewport` correctly distinguishing on-screen from
far-off-screen geometry, `extractText` skipping script/style content,
open-shadow-root traversal (both for element extraction and for the host
count), same-origin iframe perception actually populating nested
inputs/interactive/text, cross-origin iframe access failing closed to
`sameOrigin:false` with an explanatory note, and the top-level
`capturePage()` shape including the new `schemaVersion`/`viewport`/
`shadowHostCount` fields.

Testing note: jsdom performs no real layout, so
`Element.prototype.getBoundingClientRect` always returns an all-zero rect
by default â€” every test that depends on element geometry patches this
explicitly (a standard, well-documented pattern for DOM tests under jsdom,
not a workaround specific to hiding a problem). One test initially failed
because an iframe's `contentWindow` is its own separate realm with its own
`Element` class in jsdom (as in a real browser) â€” the outer window's patch
didn't apply to it. Fixed by patching that realm too; this was a bug in the
test fixture, not in `perception.js`.

## Python â€” `python -m pytest tests/test_validator.py -v`

```
python3 --version   # Python 3.12.3
pytest               # 9.1.1
fastapi==0.115.0, pydantic==2.9.2 installed from server/requirements.txt
```

**Result: 6/6 passed, 0 failed.**

```
tests/test_validator.py::test_valid_click_action_passes PASSED
tests/test_validator.py::test_unknown_target_id_is_rejected PASSED
tests/test_validator.py::test_navigate_is_disabled PASSED
tests/test_validator.py::test_type_action_requires_user_provided_value_policy PASSED
tests/test_validator.py::test_read_action_needs_no_target PASSED
tests/test_validator.py::test_reason_containing_irreversible_keyword_forces_approval_even_at_low_risk PASSED
```

## Live backend behavior â€” FastAPI `TestClient`, in-process

Run directly against `server/main.py`'s actual `app` object (chosen over a
live `uvicorn` + `curl` round trip because backgrounded long-running
processes were unreliable across separate shell invocations in this
specific sandbox â€” see "Sandbox note" below. This is not a weaker check: it
exercises the identical FastAPI routing, Pydantic validation, and
`validate_action` call path a real HTTP request would hit).

| Request | Result |
|---|---|
| `GET /api/health` | `200 {'status': 'ok', 'service': 'praxsight-agent-api', 'version': '0.1.0'}` â€” 14.0ms |
| `GET /demo/support-ticket/` | `200`, 5219 bytes served from the static mount |
| `POST /api/agent/act` â€” valid sanitized payload, task "Resolve this support ticket", interactive elements including a "Resolve Ticket" button | `200 {'action': 'click', 'target': {'type': 'element_id', 'id': 'btn_resolve'}, 'reason': "Task asks to resolve the ticket; the control labeled 'Resolve Ticket' on the sanitized page matches this request.", 'risk': 'high', 'requires_approval': True, 'validated': True}` â€” 3.8ms |
| `POST /api/agent/act` â€” `privacy_manifest.performed: false` | `400 {'detail': 'Payload does not declare a completed privacy scan â€” refusing to process.'}` |
| `POST /api/agent/act` â€” task with no matching interactive element ("What is the customer's billing history?") | `200 {'action': 'read', 'target': None, 'reason': 'No unambiguous matching control was found on the sanitized page for this task â€” returning a read-only response instead of guessing at a selector.', 'risk': 'low', 'requires_approval': False, 'validated': True}` |

All four confirm the intended behavior: the server proposes an action only
that's grounded in elements it was actually given, forces approval on the
irreversible-sounding one, hard-rejects an unsanitized-looking payload, and
falls back safely instead of guessing when nothing matches.

## Documentation integrity check (not a scripted test â€” manual byte-diff audit)

Neither test suite above checks documentation content, so this was caught
separately: comparing every file's byte size against the source it was
generated from surfaced 5 markdown files truncated to between 2% and 88% of
their intended length (`README.md`, `docs/ARCHITECTURE.md`,
`docs/AGENT_PROTOCOL.md`, `docs/DEMO_GUIDE.md`, `docs/PRIVACY_MODEL.md`).
Root cause and fix are in `docs/HANDOFF_PHASE_1.md`'s "Known Bugs" section.
All application code files differed from source by at most 1 byte (a
trailing newline dropped at materialization time â€” cosmetic, confirmed
harmless). Fixed in this checkout as part of this audit.

## Static/syntax checks

| Check | Result |
|---|---|
| `python -c "import json; json.load(open('extension/manifest.json'))"` | valid JSON |
| `node -e "new Function(fs.readFileSync(f))"` over all 8 extension `.js` files (re-run after Phase 2's `perception.js` changes) | all parse without a syntax error |
| `python -m py_compile` over all 4 `server/*.py` files | all compile |

## NOT tested in this audit (explicitly, so nobody assumes otherwise)

- **The extension has never been loaded in an actual Chrome or Firefox
  instance in this project's history.** This sandbox has no browser
  runtime. Syntax validity is confirmed; DOM behavior, `chrome.*` API usage,
  and the popup's actual rendering are not.
- **Real network-latency numbers.** The `TestClient` results above measure
  in-process compute time, not real HTTP round-trip time over a socket â€”
  see the caveat in `docs/PROJECT_STATE.md`.
- **Firefox compatibility** â€” not attempted.
- **Memory/CPU/WebGPU availability** â€” no instrumentation exists yet
  (Phase 15).

## Sandbox note (for whoever runs Phase 2+)

Backgrounding `python run.py` or a bare `uvicorn` process with `nohup ... &`
and then issuing `curl` against it from a **separate** tool invocation was
unreliable in this session â€” the process was confirmed alive via `ps aux`
immediately after starting it, but the port refused connections in the very
next command. The same pattern worked reliably earlier in the same overall
project history and failed here, so treat it as sandbox flakiness, not a
reproducible bug in `run.py` â€” a foreground `timeout 4 python3 run.py` run
in this same audit showed clean `Application startup complete` /
`Uvicorn running on http://0.0.0.0:8000` with no errors before the timeout
killed it. `TestClient` was used instead specifically to route around this,
not because the live-server path is suspected broken.

### Phase 3: OCR for Image-Embedded PII

| Component | Test Type | Status | Notes |
| :--- | :--- | :--- | :--- |
| ocr-engine.js | Integration (Node) | **PASS** | Simulated OCR text fed into detectInText successfully redacts PAN and DOB and tags them with ["ocr"]. |
| End-to-end OCR | Manual (Browser) | **NOT VERIFIED** | Environment constraints prevented operating a real Chrome browser with the unpacked extension to click the "Scan images (OCR)" button on the kyc-upload demo page. Latency, exact Tesseract text extraction, and confidence scores were not recorded. |
