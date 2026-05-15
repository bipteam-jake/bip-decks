// Re-export the generated Prisma client and types so app code imports from
// '@bip/db' rather than reaching into '@prisma/client' directly.
export * from '@prisma/client';
export { PrismaClient } from '@prisma/client';
