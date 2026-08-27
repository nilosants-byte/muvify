import React, { useCallback, useRef } from "react";
import { ActivityIndicator, Alert, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { providerSubscriptionApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useAuthMutation, useAuthQuery } from "../../hooks/useAuthQuery";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { queryKeys } from "../../lib/queryKeys";
import { MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { FounderBadge } from "../../components/professional/FounderBadge";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "MySubscription">;

// Mesmo tom dourado do mockup aprovado — não faz parte da paleta semântica
// do app (não é sucesso/aviso/erro), é só o acento visual do selo de
// fundador, deliberadamente fora do MvTheme.
const FOUNDER_GOLD = "#E8B84B";
const FOUNDER_GOLD_SUBTLE = "rgba(232,184,75,0.13)";
const FOUNDER_GOLD_BORDER = "rgba(232,184,75,0.28)";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

// Bloco 5 (assinatura do profissional): fundação de trial + cobrança mensal
// + cancelamento — mockup aprovado "Muvify - Minha Assinatura". Nenhuma
// ação do app é bloqueada por aqui (isso é escopo do Bloco 6); esta tela é
// só o profissional acompanhando/gerenciando o próprio status.
export function MySubscriptionScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const queryClient = useQueryClient();

  const subscriptionQuery = useAuthQuery(queryKeys.providers.mySubscription(), (token) =>
    providerSubscriptionApi.myStatus(token)
  );

  const chargeNowMutation = useAuthMutation((token) => providerSubscriptionApi.chargeNow(token), {
    onSuccess: () => {
      showToast("Assinatura ativada!", "success");
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.mySubscription() });
    },
    // Raio-X pós-épico (achado alto): sem onError, a tentativa automática de
    // cobrança ao voltar com cartão novo falhava em silêncio (cartão
    // recusado, etc.) — o profissional ficava olhando pra tela sem entender
    // por que continuava "pendente", sem nenhum próximo passo visível.
    onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Não conseguimos cobrar sua assinatura. Tente novamente." })
  });

  // Raio-X pós-épico (achado médio): antes a cobrança automática disparava
  // toda vez que a tela MONTAVA com PENDING_PAYMENT/PAST_DUE + cartão salvo
  // — inclusive um profissional só checando o status de um cartão já
  // recusado antes, sem pedir retry nenhum. Só arma de verdade quando o
  // profissional volta de "Adicionar/Trocar cartão" — e usa o resultado
  // FRESCO do refetch (não o `sub` do render anterior, que ainda é o cache
  // velho no instante em que a tela ganha foco de volta).
  const cameFromAddCardRef = useRef(false);
  useFocusEffectSkippingFirst(
    useCallback(() => {
      void (async () => {
        const result = await subscriptionQuery.refetch();
        if (!cameFromAddCardRef.current) return;
        cameFromAddCardRef.current = false;
        const fresh = result.data;
        if (
          fresh &&
          (fresh.status === "PENDING_PAYMENT" || fresh.status === "PAST_DUE") &&
          fresh.hasCard &&
          !chargeNowMutation.isPending
        ) {
          chargeNowMutation.mutate();
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscriptionQuery.refetch])
  );

  const sub = subscriptionQuery.data;

  const cancelMutation = useAuthMutation((token) => providerSubscriptionApi.cancel(token), {
    onSuccess: () => {
      showToast("Cancelamento agendado.", "success");
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.mySubscription() });
    },
    onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao cancelar a assinatura." })
  });

  const reactivateMutation = useAuthMutation((token) => providerSubscriptionApi.reactivate(token), {
    onSuccess: () => {
      showToast("Cancelamento desfeito — sua assinatura continua.", "success");
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.mySubscription() });
    },
    onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao reativar a assinatura." })
  });

  function confirmCancel() {
    // Raio-X pós-épico (achado médio): o backend passou a aceitar cancelar
    // também de TRIALING/PENDING_PAYMENT/PAST_DUE (cancelamento imediato,
    // sem período pago em aberto pra honrar) — antes disso não existia
    // NENHUM caminho de auto-serviço pra sair desses estados. Cada um tem
    // um texto de confirmação diferente porque o efeito é diferente
    // (agendado pro fim do período vs. imediato).
    const isImmediate = sub?.status !== "ACTIVE";
    const dateLabel = formatDate(sub?.nextBillingAt ?? null);
    Alert.alert(
      "Cancelar assinatura",
      isImmediate
        ? "Sua assinatura será cancelada agora — você não será cobrado."
        : `Sua assinatura continua ativa até ${dateLabel} — depois disso não cobramos mais nada.`,
      [
        { text: "Manter assinatura", style: "cancel" },
        { text: "Cancelar assinatura", style: "destructive", onPress: () => cancelMutation.mutate() }
      ]
    );
  }

  const heroTone =
    sub?.status === "TRIALING" ? "trial" : sub?.status === "ACTIVE" ? "active" : "pending";
  const toneColor =
    heroTone === "trial" ? FOUNDER_GOLD : heroTone === "active" ? theme.primary : theme.warning;
  const toneSubtle =
    heroTone === "trial" ? FOUNDER_GOLD_SUBTLE : heroTone === "active" ? theme.primarySubtle : theme.warningSubtle;
  const toneBorder =
    heroTone === "trial" ? FOUNDER_GOLD_BORDER : heroTone === "active" ? theme.primarySubtleBorder : theme.warningSubtleBorder;

  const statusLabel =
    sub?.status === "TRIALING"
      ? "TRIAL GRÁTIS"
      : sub?.status === "ACTIVE"
        ? "ASSINATURA ATIVA"
        : sub?.status === "PAST_DUE"
          ? "PAGAMENTO COM FALHA"
          : sub?.status === "CANCELED"
            ? "CANCELADA"
            : "PAGAMENTO PENDENTE";

  const daysLeft =
    sub?.status === "TRIALING" && sub.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000))
      : null;

  // Raio-X pós-épico (achado médio): sem isso, o card financeiro caía no
  // fallback de "PAGAMENTO PENDENTE" (`sub?.status === "..."` encadeado sem
  // bater nenhuma condição enquanto `sub` é undefined) — um profissional com
  // assinatura ACTIVE/TRIALING via um alarme falso de cobrança pendente por
  // uma fração de segundo (ou mais, em rede lenta) toda vez que abria a tela.
  if (subscriptionQuery.isLoading && !sub) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.my-subscription">
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.headerBg} />
        <ProfessionalScreenHeader title="Minha assinatura" onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.my-subscription">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.headerBg} />
      <ProfessionalScreenHeader title="Minha assinatura" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {sub?.isFounder ? <FounderBadge /> : null}

        <View
          style={{
            borderRadius: 20,
            padding: 20,
            gap: 14,
            borderWidth: 1,
            borderColor: toneBorder,
            backgroundColor: toneSubtle
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              alignSelf: "flex-start",
              paddingHorizontal: 11,
              paddingVertical: 5,
              borderRadius: 99,
              backgroundColor: theme.cardBg
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: toneColor }} />
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, letterSpacing: 0.3, color: toneColor }}>
              {statusLabel}
            </Text>
          </View>

          <MvText variant="h3" style={{ lineHeight: 26 }}>
            {sub?.status === "TRIALING"
              ? sub.isFounder
                ? "Você é um dos 100 primeiros profissionais do Muvify"
                : "Você ganhou um período grátis pra testar o Muvify"
              : sub?.status === "ACTIVE"
                ? "Tudo em dia — obrigado por fazer parte do Muvify"
                : "Ative sua assinatura para continuar no Muvify"}
          </MvText>

          {sub?.status === "TRIALING" && daysLeft !== null ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}>
              <Text style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 34, color: theme.text1 }}>
                {daysLeft}
              </Text>
              <MvText variant="caption" color="secondary">dias restantes de trial</MvText>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}>
              <Text style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 26, color: theme.text1 }}>
                {formatCurrencyBRL((sub?.priceCents ?? sub?.basePriceCents ?? 3990) / 100)}
              </Text>
              <MvText variant="caption" color="secondary">por mês</MvText>
            </View>
          )}

          <MvText variant="caption" color="secondary" style={{ lineHeight: 18 }}>
            {/* Realinhamento com o Will (2026-08-26): preço em camadas —
                fundador paga um valor promocional só nos primeiros 12
                meses de cobrança, depois sobe pro preço base. Early
                (trial de 30 dias, sem ser fundador) e standard (sem
                trial) já nascem no preço base, nunca mudam — "o mesmo
                valor de sempre" só era verdade pra eles, nunca pro
                fundador depois do 1º ano. */}
            {sub?.status === "TRIALING"
              ? sub.isFounder
                ? `Grátis até ${formatDate(sub.trialEndsAt)}. Depois disso, ${formatCurrencyBRL(sub.priceCents / 100)}/mês por 12 meses, e ${formatCurrencyBRL(sub.basePriceCents / 100)}/mês depois disso.`
                : `Grátis até ${formatDate(sub.trialEndsAt)}. Depois disso, ${formatCurrencyBRL(sub.priceCents / 100)}/mês — o mesmo valor de sempre.`
              : sub?.status === "ACTIVE"
                ? sub.isFounder && sub.priceCents < sub.basePriceCents && sub.priceLockedUntil
                  ? `Próxima cobrança em ${formatDate(sub.nextBillingAt)}. Preço promocional até ${formatDate(sub.priceLockedUntil)} — depois ${formatCurrencyBRL(sub.basePriceCents / 100)}/mês.`
                  : `Próxima cobrança em ${formatDate(sub.nextBillingAt)}.`
                // Raio-X focado (achado médio): esse texto dizia "nada no
                // app é bloqueado por enquanto" — verdade só enquanto o
                // Bloco 5 existia sozinho. O Bloco 6 trouxe bloqueio de
                // verdade (~24 ações: criar/editar oferta, entregar ficha,
                // configurar agenda etc.) e o texto nunca foi atualizado —
                // profissional lia "nada bloqueado" e esbarrava em
                // SUBSCRIPTION_REQUIRED na primeira ação.
                : "Adicione um cartão para ativar. Sem isso, algumas ações do app (criar ofertas, entregar fichas, configurar agenda) ficam bloqueadas até você ativar."}
          </MvText>
        </View>

        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.cardBg,
            padding: 15,
            gap: 11
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <MvText variant="caption" color="secondary">Cartão salvo</MvText>
            <MvText variant="semi3">
              {sub?.hasCard ? `${sub.cardBrand ?? "Cartão"} •••• ${sub.cardLast4 ?? ""}` : "Nenhum ainda"}
            </MvText>
          </View>
          {sub?.status === "ACTIVE" && sub.lastChargeAt ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 11, borderTopWidth: 1, borderTopColor: theme.border }}>
              <MvText variant="caption" color="secondary">Última cobrança</MvText>
              <MvText variant="semi3">{formatDate(sub.lastChargeAt)}</MvText>
            </View>
          ) : null}
        </View>

        <PressableScale
          onPress={() => {
            cameFromAddCardRef.current = true;
            navigation.navigate("ProviderPaymentMethod");
          }}
          style={{
            height: 50,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: sub?.status === "ACTIVE" ? theme.cardBg : theme.primary,
            borderWidth: sub?.status === "ACTIVE" ? 1 : 0,
            borderColor: theme.borderMid
          }}
        >
          <Text
            style={{
              fontFamily: "DMSans_700Bold",
              fontSize: 14,
              color: sub?.status === "ACTIVE" ? theme.text1 : theme.textOnPrimary
            }}
          >
            {sub?.hasCard ? "Trocar cartão" : "Adicionar cartão"}
          </Text>
        </PressableScale>

        {(sub?.status === "PENDING_PAYMENT" || sub?.status === "PAST_DUE") && sub.hasCard ? (
          <PressableScale
            onPress={() => chargeNowMutation.mutate()}
            style={{
              height: 50,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.primary,
              opacity: chargeNowMutation.isPending ? 0.6 : 1
            }}
          >
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
              {chargeNowMutation.isPending ? "Cobrando..." : "Tentar cobrar novamente"}
            </Text>
          </PressableScale>
        ) : null}

        {sub && sub.status !== "CANCELED" && !sub.cancelAtPeriodEnd ? (
          <TouchableOpacity
            onPress={confirmCancel}
            disabled={cancelMutation.isPending}
            style={{ alignItems: "center", paddingVertical: 8, opacity: cancelMutation.isPending ? 0.6 : 1 }}
          >
            <MvText variant="semi3" style={{ color: theme.danger }}>
              {cancelMutation.isPending ? "Cancelando..." : "Cancelar assinatura"}
            </MvText>
          </TouchableOpacity>
        ) : null}

        {sub?.cancelAtPeriodEnd ? (
          <View style={{ gap: 8, alignItems: "center" }}>
            <MvText variant="caption" color="secondary" style={{ textAlign: "center" }}>
              Cancelamento agendado para {formatDate(sub.nextBillingAt)}.
            </MvText>
            <TouchableOpacity
              onPress={() => reactivateMutation.mutate()}
              disabled={reactivateMutation.isPending}
              style={{ paddingVertical: 8, opacity: reactivateMutation.isPending ? 0.6 : 1 }}
            >
              <MvText variant="semi3" style={{ color: theme.primary }}>
                {reactivateMutation.isPending ? "Desfazendo..." : "Desfazer cancelamento"}
              </MvText>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
