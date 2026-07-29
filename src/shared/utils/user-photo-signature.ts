import crypto from "crypto";
import { env } from "../../config/env";

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 2: 7 dias era tempo
// demais pra uma URL que funciona como "bearer token" enquanto válida — o
// app já rebusca o perfil/URL com frequência normal de uso, então 24h
// reduz a janela de exposição sem quebrar cache legítimo de sessão.
const USER_PHOTO_URL_TTL_SECONDS = 24 * 60 * 60;

function getSecret() {
  return (env.APP_ENCRYPTION_KEY?.trim() || env.JWT_SECRET).trim();
}

function buildPayload(userId: string, exp: number) {
  return `user-photo:${userId}:${exp}`;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function safeEqualsHex(a: string, b: string) {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function createUserPhotoSignatureQuery(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + USER_PHOTO_URL_TTL_SECONDS;
  const sig = sign(buildPayload(userId, exp));
  return `exp=${exp}&sig=${sig}`;
}

export function verifyUserPhotoSignature(input: {
  userId: string;
  exp: string | number | undefined;
  sig: string | undefined;
}) {
  const { userId, exp, sig } = input;
  const parsedExp = typeof exp === "number" ? exp : Number(exp);
  if (!Number.isFinite(parsedExp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (parsedExp < now) return false;
  if (!sig || !/^[a-fA-F0-9]{64}$/.test(sig)) return false;
  const expected = sign(buildPayload(userId, parsedExp));
  return safeEqualsHex(sig.toLowerCase(), expected.toLowerCase());
}

