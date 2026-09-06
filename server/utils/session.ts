import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'

// Hash both sides to fixed-length digests before comparing — avoids the length-mismatch
// exception node's timingSafeEqual throws on unequal-length buffers, while keeping the
// constant-time property for the actual PIN comparison in server/api/auth/login.post.ts.
export function timingSafeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest()
  const hashB = createHash('sha256').update(b).digest()
  return nodeTimingSafeEqual(hashA, hashB)
}
