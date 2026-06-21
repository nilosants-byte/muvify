export function useFonts() {
  return [true, null] as const;
}

export function isLoaded() {
  return true;
}

export function isLoading() {
  return false;
}

export function getLoadedFonts() {
  return [];
}

export async function loadAsync() {
  return undefined;
}

export async function unloadAsync() {
  return undefined;
}

export async function unloadAllAsync() {
  return undefined;
}

export enum FontDisplay {
  AUTO = "auto",
  BLOCK = "block",
  SWAP = "swap",
  FALLBACK = "fallback",
  OPTIONAL = "optional",
}
