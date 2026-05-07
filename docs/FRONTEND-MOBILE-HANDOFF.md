# Frontend/Mobile Handoff

## Status atual do backend
- API modular pronta para consumo mobile/web.
- JWT com refresh token rotativo.
- Fluxo de pagamentos Mercado Pago implementado (pre-autorizacao, captura, cancelamento/estorno).
- Callbacks de onboarding sem frontend: `GET /mp/return` e `GET /mp/refresh`.
- Contrato API disponivel em Swagger (`/api/docs`) e exportavel para arquivo (`npm run docs:openapi`).

## Contrato para o frontend
1. Suba a API.
2. Gere contrato local:
```bash
npm run docs:openapi
```
3. Use `docs/openapi.json` para gerar client tipado no frontend/mobile.

## Fluxos de tela recomendados (ordem)
1. Autenticacao:
   - `POST /api/auth/register`
   - `POST /api/auth/login`
   - `POST /api/auth/refresh`
   - `POST /api/auth/logout`
2. Home e busca:
   - `GET /api/categories`
   - `GET /api/providers`
   - `GET /api/providers/:providerId`
3. Favoritos:
   - `GET /api/favorites`
   - `POST /api/favorites`
   - `DELETE /api/favorites/:providerId`
4. Perfil profissional e agenda:
   - `POST /api/providers/profile`
   - `GET /api/availability/me`
   - `POST /api/availability`
5. Agendamentos:
   - `POST /api/bookings`
   - `GET /api/bookings/me`
   - `PATCH /api/bookings/:bookingId/status`
6. Avaliacoes:
   - `POST /api/reviews`
7. Pagamentos:
   - `GET /api/payments/customer`
   - `POST /api/payments/customer/setup-intent`
   - `POST /api/payments/customer/setup-intent/confirm`
   - `POST /api/payments/customer/setup` (legado, opcional)
   - `POST /api/payments/provider/account`
   - `POST /api/payments/provider/account/onboarding-link`
   - `GET /api/payments/provider/account`
   - `GET /api/payments/booking/:bookingId`

## Regras importantes para UX
- Booking so pode virar `COMPLETED` com confirmacao de cliente e provider, ou captura automatica apos janela configurada no backend.
- Review so pode ser criada apos agendamento concluido.
- Provider profile exige `priceCents`.
- Fluxo de onboarding do provider deve tratar retorno e refresh do Mercado Pago.

## Checklist de integracao mobile
- Armazenar `accessToken` e `refreshToken` com seguranca.
- Renovar token automaticamente em erro `401`.
- Tratar estados de pagamento no detalhe do agendamento.
- Tratar indisponibilidade/timeout com retry e mensagens claras.
- Adicionar telemetria de erros de API por endpoint.
