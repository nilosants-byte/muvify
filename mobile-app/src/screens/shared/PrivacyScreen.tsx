import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvCard, MvText } from "../../components/mv";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { TERMS_VERSION } from "../../config/legal";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <MvCard>
      <MvText variant="semi2" style={{ marginBottom: 8 }}>{title}</MvText>
      {children}
    </MvCard>
  );
}

function Body({ text }: { text: string }) {
  return (
    <MvText variant="body4" color="secondary" style={{ marginBottom: 6, lineHeight: 20 }}>
      {text}
    </MvText>
  );
}

function Item({ text }: { text: string }) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
      <MvText variant="body4" color="secondary" style={{ color: theme.textGreen }}>•</MvText>
      <MvText variant="body4" color="secondary" style={{ flex: 1, lineHeight: 20 }}>{text}</MvText>
    </View>
  );
}

export function PrivacyScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.bg }}>
        {navigation?.canGoBack?.() ? (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={18} color={theme.text1} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Termos e Privacidade</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>Versão {TERMS_VERSION}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 12 }}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled
        maximumZoomScale={3}
      >
        <Section title="Apresentação">
          <Body text="Este documento reúne, em um só texto, as regras de uso da plataforma Muvify e as regras de privacidade e proteção de dados pessoais dos usuários." />
          <Body text="Ao criar conta, acessar ou usar o Muvify, você declara que leu, entendeu e concorda com este documento." />
        </Section>

        <Section title="O que é o Muvify">
          <Body text="O Muvify é uma plataforma digital que conecta alunos e profissionais de educação física (personais) para contratação de serviços, como treinos presenciais e consultorias online." />
          <Body text="O Muvify atua como plataforma intermediadora de tecnologia e pagamentos, não substitui atendimento médico e não garante resultado físico específico." />
        </Section>

        <Section title="Cadastro, Conta e Responsabilidades">
          <Body text="Para usar o Muvify, o usuário deve informar dados verdadeiros, completos e atualizados. Você é responsável por:" />
          <Item text="Manter sua senha em sigilo" />
          <Item text="Não compartilhar sua conta indevidamente" />
          <Item text="Responder por toda atividade feita com seu login" />
          <Body text="O Muvify poderá suspender ou encerrar contas com indício de fraude, uso indevido, violação de regras, riscos de segurança ou determinação legal." />
        </Section>

        <Section title="Perfis da Plataforma">
          <Body text="A plataforma possui dois perfis de uso: aluno e personal. Para atuar como personal, são exigidos documentos profissionais, incluindo CREF e documentos de validação, com possibilidade de aprovação ou reprovação administrativa." />
        </Section>

        <Section title="Agendamentos, Pagamentos e Repasses">
          <Item text="Os pagamentos são processados via Mercado Pago" />
          <Item text="O Muvify não armazena dados completos de cartão e CVV em seus próprios bancos" />
          <Item text="Valores, taxas, repasses, prazos, cancelamentos e reembolsos seguem as regras comerciais da plataforma exibidas ao usuário no momento da contratação" />
        </Section>

        <Section title="Regras de Conduta">
          <Body text="É proibido:" />
          <Item text="Usar a plataforma para prática ilegal" />
          <Item text="Tentar fraudar pagamento, identidade ou validações" />
          <Item text="Assediar, ameaçar ou discriminar outros usuários" />
          <Item text="Tentar acessar áreas internas sem autorização" />
          <Item text="Usar robôs, automações abusivas ou técnicas para burlar segurança" />
        </Section>

        <Section title="Dados Pessoais Coletados">
          <Body text="Dados de cadastro e conta:" />
          <Item text="Nome, e-mail, telefone e foto de perfil (opcional)" />
          <Item text="Senha protegida por hash — nunca em texto puro" />
          <Body text="Dados profissionais (quando aplicável):" />
          <Item text="Número de CREF, documentos de validação e status de aprovação" />
          <Body text="Dados de pagamento:" />
          <Item text="Valor, método, status e identificadores técnicos da transação" />
          <Item text="Dados bancários do prestador criptografados" />
          <Item text="Dados tokenizados fornecidos pelo parceiro de pagamento" />
          <Body text="Dados de localização:" />
          <Item text="Latitude/longitude quando necessário para busca e atendimento" />
          <Body text="Dados de uso e comunicação:" />
          <Item text="Histórico de suporte, mensagens de chat de agendamento e notificações enviadas" />
          <Body text="Dados de saúde (quando aplicável):" />
          <Item text="Informações de anamnese, objetivos, limitações e rotina de treino" />
          <Item text="Comprovação de sessão quando o recurso for usado" />
        </Section>

        <Section title="Finalidades do Uso dos Dados">
          <Item text="Criar e manter sua conta" />
          <Item text="Viabilizar agendamentos e prestação de serviço" />
          <Item text="Processar pagamentos, reembolsos e repasses" />
          <Item text="Validar profissionais e documentos" />
          <Item text="Enviar notificações e e-mails operacionais" />
          <Item text="Prestar suporte ao usuário" />
          <Item text="Prevenir fraudes e aumentar segurança" />
          <Item text="Cumprir obrigações legais, regulatórias e judiciais" />
          <Item text="Melhorar o funcionamento e estabilidade da plataforma" />
        </Section>

        <Section title="Bases Legais (LGPD)">
          <Body text="O tratamento de dados pessoais ocorre com base em hipóteses legais da LGPD, como:" />
          <Item text="Execução de contrato e procedimentos preliminares" />
          <Item text="Cumprimento de obrigação legal ou regulatória" />
          <Item text="Legítimo interesse, com observância dos direitos do titular" />
          <Item text="Exercício regular de direitos em processo" />
          <Item text="Consentimento, quando necessário" />
          <Item text="Proteção da vida e da saúde, quando aplicável" />
        </Section>

        <Section title="Compartilhamento de Dados">
          <Body text="O Muvify pode compartilhar dados pessoais, quando necessário, com:" />
          <Item text="Mercado Pago — cobrança, antifraude, repasse, estorno e compliance" />
          <Item text="Provedores de e-mail transacional para mensagens operacionais" />
          <Item text="Sistemas de notificações push" />
          <Item text="Ferramentas de monitoramento técnico e tratamento de falhas" />
          <Item text="Provedores de infraestrutura e hospedagem" />
          <Item text="Analytics de uso do produto (PostHog) — somente com seu consentimento explícito, desligado por padrão (Configurações → Compartilhar dados de uso)" />
          <Item text="Autoridades públicas, quando houver obrigação legal ou ordem válida" />
          <Body text="O Muvify não comercializa dados pessoais dos usuários." />
        </Section>

        <Section title="Retenção e Descarte de Dados">
          <Body text="O Muvify aplica política formal de retenção com prazos por categoria de dado e expurgo automático com trilha de auditoria." />
          <Item text="Dados de autenticação e tokens técnicos são removidos após janela operacional de segurança" />
          <Item text="Dados sensíveis, como anamnese, passam por redação/anonimização após o prazo definido" />
          <Item text="Mensagens e evidências antigas são redigidas ou excluídas conforme política vigente" />
          <Item text="Dados com obrigação legal/regulatória podem ser mantidos pelo prazo exigido em lei" />
          <Body text="Quando houver disputa, ordem legal ou investigação, o descarte pode ser suspenso (legal hold)." />
        </Section>

        <Section title="Seus Direitos (LGPD)">
          <Body text="Você pode solicitar a qualquer momento:" />
          <Item text="Confirmação de tratamento e acesso aos dados" />
          <Item text="Correção de dados incompletos ou desatualizados" />
          <Item text="Anonimização, bloqueio ou eliminação, quando cabível" />
          <Item text="Informação sobre compartilhamento e portabilidade" />
          <Item text="Revogação de consentimento, quando essa for a base usada" />
        </Section>

        <Section title="Exclusão de Dados e Contato">
          <Body text="Você pode solicitar exclusão de dados a qualquer momento pelo suporte dentro do app ou pelo e-mail muvifyadm@gmail.com." />
          <Body text="Para segurança do titular, o Muvify poderá solicitar confirmação de identidade antes de concluir o pedido. A exclusão poderá ser parcial quando houver obrigação legal, regulatória ou necessidade de defesa de direitos." />
        </Section>

        <Section title="Segurança da Informação">
          <Item text="Senhas protegidas por hash seguro (bcrypt)" />
          <Item text="Comunicações criptografadas via HTTPS/TLS" />
          <Item text="Dados bancários com proteção criptográfica" />
          <Item text="Controles de acesso e monitoramento contínuo" />
          <Body text="Nenhum sistema é totalmente invulnerável, mas o Muvify atua para reduzir riscos e tratar incidentes com prioridade." />
        </Section>

        <Section title="Crianças e Adolescentes">
          <Body text="A plataforma não é destinada ao uso autônomo por crianças sem responsável legal. Quando houver tratamento envolvendo menores, serão observadas as exigências legais específicas e o melhor interesse do menor." />
        </Section>

        <Section title="Alterações deste Documento">
          <Body text="Este documento poderá ser atualizado para refletir mudanças legais, técnicas, operacionais ou de produto. A versão vigente será sempre a publicada pelo Muvify, com indicação de versão e data." />
        </Section>

        <Section title="Lei Aplicável e Foro">
          <Body text="Este documento é regido pela legislação brasileira. Fica eleito o foro competente da comarca aplicável para solução de conflitos, sem prejuízo das regras de proteção ao consumidor." />
        </Section>

        <MvText variant="body4" color="tertiary" style={{ textAlign: "center" }}>
          Canal oficial de privacidade: muvifyadm@gmail.com{"\n"}
          Versão {TERMS_VERSION}
        </MvText>
      </ScrollView>
    </View>
  );
}
