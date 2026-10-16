-- Diagnostics are independent of append-only business audit_events.
CREATE TABLE system_logs (
    id bigserial PRIMARY KEY,
    trace_id text NOT NULL,
    error_code text NOT NULL,
    error_number integer NOT NULL,
    exception_type text NOT NULL,
    sql_state text NOT NULL,
    source_file text NOT NULL,
    source_line integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_logs_trace_idx ON system_logs(trace_id);
CREATE INDEX system_logs_created_idx ON system_logs(created_at);
