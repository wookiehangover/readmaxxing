-- Explicit local recovery admission: append-only source identity and received JSON custody.
CREATE TABLE IF NOT EXISTS readmax.sync_recovery_admission (
  account_id UUID NOT NULL, admission_id TEXT NOT NULL, receipt_id UUID NOT NULL,
  request JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,admission_id),
  FOREIGN KEY(account_id,receipt_id) REFERENCES readmax.sync_delivery_receipt(account_id,receipt_id) ON DELETE RESTRICT
);
DROP TRIGGER IF EXISTS protect_sync_evidence ON readmax.sync_recovery_admission;
CREATE TRIGGER protect_sync_evidence BEFORE UPDATE OR DELETE ON readmax.sync_recovery_admission
FOR EACH ROW EXECUTE FUNCTION readmax.protect_sync_evidence();
