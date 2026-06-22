BEGIN;

CREATE TABLE IF NOT EXISTS readmax.bug_report_group (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bug_report_group_status_check CHECK (
        status IN ('new', 'triaged', 'in_progress', 'resolved', 'closed', 'wont_fix')
    )
);

CREATE TABLE IF NOT EXISTS readmax.bug_report (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    message TEXT NOT NULL,
    context JSONB,
    status TEXT NOT NULL DEFAULT 'new',
    group_id UUID REFERENCES readmax.bug_report_group(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bug_report_status_check CHECK (
        status IN ('new', 'triaged', 'in_progress', 'resolved', 'closed', 'wont_fix')
    )
);

CREATE INDEX IF NOT EXISTS bug_report_user_id_idx ON readmax.bug_report(user_id);
CREATE INDEX IF NOT EXISTS bug_report_group_id_idx ON readmax.bug_report(group_id);
CREATE INDEX IF NOT EXISTS bug_report_status_idx ON readmax.bug_report(status);

COMMIT;