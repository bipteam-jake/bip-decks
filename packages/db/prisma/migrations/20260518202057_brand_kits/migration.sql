-- CreateEnum
CREATE TYPE "BrandKitIdentityKind" AS ENUM ('LOGO_FULL_COLOR', 'LOGO_MONO', 'LOGO_LIGHT_BG', 'LOGO_DARK_BG', 'FAVICON');

-- CreateEnum
CREATE TYPE "BrandKitReferenceKind" AS ENUM ('PDF', 'IMAGE');

-- AlterTable
ALTER TABLE "decks" ADD COLUMN     "brand_kit_version_id" UUID;

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kit_versions" (
    "id" UUID NOT NULL,
    "brand_kit_id" UUID NOT NULL,
    "version_label" TEXT NOT NULL,
    "tokens" JSONB NOT NULL,
    "voice" JSONB NOT NULL,
    "summary" TEXT,
    "published_by_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_kit_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kit_identity_assets" (
    "id" UUID NOT NULL,
    "brand_kit_version_id" UUID NOT NULL,
    "kind" "BrandKitIdentityKind" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "size_bytes" INTEGER NOT NULL,
    "original_filename" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_kit_identity_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kit_references" (
    "id" UUID NOT NULL,
    "brand_kit_version_id" UUID NOT NULL,
    "kind" "BrandKitReferenceKind" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_filename" TEXT NOT NULL,
    "page_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_kit_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_kits_slug_key" ON "brand_kits"("slug");

-- CreateIndex
CREATE INDEX "brand_kits_created_by_id_idx" ON "brand_kits"("created_by_id");

-- CreateIndex
CREATE INDEX "brand_kits_archived_at_idx" ON "brand_kits"("archived_at");

-- CreateIndex
CREATE INDEX "brand_kit_versions_brand_kit_id_idx" ON "brand_kit_versions"("brand_kit_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kit_versions_brand_kit_id_version_label_key" ON "brand_kit_versions"("brand_kit_id", "version_label");

-- CreateIndex
CREATE INDEX "brand_kit_identity_assets_brand_kit_version_id_idx" ON "brand_kit_identity_assets"("brand_kit_version_id");

-- CreateIndex
CREATE INDEX "brand_kit_references_brand_kit_version_id_idx" ON "brand_kit_references"("brand_kit_version_id");

-- CreateIndex
CREATE INDEX "decks_brand_kit_version_id_idx" ON "decks"("brand_kit_version_id");

-- AddForeignKey
ALTER TABLE "decks" ADD CONSTRAINT "decks_brand_kit_version_id_fkey" FOREIGN KEY ("brand_kit_version_id") REFERENCES "brand_kit_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_versions" ADD CONSTRAINT "brand_kit_versions_brand_kit_id_fkey" FOREIGN KEY ("brand_kit_id") REFERENCES "brand_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_versions" ADD CONSTRAINT "brand_kit_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_identity_assets" ADD CONSTRAINT "brand_kit_identity_assets_brand_kit_version_id_fkey" FOREIGN KEY ("brand_kit_version_id") REFERENCES "brand_kit_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_references" ADD CONSTRAINT "brand_kit_references_brand_kit_version_id_fkey" FOREIGN KEY ("brand_kit_version_id") REFERENCES "brand_kit_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
