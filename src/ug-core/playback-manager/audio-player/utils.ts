export function decodeBase64ToUint8Array(base64String: string): Uint8Array {
  const binary =
    typeof atob !== 'undefined'
      ? atob(base64String)
      : Buffer.from(base64String, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function combineArrays(first: Uint8Array, second: Uint8Array): Uint8Array {
  const combined = new Uint8Array(first.length + second.length)
  combined.set(first)
  combined.set(second, first.length)
  return combined
}
