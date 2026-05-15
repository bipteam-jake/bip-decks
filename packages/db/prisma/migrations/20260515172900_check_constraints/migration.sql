-- Phase 1 CHECK constraints from docs/bip-deck-platform-data-model.md §4.3.
-- These cannot be expressed in the Prisma schema and must be applied as raw SQL.

ALTER TABLE comments ADD CONSTRAINT comment_exactly_one_author
  CHECK ((author_user_id IS NOT NULL)::int + (author_recipient_id IS NOT NULL)::int = 1);

ALTER TABLE votes ADD CONSTRAINT vote_exactly_one_voter
  CHECK ((user_id IS NOT NULL)::int + (recipient_id IS NOT NULL)::int = 1);

ALTER TABLE votes ADD CONSTRAINT vote_direction_valid
  CHECK (direction IN (-1, 1));

ALTER TABLE share_links ADD CONSTRAINT share_link_snapshot_has_commit
  CHECK (version_binding = 'LIVE' OR bound_commit_sha IS NOT NULL);
