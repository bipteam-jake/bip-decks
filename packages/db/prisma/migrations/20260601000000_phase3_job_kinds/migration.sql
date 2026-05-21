-- Phase 3 chunk 1: extend JobKind with the kinds the BullMQ worker will
-- dispatch to. Only AI_EDIT has a real handler in chunk 1; the others
-- have stubs that throw NotImplementedError so we can confirm dispatch
-- end-to-end before later chunks fill them in.
--
-- Postgres requires ALTER TYPE ... ADD VALUE statements to be issued
-- outside a transaction; Prisma's runner respects that automatically
-- when each statement is on its own.

ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'AGENTIC_EDIT';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'TRIAGE_SLIDE';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'TRIAGE_ROLLUP';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'MINI_TRIAGE';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'PDF_EXPORT';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'GENERATE_PATTERN_THUMBNAIL';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'PDF_EXTRACT';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'IMAGE_PROCESS';
