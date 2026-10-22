import React from "react";
import { ActivityIndicator, Alert, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { ClientStackParamList } from "../../navigation/route-types";
import { consultancyApi, ProviderServiceOffer, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useAuthMutation, useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { MvProcessingModal, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { useMvTheme } from "../../theme/MvThemeContext";
import { formatCurrencyBRL } from "../../utils/formatters";
import { hapticCta } from "../../utils/haptics";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ProviderServicesUpgrade">;

function kindLabel(kind: ProviderServiceOffer["kind"]) {
  if (kind === "PRESENTIAL") return "Aulas presenciais";
  if (kind === "COMBO") return "Combo — Presencial + Consultoria online";
  return "Consultoria on-line";
}

function cycleLabel(cycle: string) {
  const map: Record<string, string> = {
    DAILY: "dia", WEEKLY: "semana", MONTHLY: "mês", QUARTERLY: "trimestre", SEMIANNUAL: "semestre", ANNUAL: "ano"
  };
  return map[cycle] ?? cycle.toLowerCase();
}

// Bloco 3 (exclusividade de marketplace): trocar/adicionar um serviço do
// MESMO profissional já contratado — nunca mostra nem permite contratar
// outro profissional (mockup aprovado "Muvify - Vínculo Ativo").
export function ProviderServicesUpgradeScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { showToast, activeEngagement, refreshActiveEngagement } = useAppState();
  const queryClient = useQueryClient();
  const { providerId } = route.params;

  const catalogQuery = useAuthQuery(queryKeys.consultancy.catalog(providerId), () =>
    consultancyApi.providerCatalog(providerId)
  );

  // Teste manual C12.1 (22/10/2026): a troca sempre cobrava no cartão
  // salvo, sem perguntar — oferta só-Pix nunca dava pra trocar e quem não
  // tinha cartão travava. Agora escolhe entre as formas que a oferta aceita.
  const switchMutation = useAuthMutation(
    (token, vars: { offerId: string; method: "CREDIT_CARD" | "PIX" }) =>
      userApi.switchOrAddOffer(token, { newOfferId: vars.offerId, paymentMethod: vars.method, acknowledgedImmediateExecution: true }),
    {
      onSuccess: async (_result, vars) => {
        if (vars.method === "PIX") {
          // Plano atual continua valendo até o Pix cair (o servidor só
          // cancela o antigo no webhook). O QR aparece em Treinos → Pendentes.
          showToast("Pix gerado! Pague em até 24h para concluir a troca. Seu plano atual continua valendo até lá.", "success");
          void queryClient.invalidateQueries({ queryKey: queryKeys.consultancy.myTraining() });
          (navigation as any).navigate("ClientTabs", { screen: "MyTraining", params: { initialTab: "pending" } });
          return;
        }
        showToast("Serviço atualizado!", "success");
        await refreshActiveEngagement();
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.me() });
        // Raio-X pós-épico (achado médio): só a lista de agendamentos era
        // invalidada — o card "Próximo treino" da Home travada e a tela
        // "Seu Treino" podiam continuar mostrando dados do contrato antigo
        // (ficha/chat) até o cache expirar sozinho depois da troca.
        void queryClient.invalidateQueries({ queryKey: queryKeys.consultancy.myTraining() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.consultancyChat.myChats() });
        navigation.goBack();
      },
      onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao trocar de serviço." })
    }
  );

  function confirmSwitch(offer: ProviderServiceOffer, method: "CREDIT_CARD" | "PIX") {
    const price = `${formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}/${cycleLabel(offer.billingCycle)}`;
    const message =
      method === "PIX"
        ? `Trocar seu plano por "${offer.title}" — ${price}? Vamos gerar um Pix. Seu plano atual continua valendo até o Pix ser pago; depois ele é cancelado.`
        : `Trocar seu plano por "${offer.title}" — ${price}? Isso cobra o novo serviço no seu cartão salvo agora e cancela o atual.`;
    Alert.alert("Confirmar troca", message, [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar troca", onPress: () => switchMutation.mutate({ offerId: offer.id, method }) }
    ]);
  }

  function handlePickOnlineOffer(offer: ProviderServiceOffer) {
    hapticCta();
    const acceptsCard = offer.acceptsCreditCard !== false;
    const acceptsPix = offer.acceptsPix === true;
    if (!acceptsCard && !acceptsPix) {
      showToast("Este serviço não aceita pagamento pelo app. Combine com seu personal pelo chat.", "info");
      return;
    }
    if (acceptsCard && acceptsPix) {
      Alert.alert("Como você quer pagar?", undefined, [
        { text: "Cartão salvo", onPress: () => confirmSwitch(offer, "CREDIT_CARD") },
        { text: "Pix", onPress: () => confirmSwitch(offer, "PIX") },
        { text: "Voltar", style: "cancel" }
      ]);
      return;
    }
    confirmSwitch(offer, acceptsPix ? "PIX" : "CREDIT_CARD");
  }

  // Raio-X pós-épico (achado alto): antes adivinhava a oferta atual só por
  // `kind`, marcando a primeira do catálogo com o mesmo kind como "SEU PLANO
  // ATUAL" — com duas ofertas do mesmo kind (preços diferentes), errava e
  // liberava "trocar" pra oferta que já era a atual. Agora usa o offerId real.
  const currentOfferId = activeEngagement?.hasActive ? activeEngagement.offerId ?? undefined : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.provider-services-upgrade">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <PressableScale
          onPress={() => navigation.goBack()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.backBtn, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText variant="h3">Serviços de {catalogQuery.data?.provider.displayName ?? "..."}</MvText>
          <MvText variant="caption" color="secondary" style={{ marginTop: 1 }}>Troque ou adicione um serviço sem sair do seu personal</MvText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <View style={{ borderRadius: 14, padding: 13, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, flexDirection: "row", gap: 9 }}>
          <Ionicons name="information-circle-outline" size={16} color={theme.text3} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 11.5, lineHeight: 16, color: theme.text3 }}>
            Você só pode contratar serviços do próprio {catalogQuery.data?.provider.displayName ?? "profissional"} enquanto esse vínculo estiver ativo.
          </Text>
        </View>

        {/* Achado em teste manual (2026-10-15): cliente com vínculo ativo só
            por agendamento avulso (sem pacote/contrato) não tinha NENHUM
            jeito de marcar mais um dia avulso com o MESMO profissional -
            essa tela só listava ofertas/pacotes publicados, e o botão de
            "novo agendamento" na aba Meu Personal some assim que existe
            vínculo ativo, independente de ser com o mesmo profissional ou
            não. A regra de exclusividade já permite isso (só bloqueia
            profissional DIFERENTE) - só faltava o caminho de navegação.
            Pedido manual (2026-10-15): separado em seções por intenção
            ("quero uma aula" vs. "quero um plano") em vez de por tipo de
            produto - mais intuitivo pro cliente escolher. */}
        <View style={{ gap: 10 }}>
          <MvText variant="caption" color="secondary" style={{ textTransform: "uppercase", letterSpacing: 0.06 * 12, fontFamily: "DMSans_700Bold" }}>
            Quero agendar uma aula nova
          </MvText>
          <TouchableOpacity
            onPress={() => navigation.navigate("CreateBooking", { professionalId: providerId })}
            style={{ borderRadius: 16, padding: 15, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <Ionicons name="calendar-outline" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <MvText variant="semi2" style={{ color: theme.primary }}>Agendar mais uma aula avulsa</MvText>
              <MvText variant="caption" color="secondary" style={{ marginTop: 2 }}>
                Sem trocar nem cancelar seu plano atual.
              </MvText>
            </View>
            {typeof catalogQuery.data?.provider.priceCents === "number" ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.primary }}>
                  {formatCurrencyBRL(catalogQuery.data.provider.priceCents / 100)}
                </Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 10, color: theme.text3 }}>por aula</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={theme.text3} />
            )}
          </TouchableOpacity>
        </View>

        {/* Raio-X pós-épico (achado médio): sem isso, a tela ficava com a
            lista vazia tanto durante o carregamento quanto se a query
            falhasse — indistinguível de "esse profissional não tem mais
            nada pra oferecer", sem toast nem retry nenhum. Pedido manual
            (2026-10-15): seção inteira (título incluso) some quando o
            profissional não tem nenhuma oferta publicada, em vez de
            mostrar um título vazio com só o aviso de "nenhum serviço". */}
        {catalogQuery.isLoading || catalogQuery.isError || (catalogQuery.data?.offers.length ?? 0) > 0 ? (
          <View style={{ gap: 10 }}>
            <MvText variant="caption" color="secondary" style={{ textTransform: "uppercase", letterSpacing: 0.06 * 12, fontFamily: "DMSans_700Bold" }}>
              Quero contratar um plano novo
            </MvText>

            {catalogQuery.isLoading ? (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <ActivityIndicator color={theme.primary} />
              </View>
            ) : catalogQuery.isError ? (
              <View style={{ paddingVertical: 30, alignItems: "center", gap: 10 }}>
                <MvText variant="caption" color="secondary" style={{ textAlign: "center" }}>
                  Não foi possível carregar os serviços deste profissional.
                </MvText>
                <TouchableOpacity onPress={() => catalogQuery.refetch()}>
                  <MvText variant="semi3" style={{ color: theme.primary }}>Tentar de novo</MvText>
                </TouchableOpacity>
              </View>
            ) : (
              catalogQuery.data!.offers.map((offer) => {
                const isCurrent = offer.id === currentOfferId;
                const isPresentialLike = offer.kind === "PRESENTIAL" || offer.kind === "COMBO";
                return (
                  <View
                    key={offer.id}
                    style={{
                      borderRadius: 16,
                      padding: 15,
                      borderWidth: isCurrent ? 1.5 : 1,
                      borderColor: isCurrent ? theme.primary : theme.border,
                      backgroundColor: isCurrent ? theme.primarySubtle : theme.cardBg,
                      gap: 10
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <MvText variant="semi2">{kindLabel(offer.kind)}</MvText>
                        <MvText variant="caption" color="secondary" style={{ marginTop: 2 }}>{offer.title}</MvText>
                      </View>
                      {isCurrent ? (
                        <View style={{ backgroundColor: theme.primary, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 }}>
                          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.textOnPrimary }}>SEU PLANO ATUAL</Text>
                        </View>
                      ) : null}
                    </View>

                    {!isCurrent ? (
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 17, color: theme.text1 }}>
                            {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                          </Text>
                          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>/{cycleLabel(offer.billingCycle)}</Text>
                        </View>
                        {isPresentialLike ? (
                          <TouchableOpacity
                            onPress={() => navigation.navigate("ClientChatList")}
                            style={{ height: 42, borderRadius: 13, paddingHorizontal: 16, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.borderMid, alignItems: "center", justifyContent: "center" }}
                          >
                            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12.5, color: theme.text1 }}>Combinar no chat</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={() => handlePickOnlineOffer(offer)}
                            disabled={switchMutation.isPending}
                            style={{ height: 42, borderRadius: 13, paddingHorizontal: 16, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", opacity: switchMutation.isPending ? 0.6 : 1 }}
                          >
                            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12.5, color: theme.textOnPrimary }}>
                              {switchMutation.isPending ? "Trocando..." : "Trocar por este"}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : null}

                    {!isCurrent && isPresentialLike ? (
                      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
                        Esse serviço tem dia/horário/local a combinar — fale com o profissional pelo chat pra fechar os detalhes.
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        ) : null}
      </ScrollView>
      <MvProcessingModal visible={switchMutation.isPending} title="Trocando seu plano..." />
    </View>
  );
}
