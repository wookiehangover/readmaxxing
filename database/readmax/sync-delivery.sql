-- Additive custody. No automatic expiry; account deletion must explicitly handle retained data.
CREATE TABLE IF NOT EXISTS readmax.sync_resource_binding (
  namespace TEXT NOT NULL, resource_id TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES readmax."user"(id) ON DELETE RESTRICT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(namespace, resource_id)
);
CREATE SEQUENCE IF NOT EXISTS readmax.sync_delivery_update_seq;
CREATE TABLE IF NOT EXISTS readmax.sync_delivery_receipt (
  receipt_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES readmax."user"(id) ON DELETE RESTRICT,
  change_id TEXT NOT NULL, fingerprint_version INTEGER NOT NULL DEFAULT 1,
  payload_fingerprint TEXT NOT NULL, original_snapshot JSONB NOT NULL,
  source_clock JSONB NOT NULL, original_references JSONB NOT NULL,
  entity TEXT GENERATED ALWAYS AS (original_snapshot->>'entity') STORED,
  entity_id TEXT GENERATED ALWAYS AS (original_snapshot->>'entityId') STORED,
  payload_bytes BIGINT NOT NULL CHECK(payload_bytes > 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  state TEXT NOT NULL DEFAULT 'received' CHECK(state IN ('received','applied','covered','waiting_clock','waiting_dependency','retry_pending','needs_resolution','resolved')),
  reason_code TEXT NOT NULL DEFAULT 'received', target_entity_id TEXT,
  decision_version INTEGER NOT NULL DEFAULT 0, decision_evidence JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  update_seq BIGINT NOT NULL DEFAULT nextval('readmax.sync_delivery_update_seq'),
  next_attempt_at TIMESTAMPTZ DEFAULT clock_timestamp(), attempts INTEGER NOT NULL DEFAULT 0,
  lease_token UUID, lease_until TIMESTAMPTZ,
  UNIQUE(account_id, change_id, fingerprint_version, payload_fingerprint),
  UNIQUE(account_id, receipt_id)
);
CREATE INDEX IF NOT EXISTS sync_delivery_due ON readmax.sync_delivery_receipt(next_attempt_at,account_id) WHERE next_attempt_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS sync_delivery_updates ON readmax.sync_delivery_receipt(account_id,update_seq);
CREATE INDEX IF NOT EXISTS sync_delivery_parent ON readmax.sync_delivery_receipt(account_id,entity,entity_id,received_at);
CREATE TABLE IF NOT EXISTS readmax.sync_delivery_resolution (
  account_id UUID NOT NULL, resolution_id TEXT NOT NULL, receipt_id UUID NOT NULL,
  request JSONB NOT NULL, result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,resolution_id),
  FOREIGN KEY(account_id,receipt_id) REFERENCES readmax.sync_delivery_receipt(account_id,receipt_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS readmax.sync_delivery_scheduler (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id), last_start TIMESTAMPTZ,
  last_success TIMESTAMPTZ, oldest_due TIMESTAMPTZ, due_growth_ticks INTEGER NOT NULL DEFAULT 0, processing_errors BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS readmax.sync_alias_revision (
  account_id UUID PRIMARY KEY REFERENCES readmax."user"(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 0, bootstrapped BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS readmax.sync_alias_event (
  account_id UUID NOT NULL REFERENCES readmax."user"(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  PRIMARY KEY(account_id,revision)
);
CREATE OR REPLACE FUNCTION readmax.protect_delivery_custody() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Explicit account custody deletion is required'; END IF;
  IF (NEW.receipt_id,NEW.account_id,NEW.change_id,NEW.fingerprint_version,NEW.payload_fingerprint,
      NEW.original_snapshot,NEW.source_clock,NEW.original_references,NEW.payload_bytes,NEW.received_at)
    IS DISTINCT FROM
     (OLD.receipt_id,OLD.account_id,OLD.change_id,OLD.fingerprint_version,OLD.payload_fingerprint,
      OLD.original_snapshot,OLD.source_clock,OLD.original_references,OLD.payload_bytes,OLD.received_at)
  THEN RAISE EXCEPTION 'Delivery custody is immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_delivery_custody ON readmax.sync_delivery_receipt;
CREATE TRIGGER protect_delivery_custody BEFORE UPDATE OR DELETE ON readmax.sync_delivery_receipt
FOR EACH ROW EXECUTE FUNCTION readmax.protect_delivery_custody();
CREATE OR REPLACE FUNCTION readmax.record_sync_alias() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v BIGINT;
BEGIN
  IF NEW.canonical_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.canonical_id IS NOT DISTINCT FROM OLD.canonical_id THEN RETURN NEW; END IF;
  INSERT INTO readmax.sync_alias_revision(account_id,revision) VALUES(NEW.user_id,1)
  ON CONFLICT(account_id) DO UPDATE SET revision=readmax.sync_alias_revision.revision+1 RETURNING revision INTO v;
  INSERT INTO readmax.sync_alias_event(account_id,revision,from_id,to_id) VALUES(NEW.user_id,v,NEW.id,NEW.canonical_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_sync_alias ON readmax.book;
CREATE TRIGGER record_sync_alias AFTER INSERT OR UPDATE OF canonical_id ON readmax.book
FOR EACH ROW EXECUTE FUNCTION readmax.record_sync_alias();
-- Corrected canonical writers cannot steal a first-bound pending identity.
CREATE OR REPLACE FUNCTION readmax.enforce_sync_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a UUID; parent TEXT; ns TEXT;
BEGIN
  ns := TG_TABLE_NAME;
  IF TG_OP = 'UPDATE' AND NEW.id=OLD.id AND NEW.user_id=OLD.user_id THEN
    IF ns='book' THEN RETURN NEW; END IF;
    IF NEW.book_id IS NOT DISTINCT FROM OLD.book_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('sync-resource-binding'));
  INSERT INTO readmax.sync_resource_binding(namespace,resource_id,account_id) VALUES(ns,NEW.id,NEW.user_id)
    ON CONFLICT(namespace,resource_id) DO NOTHING;
  SELECT account_id INTO a FROM readmax.sync_resource_binding WHERE namespace=ns AND resource_id=NEW.id;
  IF a <> NEW.user_id THEN RAISE EXCEPTION 'Resource ownership conflict'; END IF;
  IF ns <> 'book' THEN
    parent := NEW.book_id;
    IF parent IS NOT NULL THEN
      IF EXISTS(SELECT 1 FROM readmax.book WHERE id=parent AND user_id<>NEW.user_id) THEN RAISE EXCEPTION 'Parent ownership conflict'; END IF;
      INSERT INTO readmax.sync_resource_binding(namespace,resource_id,account_id) VALUES('book',parent,NEW.user_id) ON CONFLICT DO NOTHING;
      SELECT account_id INTO a FROM readmax.sync_resource_binding WHERE namespace='book' AND resource_id=parent;
      IF a <> NEW.user_id THEN RAISE EXCEPTION 'Parent ownership conflict'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['book','highlight','bookmark','chat_session'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_sync_binding ON readmax.%I',t);
    EXECUTE format('CREATE TRIGGER enforce_sync_binding BEFORE INSERT OR UPDATE ON readmax.%I FOR EACH ROW EXECUTE FUNCTION readmax.enforce_sync_binding()',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION readmax.protect_sync_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Sync ownership and alias evidence must be retained'; END IF;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Sync ownership and alias evidence is immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_sync_evidence ON readmax.sync_resource_binding;
CREATE TRIGGER protect_sync_evidence BEFORE UPDATE OR DELETE ON readmax.sync_resource_binding FOR EACH ROW EXECUTE FUNCTION readmax.protect_sync_evidence();
DROP TRIGGER IF EXISTS protect_sync_evidence ON readmax.sync_alias_event;
CREATE TRIGGER protect_sync_evidence BEFORE UPDATE OR DELETE ON readmax.sync_alias_event FOR EACH ROW EXECUTE FUNCTION readmax.protect_sync_evidence();
CREATE OR REPLACE FUNCTION readmax.enforce_sync_message_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner UUID; bound UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sync-resource-binding'));
  SELECT user_id INTO owner FROM readmax.chat_session WHERE id=NEW.session_id;
  IF owner IS NULL THEN RETURN NEW; END IF;
  INSERT INTO readmax.sync_resource_binding(namespace,resource_id,account_id) VALUES('chat_message',NEW.id,owner) ON CONFLICT DO NOTHING;
  SELECT account_id INTO bound FROM readmax.sync_resource_binding WHERE namespace='chat_message' AND resource_id=NEW.id;
  IF bound <> owner THEN RAISE EXCEPTION 'Message ownership conflict'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_sync_message_binding ON readmax.chat_message;
CREATE TRIGGER enforce_sync_message_binding BEFORE INSERT OR UPDATE ON readmax.chat_message FOR EACH ROW EXECUTE FUNCTION readmax.enforce_sync_message_binding();
CREATE OR REPLACE FUNCTION readmax.enforce_sync_scoped_parent_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bound UUID;
BEGIN
  IF TG_OP='UPDATE' AND NEW.user_id=OLD.user_id AND NEW.book_id=OLD.book_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('sync-resource-binding'));
  IF EXISTS(SELECT 1 FROM readmax.book WHERE id=NEW.book_id AND user_id<>NEW.user_id) THEN RAISE EXCEPTION 'Parent ownership conflict'; END IF;
  INSERT INTO readmax.sync_resource_binding(namespace,resource_id,account_id) VALUES('book',NEW.book_id,NEW.user_id) ON CONFLICT DO NOTHING;
  SELECT account_id INTO bound FROM readmax.sync_resource_binding WHERE namespace='book' AND resource_id=NEW.book_id;
  IF bound <> NEW.user_id THEN RAISE EXCEPTION 'Parent ownership conflict'; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['notebook','reading_position'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_sync_scoped_parent_binding ON readmax.%I',t);
    EXECUTE format('CREATE TRIGGER enforce_sync_scoped_parent_binding BEFORE INSERT OR UPDATE ON readmax.%I FOR EACH ROW EXECUTE FUNCTION readmax.enforce_sync_scoped_parent_binding()',t);
  END LOOP;
END $$;
