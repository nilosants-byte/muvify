import { env } from "./env";

/**
 * Feature flags globais da aplicação.
 *
 * Frente 17 (segunda camada, prontidão de lançamento): viraram env var
 * (ENABLE_VIDEO_UPLOAD/ENABLE_REALTIME_CHAT, ambas default true) em vez de
 * constante hardcoded — trocar o valor sem editar código/commitar/deployar
 * é o que torna isso um kill switch operável de verdade sob pressão.
 *
 * Enquanto ENABLE_VIDEO_UPLOAD = false:
 *   - Novos vídeos NÃO são aceitos nem salvos (perfil do personal e exercícios)
 *   - O endpoint GET /providers/:id/video retorna 404
 *   - getById do provider retorna presentationVideoUrl: null
 *   - Exercícios do tipo VIDEO têm mediaUrl ocultado nas respostas
 */
export const ENABLE_VIDEO_UPLOAD = env.ENABLE_VIDEO_UPLOAD;

/**
 * Enquanto ENABLE_REALTIME_CHAT = false:
 *   - O servidor de WebSocket continua de pé (conexões são aceitas), mas
 *     nenhuma mensagem nova é emitida em tempo real.
 *   - O app mobile continua funcionando pelo polling tradicional (REST).
 *   - Serve como "desligadora" de emergência sem precisar de novo deploy do app.
 */
export const ENABLE_REALTIME_CHAT = env.ENABLE_REALTIME_CHAT;
