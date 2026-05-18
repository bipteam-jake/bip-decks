-- CreateTable
CREATE TABLE "brand_kit_patterns" (
    "id" UUID NOT NULL,
    "brand_kit_version_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "html_template" TEXT NOT NULL,
    "css_template" TEXT,
    "parameters" JSONB NOT NULL,
    "thumbnail_s3_key" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kit_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_kit_patterns_brand_kit_version_id_idx" ON "brand_kit_patterns"("brand_kit_version_id");

-- CreateIndex
CREATE INDEX "brand_kit_patterns_approved_idx" ON "brand_kit_patterns"("approved");

-- CreateIndex
CREATE INDEX "brand_kit_patterns_category_idx" ON "brand_kit_patterns"("category");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kit_patterns_brand_kit_version_id_slug_key" ON "brand_kit_patterns"("brand_kit_version_id", "slug");

-- AddForeignKey
ALTER TABLE "brand_kit_patterns" ADD CONSTRAINT "brand_kit_patterns_brand_kit_version_id_fkey" FOREIGN KEY ("brand_kit_version_id") REFERENCES "brand_kit_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit_patterns" ADD CONSTRAINT "brand_kit_patterns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
