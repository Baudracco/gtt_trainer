# API response catalogue

Base path `/api/v1`. JSON success is `{ "data": ..., "trace_id": "..." }`.
JSON failure is `{ "error": { "code": "...", "number": 2099, "message": "..." }, "trace_id": "..." }`.
Every response includes `X-Trace-Id` and `Cache-Control: no-store`. Report success is HTML/PDF.

| Number | HTTP | Machine code | Meaning |
| --- | --- | --- | --- |
| 2001 | 400 | `invalid_json` | Invalid JSON or request root is not an object. |
| 2002 | 401 | `invalid_credentials` | Invalid, unknown or disabled login; same outward response. |
| 2003 | 401 | `authentication_required` | An authenticated session is required before role checks. |
| 2004 | 403 | `permission_denied` | Current enabled user lacks the required role. |
| 2005 | 403 | `csrf_failed` | Missing/stale CSRF token or unexpected Origin on a write. |
| 2006 | 404 | `not_found` | Endpoint, variant or visible revision not found. |
| 2007 | 409 | `version_conflict` | Variant version differs from `expectedVersion`; reload before retrying. |
| 2008 | 409 | `invalid_transition` | Only draft → review → published is allowed. |
| 2009 | 409 | `stop_conflict` | Existing stop identity cannot acquire a different external code. |
| 2010 | 409 | `data_conflict` | Concurrent uniqueness, serialization or deadlock conflict. Entire mutation rolls back. |
| 2011 | 413 | `payload_too_large` | Request body exceeds 4 MiB. |
| 2012 | 415 | `unsupported_media_type` | JSON writes require `application/json`; media uploads use multipart. |
| 2013 | 413 | `media_too_large` | Photo/video or configured PHP upload cap exceeded. |
| 2014 | 415 | `unsupported_media` | Unsupported image/video format or codec. |
| 2015 | 416 | `invalid_range` | Requested media byte range cannot be served. |
| 2016 | 422 | `invalid_media` | Incomplete/corrupt upload or missing/wrong-kind attachment reference. |
| 2017 | 422 | `validation_failed` | Invalid UUID, text, geometry, direction, membership, offset or travel order. |
| 2018 | 422 | `publication_incomplete` | Missing source, reviewed instructions or explicit verification. |
| 2019 | 429 | `rate_limited` | General, account, IP or report budget exhausted; includes `Retry-After`. |
| 2099 | 500 | `internal_error` | Opaque server failure; correlate through trace ID. No SQL, paths or request bodies are exposed. |

Session bootstrap: GET `/session`, retain its cookie and CSRF token, POST `/login` with
`X-CSRF-Token`, then use the new CSRF token after session rotation. Cookies are HttpOnly,
SameSite=Strict, Secure outside explicit development. Origin must match `APP_ORIGIN`.
Sessions expire after 2h inactivity or 24h absolute lifetime. Every authenticated request
checks that the account remains enabled and reads its current role. Account creation is CLI-only.

Anonymous/viewer reads only current publications. Editor can author, review, trash, restore
and revert. Admin can publish. All saves preserve complete snapshots, with a new revision
number and optimistic variant version. Batch imports are atomic and create drafts only.

API query parameters are rejected. Revisions use `/routes/{id}/revisions/{revisionId}`,
reports append `/report/{lang}.{format}`, and trash uses `/routes/trash`. Uploads use
multipart `file` at `/media/photos` or `/media/videos`; media reads support GET/HEAD and
the Range header. See [media and URLs](MEDIA_AND_URLS.md).

Limits: 240 API requests/IP/minute, 20 logins/IP/15min, 10 logins/account/15min,
15 reports/IP/minute. Proxy headers are not trusted; configure the reverse proxy so PHP's
`REMOTE_ADDR` is the actual trusted client address. Location is never an API input.

Numeric identifiers are GTT-specific and never reassigned. `error.code` remains the stable machine key; `error.number` is additive. Unexpected failures retain sanitized DB/file/native diagnostics with the same trace. [Implementation and Shortener provenance](SHORTENER_REUSE.md). Nginx/PHP infrastructure failures before the controller (for example upstream timeout or rejected oversized multipart body) may return their native HTML status, which the client treats as an invalid/failed response.
