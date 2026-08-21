// Extraído de duplicação entre MvVideoPlayer.tsx e
// ProfessionalTrainingCreationScreen.tsx (ExerciseThumb) antes de introduzir
// um terceiro uso (miniatura vertical compacta do card de exercício + modal
// de preview) — evita uma terceira cópia da mesma regex.
export function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([^&\s?/]+)/i);
  return match?.[1] ?? null;
}

export function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

// Atalho pros callers que só têm a URL em mãos (não o id já extraído).
export function getYouTubeThumbnailFromUrl(url: string): string | null {
  const id = getYouTubeId(url);
  return id ? getYouTubeThumbnail(id) : null;
}

// Nota de qualidade: mqdefault.jpg é sempre 320x180 (proporção 16:9) — o
// YouTube não expõe uma miniatura .jpg nativa em 9:16 pra Shorts. Numa
// Image com resizeMode="cover" dentro de um container vertical, isso
// aparece "letterboxed" (cortada nas laterais) em vez de enquadrar o vídeo
// inteiro. É uma limitação conhecida da API pública de thumbnail do
// YouTube, não um bug deste código — não há alternativa nativa confiável
// sem gerar a miniatura no upload.
