# Helpers E2E

Flows reutilizáveis (`runFlow: ../helpers/_arquivo.yaml`) e convenções.

- `_login-client.yaml` / `_login-professional.yaml` / `_login-admin.yaml`: autenticam cada papel
  a partir da tela de login. Admin lê `${ADMIN_EMAIL}`/`${ADMIN_PASSWORD}` do ambiente.
- `_logout.yaml`: faz logout do papel CLIENT (Perfil > engrenagem > Sair da conta). O
  profissional sai pelo drawer (`button.professional.open-drawer` + botão "Sair" do menu).

## Convenção de testID

- IDs estáveis de tela: `screen.<dominio>.<tela>`
- IDs estáveis de botões: `button.<dominio>.<acao>`
- IDs estáveis de inputs: `input.<dominio>.<campo>`
- IDs da bottom nav: `nav.bottom.<key>` (profissional) / `nav.client.v2.<key>` (cliente)

Antes de commitar um flow novo, confira que todo `id:` referenciado existe de fato no código
(`grep -rn "testID=\"<id>\"" ../../src`) — testID drift foi a causa raiz de as duas árvores E2E
antigas terem apodrecido em silêncio (Frente 16, segunda camada).
