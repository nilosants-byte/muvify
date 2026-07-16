import { API_BASE_URL } from "../services/api/client";

const SESSION_SALT = Date.now();

function withSessionSalt(url: string) {
  if (url.startsWith("data:") || url.startsWith("file:") || url.startsWith("content:") || url.startsWith("blob:")) {
    return url;
  }
  if (/[?&]_s=\d+/.test(url)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_s=${SESSION_SALT}`;
}

export function resolveMediaUrl(pathOrUrl: string | null | undefined, skipSalt = false): string | null {
  if (!pathOrUrl) return null;
  const value = pathOrUrl.trim();
  if (!value) return null;

  const absolute = value.startsWith("/") ? `${API_BASE_URL}${value}` : value;
  return skipSalt ? absolute : withSessionSalt(absolute);
}
