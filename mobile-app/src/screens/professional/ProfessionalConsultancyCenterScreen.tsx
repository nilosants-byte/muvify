import React from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { consultancyApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvProgressBar, MvRefreshControl, MvText, MvToggle } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { formatCurrencyBRL } from "../../utils/formatters";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { ConsultancyTabSwitcher, ConsultancyTabKey } from "../../components/professional/ConsultancyTabSwitcher";
import { ProfessionalConsultancyOffersScreen } from "./ProfessionalConsultancyOffersScreen";
import { ProfessionalConsultancyRequestsScreen } from "./ProfessionalConsultancyRequestsScreen";
import { handleScreenError } from "../shared/api-helpers";
import { useConsultancyCenterData } from "../../hooks/useConsultancyCenterData";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConsultancyCenter">;

// Painel, Vitrine e Pedidos vivem nesta única tela — trocar de aba só troca
// o estado local `activeTab`, sem navegação nem transição (ver Etapa 7).
export function ProfessionalConsultancyCenterScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";
  const [activeTab, setActiveTab] = React.useState<ConsultancyTabKey>(route.params?.initialTab ?? "dashboard");

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
    averageTicket,
    readinessChecklist,
    readinessScore,
    nextGuidedStep,
    onRefresh,
  } = useConsultancyCenterData();

  const [savingSettings, setSavingSettings] = React.useState(false);
  const [slaEditorOpen, setSlaEditorOpen] = React.useState(false);
  const [checklistExpanded, setChecklistExpanded] = React.useState(false);
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

  function StatStrip({ items }: { items: { label: string; value: string }[] }) {
    return (
      <View
        style={{
          flexDirection: "row",
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.inputBg,
          borderRadius: 12,
          paddingVertical: 10,
        }}
      >
        {items.map((it, idx) => (
          <View
            key={it.label}
            style={{
              flex: 1,
              alignItems: "center",
              gap: 2,
              borderRightWidth: idx < items.length - 1 ? 1 : 0,
              borderRightColor: theme.border,
            }}
          >
            <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: theme.text1 }}>{it.value}</MvText>
            <MvText variant="caption" color="secondary" style={{ fontSize: 9.5 }} numberOfLines={1}>{it.label}</MvText>
          </View>
        ))}
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
        subtitle={activeTab === "offers" ? "Suas ofertas de consultoria" : activeTab === "requests" ? "Solicitações de alunos" : "Painel geral"}
        onBack={() => {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
        }}
        action={{ icon: "archive-outline", label: "Arquivados", onPress: () => navigation.navigate("ProfessionalArchivedRequests") }}
      />

      <ScreenEntrance>
      <View style={{ flex: 1 }}>
        {loading ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }} showsVerticalScrollIndicator={false}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </ScrollView>
        ) : (
        <>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 }}>
          <ConsultancyTabSwitcher active={activeTab} onNavigate={setActiveTab} />

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
                Enquanto isso, você não pode publicar ofertas nem aparecer para alunos.
              </MvText>
              <MvButton
                variant="outline"
                label="Ir para CREF e documentos"
                onPress={() => navigation.navigate("ProfessionalCredentials")}
              />
            </MvCard>
          ) : null}
        </View>

        <View style={{ flex: 1, display: activeTab === "dashboard" ? "flex" : "none" }}>
        <ScrollView
          style={{ flex: 1 }}
          automaticallyAdjustKeyboardInsets={true}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <MvRefreshControl refreshing={centerQuery.isRefetching} onRefresh={() => void onRefresh()} />
          }
        >
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
            <StatStrip
              items={[
                { label: "Abertas", value: String(openRequests.length) },
                { label: "Em análise", value: String(respondedRequests.length) },
                { label: "Aceitas", value: String(acceptedRequests.length) },
                { label: "Ticket online", value: averageTicket ? formatCurrencyBRL(averageTicket / 100) : "R$ 0,00" },
              ]}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <QuickAction
                icon="chatbubble-ellipses-outline"
                title="Responder agora"
                subtitle={openRequests.length ? `${openRequests.length} ${openRequests.length === 1 ? "pendente" : "pendentes"}` : "Sem pendências"}
                onPress={() => setActiveTab("requests")}
                urgent={openRequests.length > 0}
              />
              <QuickAction
                icon="pricetag-outline"
                title="Nova oferta"
                subtitle="Cadastrar e publicar serviço"
                onPress={() => setActiveTab("offers")}
              />
            </View>
          </View>
        </MvCard>

        <MvCard style={{ gap: 10 }}>
          <View style={{ gap: 10 }}>
            {readinessScore >= 1 ? (
              <View
                style={{
                  flexDirection: "row", alignItems: "center", gap: 8,
                  borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: 12,
                  padding: 10, backgroundColor: theme.primarySubtle,
                }}
              >
                <Ionicons name="checkmark-circle" size={18} color={theme.textGreen} />
                <MvText variant="semi3" style={{ color: theme.textGreen }}>Tudo pronto para vender</MvText>
              </View>
            ) : (
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <MvText variant="body4" color="secondary">
                      {Math.round(readinessScore * 100)}%
                    </MvText>
                    <PressableScale onPress={() => setChecklistExpanded((v) => !v)} style={{ padding: 4 }}>
                      <Ionicons name={checklistExpanded ? "chevron-up" : "chevron-down"} size={16} color={theme.text3} />
                    </PressableScale>
                  </View>
                </View>
                <MvProgressBar progress={readinessScore} height={5} />
                {checklistExpanded ? (
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
                ) : null}
              </View>
            )}

            <View
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                padding: 12,
                gap: 10,
                backgroundColor: theme.inputBg,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="radio-outline" size={18} color={settingsEnabled ? theme.textGreen : theme.text3} />
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3">Consultoria online</MvText>
                  <MvText variant="caption" color="secondary">
                    {settingsEnabled ? `Entrega em até ${responseSlaDays} dia(s)` : "Desligada — você não recebe novas solicitações"}
                  </MvText>
                </View>
                <MvToggle value={settingsEnabled} onValueChange={(v) => void toggleOnlineSetting(v)} disabled={savingSettings} />
                <PressableScale onPress={() => setSlaEditorOpen((current) => !current)} style={{ padding: 4 }}>
                  <Ionicons name={slaEditorOpen ? "chevron-up" : "pencil-outline"} size={16} color={theme.text3} />
                </PressableScale>
              </View>
              {slaEditorOpen ? (
                <View style={{ gap: 8 }}>
                  <MvInput
                    keyboardType="numeric"
                    placeholder="Prazo máximo de entrega (dias)"
                    value={responseSlaDays}
                    onChangeText={setResponseSlaDays}
                  />
                  <MvButton
                    label="Salvar prazo"
                    loading={savingSettings}
                    onPress={() => { void toggleOnlineSetting(settingsEnabled); setSlaEditorOpen(false); }}
                  />
                </View>
              ) : null}
            </View>

            {prebuiltPlanCount === 0 ? (
              <PressableScale
                onPress={() => navigation.navigate("TrainingCreation")}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  borderWidth: 1, borderColor: theme.warningSubtleBorder, borderRadius: 12,
                  padding: 12, backgroundColor: theme.warningSubtle,
                }}
              >
                <Ionicons name="barbell-outline" size={18} color={theme.warning} />
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3" style={{ color: theme.warning }}>Cadastre um treino pré-pronto</MvText>
                  <MvText variant="caption" color="secondary">Agiliza sua resposta às solicitações de alunos</MvText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.warning} />
              </PressableScale>
            ) : null}

          </View>
        </MvCard>
        </ScrollView>
        </View>

        <View style={{ flex: 1, display: activeTab === "offers" ? "flex" : "none" }}>
          <ProfessionalConsultancyOffersScreen navigation={navigation} />
        </View>

        <View style={{ flex: 1, display: activeTab === "requests" ? "flex" : "none" }}>
          <ProfessionalConsultancyRequestsScreen navigation={navigation} onSwitchToOffers={() => setActiveTab("offers")} />
        </View>
        </>
        )}
      </View>
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
