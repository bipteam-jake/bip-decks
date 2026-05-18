// Argon2id password hashing. Per architecture doc §6: "custom email + password
// using `argon2`". @node-rs/argon2 ships prebuilt binaries — no node-gyp.
import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (2024).
//   memory: 19 MiB, iterations: 2, parallelism: 1.
// Argon2id is the library default; we don't pass `algorithm` because it's a
// const enum from @node-rs/argon2 and our isolatedModules setting forbids that.
const HASH_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTS);
}

export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // Malformed hash, etc. — treat as failed verification, never throw.
    return false;
  }
}
