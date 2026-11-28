// App lock: a passcode (stored only as a salted PBKDF2 hash) plus optional Face ID through the
// phone's built-in passkey support. While locked, the app's screens are not drawn at all.
// This hides the app from someone holding your unlocked phone; it is not encryption of the data.

const KEY = "gameplan:lock";
interface LockCfg { hash: string; salt: string; len: number; credId: string | null; after: number }

const enc = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function lockCfg(): LockCfg | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return v && v.hash ? v : null; } catch { return null; }
}
const writeCfg = (c: LockCfg | null) => { try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

async function hashPin(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return enc(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256));
}
export async function setPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const old = lockCfg();
  writeCfg({ hash: await hashPin(pin, salt), salt: enc(salt), len: pin.length, credId: old?.credId ?? null, after: old?.after ?? 1 });
}
export async function checkPin(pin: string) {
  const c = lockCfg();
  return !!c && (await hashPin(pin, dec(c.salt))) === c.hash;
}
export function removeLock() { writeCfg(null); }
export function setAfter(min: number) { const c = lockCfg(); if (c) writeCfg({ ...c, after: min }); }

export const faceIdSupported = () => !!window.PublicKeyCredential && !!navigator.credentials;
/** Register a passkey on this phone. iPhone asks for Face ID (or Touch ID) to create it. */
export async function enableFaceId() {
  const c = lockCfg();
  if (!c) throw new Error("Set a passcode first.");
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Game Plan", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "Game Plan lock", displayName: "Game Plan lock" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Face ID wasn't set up.");
  writeCfg({ ...c, credId: enc(cred.rawId) });
}
export function disableFaceId() { const c = lockCfg(); if (c) writeCfg({ ...c, credId: null }); }
export async function unlockWithFaceId() {
  const c = lockCfg();
  if (!c?.credId) return false;
  try {
    const r = await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: dec(c.credId) }], userVerification: "required", timeout: 60000 },
    });
    return !!r;
  } catch { return false; }
}

/* ---------- when to lock ---------- */
let locked = !!lockCfg();
let hiddenAt = 0;
export const isLocked = () => locked;
export const unlock = () => { locked = false; };
export const lockNow = () => { if (lockCfg()) locked = true; };
/** Call on visibility changes. Hides the screen right away so the app switcher shows nothing private. */
export function onVisibility(visible: boolean) {
  const c = lockCfg();
  if (!c) return;
  if (!visible) { hiddenAt = Date.now(); document.documentElement.classList.add("veiled"); return; }
  document.documentElement.classList.remove("veiled");
  if (Date.now() - hiddenAt >= c.after * 60000) locked = true;
}
