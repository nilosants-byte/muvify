import crypto from "crypto";
import { env } from "../../config/env";

// Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: documento de CREF é
// documento de identidade — TTL bem mais curto que o de foto de perfil
// (assinado só no momento de exibir a fila de revisão ou a própria tela de
// credenciais, não fica em cache por dias).
const CREF_DOCUMENT_URL_TTL_SECONDS = 15 * 60;

function getSecret() {
  return (env.APP_ENCRYPTION_KEY?.trim() || env.JWT_SECRET).trim();
}

function buildPayload(providerId: string, key: string, exp: number) {
  return `cref-document:${providerId}:${key}:${exp}`;
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

export function createCrefDocumentSignatureQuery(providerId: string, key: string) {
  const exp = Math.floor(Date.now() / 1000) + CREF_DOCUMENT_URL_TTL_SECONDS;
  const sig = sign(buildPayload(providerId, key, exp));
  return `exp=${exp}&sig=${sig}`;
}

export function verifyCrefDocumentSignature(input: {
  providerId: string;
  key: string;
  exp: string | number | undefined;
  sig: string | undefined;
}) {
  const { providerId, key, exp, sig } = input;
  const parsedExp = typeof exp === "number" ? exp : Number(exp);
  if (!Number.isFinite(parsedExp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (parsedExp < now) return false;
  if (!sig || !/^[a-fA-F0-9]{64}$/.test(sig)) return false;
  const expected = sign(buildPayload(providerId, key, parsedExp));
  return safeEqualsHex(sig.toLowerCase(), expected.toLowerCase());
}
