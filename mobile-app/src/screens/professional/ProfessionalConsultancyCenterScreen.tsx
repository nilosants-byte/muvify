import React from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { consultancyApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvProgressBar, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { formatCurrencyBRL } from "../../utils/formatters";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { ConsultancyTabSwitcher } from "../../components/professional/ConsultancyTabSwitcher";
import { handleScreenError } from "../shared/api-helpers";
import { useConsultancyCenterData } from "../../hooks/useConsultancyCenterData";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConsultancyCenter">;

export function ProfessionalConsultancyCenterScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const {
    centerQuery,
    loading,
    needsProfileSetup,
    crefValidated,
    prebuiltPlanCount,
    settingsEnabled,
    responseSlaDays,
    setResponseSlaDays,
    openRequests,
    respondedRequests,
    acceptedRequests,
    promotionCount,
    averageTicket,
    onlineOffers,
    readinessChecklist,
    readinessScore,
    nextGuidedStep,
    onRefresh,
  } = useConsultancyCenterData();

  const [savingSettings, setSavingSettings] = React.useState(false);
  const { runWithAuth, showToast } = useAppState();

  React.useEffect(() => {
    if (centerQuery.error) {
      handleScreenError({ error: centerQuery.error, showToast, fallbackMessage: "Falha ao carregar central de consultoria.", navigation });
    }
  }, [centerQuery.error, showToast, navigation]);

  async function toggleOnlineSetting(enabled: boolean) {
    try {
      setSavingSettings(true);
      await runWithAuth((token: string) =>
        consultancyApi.upsertProviderSettings(token, { enabled, responseSlaDays: Number(responseSlaDays) || 7 })
      );
      showToast(enabled ? "Consultoria online habilitada." : "Consultoria online desabilitada.", "success");
      void centerQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao atualizar configuração.", navigation });
    } finally {
      setSavingSettings(false);
    }
  }

  const firstOpenRequest = openRequests[0];

  function StatCard({
    label,
    value,
    hint,
    icon,
    numericValue,
    formatValue,
  }: {
    label: string;
    value: string;
    hint: string;
    icon: keyof typeof Ionicons.glyphMap;
    numericValue?: number;
    formatValue?: (n: number) => string;
  }) {
    const valueStyle = { fontFamily: "PlusJakartaSans_800ExtraBold" as const, fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.2, lineHeight: 28, color: theme.text1 };
    return (
      <View
        style={{
          flexBasis: "48%",
          flexGrow: 1,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.inputBg,
          borderRadius: 14,
          padding: 12,
          gap: 4,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={icon} size={15} color={theme.textGreen} />
          </View>
          <MvText variant="caption" color="secondary">{label}</MvText>
        </View>
        {numericValue !== undefined
          ? <AnimatedNumber value={numericValue} format={formatValue} style={valueStyle} />
          : <MvText style={valueStyle}>{value}</MvText>
        }
        <MvText variant="caption" color="secondary">
          {hint}
        </MvText>
      </View>
    );
  }

  function QuickAction({
    icon,
    title,
    subtitle,
    onPress,
    urgent,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle: string;
    onPress: () => void;
    urgent?: boolean;
  }) {
    return (
      <PressableScale
        scale={0.96}
        onPress={onPress}
        style={{
          flexBasis: "48%",
          flexGrow: 1,
          borderWidth: 1,
          borderColor: urgent ? theme.primarySubtleBorder : theme.border,
          borderRadius: 14,
          backgroundColor: urgent ? theme.primarySubtle : theme.inputBg,
          padding: 12,
          gap: 6,
        }}
      >
        <View style={{
          width: 36, height: 36, borderRadius: 11,
          backgroundColor: urgent ? theme.primarySubtle : theme.backBtn,
          borderWidth: urgent ? 1 : 0,
          borderColor: theme.primarySubtleBorder,
          alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name={icon} size={18} color={urgent ? theme.textGreen : iconColor} />
        </View>
        <MvText variant="semi3" style={{ color: urgent ? theme.textGreen : theme.text1 }}>{title}</MvText>
        <MvText variant="caption" color="secondary">
          {subtitle}
        </MvText>
      </PressableScale>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.consultancy">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader
        title="Consultoria"
        subtitle="Painel geral"
        onBack={() => {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
        }}
        action={{ icon: "archive-outline", label: "Arquivados", onPress: () => navigation.navigate("ProfessionalArchivedRequests") }}
      />

      <ScreenEntrance>
      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={centerQuery.isRefetching} onRefresh={() => void onRefresh()} />
        }
      >
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
        <>
        <MvCard style={{ padding: 0, overflow: "hidden" }}>
          <View
            style={{
              paddingHorizontal: 14,
              paddingTop: 14,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
              backgroundColor: theme.primarySubtle,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <MvText variant="eyebrow" style={{ color: theme.textGreen }}>
                  Central de Vendas
                </MvText>
                <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 20, color: theme.text1, letterSpacing: -0.2, marginTop: 2 }}>
                  Consultorias e vendas
                </MvText>
                <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                  Capte, responda e feche contratos em um só lugar.
                </MvText>
              </View>
              <MvBadge label={settingsEnabled ? "Online ativa" : "Online pausada"} variant={settingsEnabled ? "green" : "orange"} />
            </View>

            {nextGuidedStep ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.borderMid,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.66)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="arrow-forward-circle-outline" size={16} color={theme.textGreen} />
                <View style={{ flex: 1 }}>
                  <MvText variant="caption" color="secondary">Próximo passo recomendado</MvText>
                  <MvText variant="semi3">{nextGuidedStep.title}</MvText>
                </View>
              </View>
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.primarySubtleBorder,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: theme.primarySubtle,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="checkmark-circle" size={16} color={theme.textGreen} />
                <MvText variant="semi3" style={{ color: theme.textGreen }}>
                  Consultoria pronta para escalar.
                </MvText>
              </View>
            )}
          </View>

          <View style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <StatCard label="Abertas" value={String(openRequests.length)} numericValue={openRequests.length} hint="Aguardando sua resposta" icon="mail-unread-outline" />
              <StatCard label="Em analise" value={String(respondedRequests.length)} numericValue={respondedRequests.length} hint="Aluno ainda decide" icon="time-outline" />
              <StatCard label="Aceitas" value={String(acceptedRequests.length)} numericValue={acceptedRequests.length} hint="Contratos ativos" icon="checkmark-done-outline" />
              <StatCard label="Ticket online" value={averageTicket ? formatCurrencyBRL(averageTicket / 100) : "R$ 0,00"} numericValue={averageTicket ? averageTicket / 100 : 0} formatValue={formatCurrencyBRL} hint="Media por oferta online" icon="cash-outline" />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <QuickAction
                icon="chatbubble-ellipses-outline"
                title="Responder agora"
                subtitle={openRequests.length ? `${openRequests.length} ${openRequests.length === 1 ? "pendente" : "pendentes"}` : "Sem pendências"}
                onPress={() => navigation.replace("ProfessionalConsultancyRequests")}
                urgent={openRequests.length > 0}
              />
              <QuickAction
                icon="pricetag-outline"
                title="Nova oferta"
                subtitle="Cadastrar e publicar serviço"
                onPress={() => navigation.replace("ProfessionalConsultancyOffers")}
              />
              <QuickAction
                icon="barbell-outline"
                title="Treino pré-pronto"
                subtitle={prebuiltPlanCount ? `${prebuiltPlanCount} ${prebuiltPlanCount === 1 ? "cadastrado" : "cadastrados"}` : "Criar primeira base"}
                onPress={() => navigation.navigate("TrainingCreation")}
              />
              <QuickAction
                icon="archive-outline"
                title="Arquivados"
                subtitle="Histórico de solicitações"
                onPress={() => navigation.navigate("ProfessionalArchivedRequests")}
              />
            </View>
          </View>
        </MvCard>

        {needsProfileSetup ? (
          <MvCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ionicons name="warning-outline" size={16} color={theme.warning} />
              <MvText variant="semi2">Perfil profissional incompleto</MvText>
            </View>
            <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
              Antes de publicar ofertas e responder alunos, conclua seu perfil profissional.
            </MvText>
            <MvButton
              label="Ir para meu perfil"
              onPress={() => navigation.navigate("ProfessionalTabs", { screen: "ProfessionalProfileEditor" })}
            />
          </MvCard>
        ) : null}

        {!crefValidated ? (
          <MvCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ionicons name="shield-checkmark-outline" size={16} color={theme.warning} />
              <MvText variant="semi2">CREF pendente de validação</MvText>
            </View>
            <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
              Esta funcionalidade ficará disponível quando seu CREF for aprovado.
            </MvText>
            <MvButton
              variant="outline"
              label="Ir para CREF e documentos"
              onPress={() => navigation.navigate("ProfessionalCredentials")}
            />
          </MvCard>
        ) : null}

        <MvCard style={{ gap: 10 }}>
          <ConsultancyTabSwitcher
            active="dashboard"
            onNavigate={(key) => {
              if (key === "offers") navigation.replace("ProfessionalConsultancyOffers");
              else if (key === "requests") navigation.replace("ProfessionalConsultancyRequests");
            }}
          />

          <View style={{ gap: 10 }}>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                padding: 10,
                gap: 10,
                backgroundColor: theme.inputBg,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">Checklist de prontidão</MvText>
                <MvText variant="body4" color="secondary">
                  {Math.round(readinessScore * 100)}%
                </MvText>
              </View>
              <MvProgressBar progress={readinessScore} height={5} />
              <View style={{ gap: 8 }}>
                {readinessChecklist.map((item) => (
                  <View key={item.key} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                    <Ionicons
                      name={item.done ? "checkmark-circle" : "ellipse-outline"}
                      size={16}
                      color={item.done ? theme.textGreen : theme.text2}
                      style={{ marginTop: 1 }}
                    />
                    <View style={{ flex: 1 }}>
                      <MvText variant="semi3">{item.title}</MvText>
                      <MvText variant="caption" color="secondary">
                        {item.detail}
                      </MvText>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                padding: 10,
                gap: 8,
                backgroundColor: theme.inputBg,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">Modo consultoria online</MvText>
                <MvBadge label={settingsEnabled ? "Habilitada" : "Desabilitada"} variant={settingsEnabled ? "green" : "orange"} />
              </View>
              <MvText variant="body4" color="secondary">
                Defina em quantos dias você entrega um plano após o aceite do aluno.
              </MvText>
              <MvInput
                keyboardType="numeric"
                placeholder="Prazo máximo de entrega (dias)"
                value={responseSlaDays}
                onChangeText={setResponseSlaDays}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton label="Habilitar" loading={savingSettings} onPress={() => void toggleOnlineSetting(true)} />
                </View>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Desabilitar" loading={savingSettings} onPress={() => void toggleOnlineSetting(false)} />
                </View>
              </View>
            </View>

            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                padding: 10,
                gap: 8,
                backgroundColor: theme.inputBg,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">Treinos pré-prontos</MvText>
                <MvBadge label={prebuiltPlanCount ? `${prebuiltPlanCount} disponíveis` : "Nenhum"} variant={prebuiltPlanCount ? "green" : "orange"} />
              </View>
              <MvText variant="body4" color="secondary">
                Deixe ao menos um treino base pronto para responder solicitações com agilidade.
              </MvText>
              <MvButton label={prebuiltPlanCount ? "Gerenciar treinos" : "Criar primeiro treino"} onPress={() => navigation.navigate("TrainingCreation")} />
            </View>

            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                padding: 10,
                gap: 8,
                backgroundColor: theme.inputBg,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <MvText variant="semi2">Fila de solicitações</MvText>
                <MvBadge label={`${openRequests.length} abertas`} variant={openRequests.length ? "orange" : "gray"} />
              </View>
              {firstOpenRequest ? (
                <>
                  <MvText variant="semi3">{firstOpenRequest.client?.name ?? "Aluno"}</MvText>
                  <MvText variant="body4" color="secondary">
                    Necessidade: {firstOpenRequest.trainingNeedText || "Não informado"}
                  </MvText>
                  <MvButton variant="outline" label="Ir para responder" onPress={() => navigation.replace("ProfessionalConsultancyRequests")} />
                </>
              ) : (
                <MvText variant="body4" color="secondary">
                  Sem solicitações abertas agora. Continue promovendo seus serviços.
                </MvText>
              )}
            </View>
          </View>
        </MvCard>

        <MvCard>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <MvText variant="semi2">Resumo rápido da operação</MvText>
              <MvText variant="body4" color="secondary">
                {onlineOffers.length
                  ? `Você tem ${onlineOffers.length} oferta(s) online ativa(s) e ${promotionCount} promoção(ões) em andamento.`
                  : "Você ainda não possui ofertas online ativas."}
              </MvText>
            </View>
            <MvBadge label={openRequests.length ? "Prioridade alta" : "Sem pendências"} variant={openRequests.length ? "orange" : "green"} />
          </View>
        </MvCard>
        </>
        )}
      </ScrollView>
      </ScreenEntrance>

      <ProfessionalBottomNav
        activeKey="consultoria"
        onPress={(key) => {
          if (key === "consultoria") return;
          if (key === "home") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
          else if (key === "agenda") navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
          else if (key === "alunos") navigation.navigate("ProfessionalStudents" as never);
          else if (key === "financeiro") navigation.navigate("ProfessionalTabs", { screen: "PayoutStatus" } as never);
        }}
      />
    </View>
  );
}
