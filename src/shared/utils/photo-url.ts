import { createUserPhotoSignatureQuery } from "./user-photo-signature";

function appendVersion(path: string, updatedAt?: Date | null) {
  if (!(updatedAt instanceof Date)) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(updatedAt.toISOString())}`;
}

export function toProviderPhotoUrl(
  providerId: string,
  rawPhotoUrl?: string | null,
  updatedAt?: Date | null
) {
  if (!rawPhotoUrl) return null;
  if (!rawPhotoUrl.startsWith("data:image/")) return rawPhotoUrl;
  return appendVersion(`/providers/${providerId}/photo`, updatedAt);
}

export function toUserPhotoUrl(
  userId: string,
  rawPhotoUrl?: string | null,
  updatedAt?: Date | null
) {
  if (!rawPhotoUrl) return null;
  if (!rawPhotoUrl.startsWith("data:image/")) return rawPhotoUrl;
  const pathWithVersion = appendVersion(`/users/${userId}/photo`, updatedAt);
  const separator = pathWithVersion.includes("?") ? "&" : "?";
  return `${pathWithVersion}${separator}${createUserPhotoSignatureQuery(userId)}`;
}

export function toProviderVideoUrl(
  providerId: string,
  rawVideoUrl?: string | null,
  updatedAt?: Date | null
) {
  if (!rawVideoUrl) return null;
  if (!rawVideoUrl.startsWith("data:video/")) return rawVideoUrl;
  return appendVersion(`/providers/${providerId}/video`, updatedAt);
}
