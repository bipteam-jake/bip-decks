-- CreateEnum
CREATE TYPE "AIConversationKind" AS ENUM ('EDITOR', 'OUTLINE');

-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN     "kind" "AIConversationKind" NOT NULL DEFAULT 'EDITOR';

-- CreateIndex
CREATE INDEX "ai_conversations_deck_id_kind_idx" ON "ai_conversations"("deck_id", "kind");
