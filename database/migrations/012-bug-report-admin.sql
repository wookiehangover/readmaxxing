BEGIN;

ALTER TABLE readmax.bug_report
    DROP CONSTRAINT IF EXISTS bug_report_status_check;

ALTER TABLE readmax.bug_report_group
    DROP CONSTRAINT IF EXISTS bug_report_group_status_check;

UPDATE readmax.bug_report
SET status = CASE status
    WHEN 'new' THEN 'pending'
    WHEN 'triaged' THEN 'scheduled'
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'resolved' THEN 'shipped'
    WHEN 'closed' THEN 'cancelled'
    WHEN 'wont_fix' THEN 'cancelled'
    ELSE status
END
WHERE status IN ('new', 'triaged', 'in_progress', 'resolved', 'closed', 'wont_fix');

UPDATE readmax.bug_report_group
SET status = CASE status
    WHEN 'new' THEN 'pending'
    WHEN 'triaged' THEN 'scheduled'
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'resolved' THEN 'shipped'
    WHEN 'closed' THEN 'cancelled'
    WHEN 'wont_fix' THEN 'cancelled'
    ELSE status
END
WHERE status IN ('new', 'triaged', 'in_progress', 'resolved', 'closed', 'wont_fix');

ALTER TABLE readmax.bug_report
    ALTER COLUMN status SET DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD CONSTRAINT bug_report_status_check CHECK (
        status IN ('pending', 'scheduled', 'in_progress', 'shipped', 'cancelled')
    );

ALTER TABLE readmax.bug_report_group
    ALTER COLUMN status SET DEFAULT 'pending',
    ADD CONSTRAINT bug_report_group_status_check CHECK (
        status IN ('pending', 'scheduled', 'in_progress', 'shipped', 'cancelled')
    );

COMMIT;