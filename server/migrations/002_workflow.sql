ALTER TABLE route_variants ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE route_revisions ADD COLUMN document jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE route_revisions ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE route_revisions DROP CONSTRAINT route_revisions_status_check;
ALTER TABLE route_revisions ADD CONSTRAINT route_revisions_status_check CHECK(status IN ('draft','review','published','archived'));
CREATE UNIQUE INDEX one_working_revision ON route_revisions(variant_id) WHERE status IN ('draft','review');
ALTER TABLE route_stops ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE rate_limits (bucket text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(reset_at);

-- A published snapshot is immutable, including its stop and instruction content.
CREATE FUNCTION protect_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published','archived') AND
     (TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') OR
      (OLD.status = 'archived' AND NEW.status <> 'archived') OR NEW.status NOT IN ('published','archived')) THEN
    RAISE EXCEPTION 'Published revisions are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON route_revisions FOR EACH ROW EXECUTE FUNCTION protect_revision();
CREATE FUNCTION protect_revision_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO parent_status FROM route_revisions WHERE id = OLD.revision_id;
    IF parent_status IN ('published','archived') THEN RAISE EXCEPTION 'Published revision children are immutable'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO parent_status FROM route_revisions WHERE id = NEW.revision_id;
    IF parent_status IN ('published','archived') THEN RAISE EXCEPTION 'Published revision children are immutable'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_route_stop BEFORE INSERT OR UPDATE OR DELETE ON route_stops FOR EACH ROW EXECUTE FUNCTION protect_revision_child();
CREATE TRIGGER immutable_instruction BEFORE INSERT OR UPDATE OR DELETE ON route_instructions FOR EACH ROW EXECUTE FUNCTION protect_revision_child();
CREATE FUNCTION protect_published_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pointer uuid;
BEGIN
  SELECT published_revision_id INTO pointer FROM route_variants WHERE id = NEW.id;
  IF pointer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM route_revisions WHERE id = pointer AND variant_id = NEW.id AND status = 'published'
  ) THEN RAISE EXCEPTION 'Published pointer must reference a published revision'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER valid_published_pointer AFTER INSERT OR UPDATE ON route_variants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION protect_published_pointer();
CREATE FUNCTION protect_referenced_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM route_variants v JOIN route_revisions r ON r.id = v.published_revision_id
             WHERE r.id = NEW.id AND r.status <> 'published') THEN
    RAISE EXCEPTION 'Current published revision must remain published';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER valid_referenced_status AFTER UPDATE ON route_revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION protect_referenced_status();
CREATE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
CREATE TRIGGER append_only_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
