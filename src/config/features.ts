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

/**
 * Enquanto ENABLE_REALTIME_CHAT = false:
 *   - O servidor de WebSocket continua de pé (conexões são aceitas), mas
 *     nenhuma mensagem nova é emitida em tempo real.
 *   - O app mobile continua funcionando pelo polling tradicional (REST).
 *   - Serve como "desligadora" de emergência sem precisar de novo deploy do app.
 */
export const ENABLE_REALTIME_CHAT = true;
