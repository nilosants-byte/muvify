/**
 * Feature flags globais da aplicação.
 *
 * Enquanto ENABLE_VIDEO_UPLOAD = false:
 *   - Novos vídeos NÃO são aceitos nem salvos (perfil do personal e exercícios)
 *   - O endpoint GET /providers/:id/video retorna 404
 *   - getById do provider retorna presentationVideoUrl: null
 *   - Exercícios do tipo VIDEO têm mediaUrl ocultado nas respostas
 */
export const ENABLE_VIDEO_UPLOAD = true;
