# API response catalogue

Base path `/api/v1`. JSON success is `{ "data": ..., "trace_id": "..." }`.
JSON failure is `{ "error": { "code": "...", "message": "..." }, "trace_id": "..." }`.
Every response includes `X-Trace-Id` and `Cache-Control: no-store`. Report success is HTML/PDF.

| HTTP | Machine code | Meaning |
| --- | --- | --- |
| 400 | `invalid_json` | Invalid JSON or request root is not an object. |
| 401 | `invalid_credentials` | Invalid, unknown or disabled login; same outward response. |
| 401 | `authentication_required` | An authenticated session is required before role checks. |
| 403 | `permission_denied` | Current enabled user lacks the required role. |
| 403 | `csrf_failed` | Missing/stale CSRF token or unexpected Origin on a write. |
| 404 | `not_found` | Endpoint, variant or visible revision not found. |
| 409 | `version_conflict` | Variant version differs from `expectedVersion`; reload before retrying. |
| 409 | `invalid_transition` | Only draft → review → published is allowed. |
| 409 | `stop_conflict` | Existing stop identity cannot acquire a different external code. |
| 409 | `data_conflict` | Concurrent uniqueness, serialization or deadlock conflict. Entire mutation rolls back. |
| 413 | `payload_too_large` | Request body exceeds 4 MiB. |
| 415 | `unsupported_media_type` | Writes require `application/json`. |
| 422 | `validation_failed` | Invalid UUID, text, geometry, direction, membership, offset or travel order. |
| 422 | `publication_incomplete` | Missing source, reviewed instructions or explicit verification. |
| 429 | `rate_limited` | General, account, IP or report budget exhausted; includes `Retry-After`. |
| 500 | `internal_error` | Opaque server failure; correlate through trace ID. No SQL, paths or request bodies are exposed. |

Session bootstrap: GET `/session`, retain its cookie and CSRF token, POST `/login` with
`X-CSRF-Token`, then use the new CSRF token after session rotation. Cookies are HttpOnly,
SameSite=Strict, Secure outside explicit development. Origin must match `APP_ORIGIN`.
Sessions expire after 2h inactivity or 24h absolute lifetime. Every authenticated request
checks that the account remains enabled and reads its current role. Account creation is CLI-only.

Anonymous/viewer reads only current publications. Editor can author, review, trash, restore
and revert. Admin can publish. All saves preserve complete snapshots, with a new revision
number and optimistic variant version. Batch imports are atomic and create drafts only.

Limits: 240 API requests/IP/minute, 20 logins/IP/15min, 10 logins/account/15min,
15 reports/IP/minute. Proxy headers are not trusted; configure the reverse proxy so PHP's
`REMOTE_ADDR` is the actual trusted client address. Location is never an API input.
