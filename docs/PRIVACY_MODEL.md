# PraxSight — Privacy Model

## What gets detected

| Category | Detector | Signal |
|---|---|---|
| `password` | structural | `input[type=password]` |
| `otp` | structural | label/name/autocomplete matching "otp", "one-time", "verification code" |
| `email` | structural + text | `autocomplete=email`, label text, or regex over visible text |
| `phone` | structural + text | `autocomplete=tel`, label text, or an Indian mobile-number pattern |
| `person_name` | structural | label containing "name" but not "username" |
| `address` | structural | label containing "address", "pincode", "zip code" |
| `account_number` | structural | label containing "account", "iban", "routing" |
| `card_number` | structural + text | label containing "card number"/"cvv", or a 13–19 digit run that passes a Luhn checksum |
| `gov_id_pan` | text | PAN-shaped pattern (`AAAAA9999A`) |
| `gov_id_like` | text | 12-digit grouped pattern, low confidence |
| `date_of_birth` | structural | label containing "dob", "date of birth" |
| `secret_key` | structural | label/name containing "api key", "secret", "access token" |

This is the Phase 2 rules layer only. It is deliberately not exhaustive —
see `CURRENT_IMPLEMENTATION.md` for what a model-backed pass (Phase 3) would
add on top (unlabeled free-text names, ambiguous fields).

## Redaction scheme

Two token shapes, chosen per type in `redaction.js`:

- **Counted, per-task-stable**: `[EMAIL_1]`, `[PERSON_2]`, `[PHONE_1]` — the
  server can still tell "these two mentions are the same person" without
  learning who that person is. Counters reset every scan; nothing persists
  across page loads.
- **Counterless**: `[PASSWORD_REDACTED]`, `[CARD_REDACTED]`,
  `[ACCOUNT_REDACTED]`, `[OTP_REDACTED]`, `[SECRET_REDACTED]`,
  `[GOVID_REDACTED]` — for classes where even distinguishing instance 1 from
  instance 2 leaks more than the task needs.

## Fail-closed, not fail-open

Three independent checks between page and server (see `ARCHITECTURE.md` for
where each lives):

1. **Client residual scan** (`content-script.js`) — re-scans the *sanitized*
   payload's JSON for anything that still looks like an email or a
   Luhn-valid card number. If it finds one, the scan is marked unclean.
2. **Background gate** (`background.js`) — refuses to call `fetch()` at all
   unless `manifest.performed === true` AND `residual.clean === true`.
   Blocked attempts are logged (`status: "BLOCKED"`) in the Network Guard
   panel, not silently dropped.
3. **Server manifest check** (`main.py`) — independently rejects (HTTP 400)
   any request whose `privacy_manifest.performed` is not `true`, regardless
   of what the extension claims elsewhere in the payload.

An unrecognized detection severity defaults to `redact` in the policy engine
(`policy-engine.js`'s `DEFAULT_POLICY` lookup returns `undefined` for
anything not in the map, and `applyPolicy` treats that as `"redact"`) —
the failure mode for "we don't know what this is" is *block it*, not *let it
through*.

## What's NOT covered yet

- **Faces / images / canvas content** — no vision model is wired up (see
  `CURRENT_IMPLEMENTATION.md`). A screenshot is never captured or sent in
  this build; only DOM text and attributes.
- **Free text with no structural signal** — a bare name typed into a
  generic-looking textarea with no label ("just call me Rahul") will not be
  caught by the rules layer. This is exactly the gap Phase 3's model-backed
  detection is meant to close.
- **Non-Indian phone formats** beyond a loose generic international pattern
  used only inside the (currently unused) extended pattern set.

## Privacy manifest shape

Attached to every request the gate allows through:
