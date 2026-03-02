import { scrypt, randomBytes, timingSafeEqual } from "crypto"

const SALT_LENGTH = 32
const KEY_LENGTH = 64

export function hashPassword(plain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LENGTH).toString("hex")
    scrypt(plain, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err)
      resolve(`${salt}:${derived.toString("hex")}`)
    })
  })
}

export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(":")
    if (!salt || !hash) return resolve(false)
    scrypt(plain, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err)
      try {
        resolve(timingSafeEqual(Buffer.from(hash, "hex"), derived))
      } catch {
        resolve(false)
      }
    })
  })
}
