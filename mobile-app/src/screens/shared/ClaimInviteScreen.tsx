import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { consultancyApi, ExternalStudentInvitePreview } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useAuthMutation } from "../../hooks/useAuthQuery";
import { MvButton, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { useMvTheme } from "../../theme/MvThemeContext";
import { hapticCta } from "../../utils/haptics";
import { extractApiMessage, handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<any, "ClaimInvite">;

const DISCLAIMER_TEXT =
  "Esse vínculo foi criado diretamente pelo profissional, pra um aluno que já era dele. Aqui o Muvify só disponibiliza a ferramenta — não intermedia nem se responsabiliza por esse acordo.";

const EXCLUSIVITY_TEXT =
  "Enquanto esse vínculo estiver ativo, você não verá outros profissionais no Muvify — só poderá contratar outros serviços do próprio profissional. Cancele quando quiser.";

export function ClaimInviteScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, role, user, showToast, signOut, activeEngagement, refreshActiveEngagement } = useAppState();

  const [token, setToken] = useState((route.params?.token as string | undefined) ?? "");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<ExternalStudentInvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  const loadPreview = useCallback(async (rawToken: string) => {
    if (rawToken.trim().length < 4) return;
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const result = await consultancyApi.previewExternalStudentInvite(rawToken.trim());
      setPreview(result);
      // Raio-X focado (achado alto): o aviso de troca ("willSwitchProvider"
      // abaixo) decidia com base no `activeEngagement` já hidratado no
      // AppState no boot do app — se o vínculo real mudou desde então (em
      // outra sessão/dispositivo, ou só pelo tempo passado), o aviso podia
      // estar errado bem no momento mais importante de mostrá-lo certo
      // (antes do aluno confirmar a troca). Revalida assim que o preview
      // carrega, exatamente antes de decidir o que mostrar.
      if (isAuthenticated && role === "CLIENT") {
        void refreshActiveEngagement();
      }
    } catch (error) {
      setPreviewError(extractApiMessage(error, "Não foi possível carregar este convite."));
    } finally {
      setLoadingPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, role]);

  useEffect(() => {
    if (route.params?.token) {
      void loadPreview(route.params.token as string);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claimInvite = useAuthMutation((authToken) => consultancyApi.claimExternalStudentInvite(authToken, token), {
    onSuccess: async () => {
      hapticCta();
      showToast("Vínculo confirmado! Sua ficha de treino já aparece em Meu Treino.", "success");
      // Realinhamento com o Will (2026-08-25, Bloco 2): aceitar o convite
      // agora pode trocar de profissional — precisa atualizar o resumo de
      // vínculo ativo pra Home/navegação refletirem o profissional novo.
      await refreshActiveEngagement();
      navigation.navigate("ClientTabs", { screen: "MyTraining" });
    },
    onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao confirmar o convite.", navigation })
  });

  const providerInitials = preview?.provider.displayName?.trim().slice(0, 2).toUpperCase() ?? "";

  // Realinhamento com o Will (2026-08-25, Bloco 2): aceitar não bloqueia
  // mais quando o cliente já tem vínculo com OUTRO profissional — em vez
  // disso, TROCA. Precisa avisar isso explicitamente antes da confirmação,
  // não só depois via toast.
  const willSwitchProvider =
    isAuthenticated &&
    activeEngagement?.hasActive === true &&
    !!preview &&
    activeEngagement.providerId !== preview.provider.id;

  // Raio-X focado (achado médio): trocar de profissional pode custar
  // dinheiro de verdade — uma sessão avulsa do vínculo antigo com menos de
  // 2h de antecedência é COBRADA (não estornada) ao ser cancelada na troca,
  // mesma regra que já protege o profissional de perder um horário
  // reservado em cima da hora. `upcomingSessions` já vem no resumo de
  // vínculo ativo, sem precisar de nenhum dado novo do backend.
  const hasImminentSession =
    willSwitchProvider &&
    activeEngagement?.hasActive === true &&
    activeEngagement.upcomingSessions.some((session) => {
      const hoursUntil = (new Date(session.scheduledAt).getTime() - Date.now()) / (60 * 60 * 1000);
      return hoursUntil >= 0 && hoursUntil < 2;
    });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.shared.claim-invite"
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center"
        }}
      >
        <PressableScale
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.backBtn,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text1} />
        </PressableScale>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom + 24, 40), gap: 18 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!preview ? (
          <View style={{ gap: 16, alignItems: "center", paddingTop: 12 }}>
            <MvText variant="display" style={{ textAlign: "center" }}>Tenho um convite</MvText>
            <MvText variant="body3" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
              Digite o código que seu profissional te enviou.
            </MvText>
            <MvInput
              value={token}
              onChangeText={setToken}
              placeholder="Código do convite"
              autoCapitalize="characters"
              style={{ width: "100%" }}
              testID="input.claim-invite.token"
            />
            {previewError ? (
              <MvText variant="caption" style={{ color: theme.danger, textAlign: "center" }}>{previewError}</MvText>
            ) : null}
            <MvButton
              label={loadingPreview ? "Buscando..." : "Ver convite"}
              loading={loadingPreview}
              disabled={loadingPreview || token.trim().length < 4}
              onPress={() => void loadPreview(token)}
              style={{ width: "100%" }}
              testID="button.claim-invite.preview"
            />
          </View>
        ) : (
          <View style={{ gap: 16, alignItems: "center", paddingTop: 12 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                padding: 4,
                backgroundColor: theme.primary,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  overflow: "hidden",
                  backgroundColor: theme.cardBg,
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <MvText variant="h3" style={{ color: theme.text2 }}>{providerInitials}</MvText>
              </View>
            </View>
            <MvText variant="h2" style={{ textAlign: "center" }}>
              {isAuthenticated
                ? `Confirmar vínculo com ${preview.provider.displayName}?`
                : `${preview.provider.displayName} quer te adicionar como aluno`}
            </MvText>
            {!isAuthenticated ? (
              <MvText variant="body3" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                Sua ficha de treino já fica liberada assim que você confirmar.
              </MvText>
            ) : null}

            <View
              style={{
                width: "100%",
                borderRadius: 14,
                padding: 13,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.cardBg,
                flexDirection: "row",
                gap: 9
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={theme.text3} style={{ marginTop: 1 }} />
              <MvText variant="caption" style={{ color: theme.text3, flex: 1, lineHeight: 16 }}>{DISCLAIMER_TEXT}</MvText>
            </View>

            {isAuthenticated && !willSwitchProvider ? (
              // Realinhamento com o Will (2026-08-25, Bloco 2): quando vai
              // trocar de profissional, o banner específico abaixo já cobre
              // essa informação de forma mais concreta — mostrar os dois
              // juntos ficaria redundante/confuso (um fala em "travado", o
              // outro em "vai substituir").
              <View
                style={{
                  width: "100%",
                  borderRadius: 14,
                  padding: 13,
                  borderWidth: 1,
                  borderColor: theme.warningSubtleBorder,
                  backgroundColor: theme.warningSubtle,
                  flexDirection: "row",
                  gap: 9
                }}
              >
                <Ionicons name="lock-closed-outline" size={16} color={theme.warning} style={{ marginTop: 1 }} />
                <MvText variant="caption" style={{ color: theme.warning, flex: 1, lineHeight: 16 }}>{EXCLUSIVITY_TEXT}</MvText>
              </View>
            ) : null}

            {willSwitchProvider ? (
              <View
                style={{
                  width: "100%",
                  borderRadius: 14,
                  padding: 13,
                  borderWidth: 1,
                  borderColor: theme.dangerSubtleBorder,
                  backgroundColor: theme.dangerSubtle,
                  flexDirection: "row",
                  gap: 9
                }}
                testID="banner.claim-invite.will-switch-provider"
              >
                <Ionicons name="swap-horizontal-outline" size={16} color={theme.danger} style={{ marginTop: 1 }} />
                <MvText variant="caption" style={{ color: theme.danger, flex: 1, lineHeight: 16 }}>
                  Você já tem um vínculo ativo com {activeEngagement?.hasActive ? activeEngagement.providerName : "outro profissional"}.
                  Confirmar aqui vai substituir esse vínculo por {preview.provider.displayName}.
                  {/* Raio-X focado (achado médio): sessão com menos de 2h de
                      antecedência é cobrada (não estornada) ao ser
                      cancelada — o aluno precisa saber disso ANTES de
                      confirmar a troca, não só descobrir depois. */}
                  {hasImminentSession
                    ? " Você tem uma sessão marcada pra menos de 2h — ela será cobrada normalmente, sem estorno, mesmo com a troca."
                    : ""}
                </MvText>
              </View>
            ) : null}

            {isAuthenticated && role === "CLIENT" ? (
              <>
                <TouchableOpacity
                  onPress={() => setConsentChecked((v) => !v)}
                  style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, width: "100%" }}
                  testID="checkbox.claim-invite.consent"
                >
                  <Ionicons
                    name={consentChecked ? "checkbox" : "square-outline"}
                    size={18}
                    color={consentChecked ? theme.primary : theme.text3}
                  />
                  <MvText variant="body4" style={{ flex: 1, color: theme.text2 }}>
                    {willSwitchProvider
                      ? `Li o aviso acima e quero trocar meu vínculo pelo de ${preview.provider.displayName}.`
                      : `Li o aviso acima e quero confirmar o vínculo com ${preview.provider.displayName}.`}
                  </MvText>
                </TouchableOpacity>
                <MvButton
                  label={willSwitchProvider ? "Confirmar troca" : "Confirmar vínculo"}
                  icon="checkmark-circle-outline"
                  disabled={!consentChecked || claimInvite.isPending}
                  loading={claimInvite.isPending}
                  onPress={() => claimInvite.mutate()}
                  style={{ width: "100%" }}
                  testID="button.claim-invite.confirm"
                />
                <PressableScale scale={0.98} onPress={() => navigation.goBack()}>
                  <MvText variant="semi3" style={{ color: theme.text2 }}>Recusar</MvText>
                </PressableScale>
              </>
            ) : null}

            {!isAuthenticated ? (
              <>
                <MvButton
                  label="Criar minha conta e confirmar"
                  onPress={() => {
                    showToast(`Depois de criar sua conta, use "Tenho um convite" com o código ${token.trim().toUpperCase()}.`, "info");
                    navigation.navigate("Register");
                  }}
                  style={{ width: "100%" }}
                  testID="button.claim-invite.signup"
                />
                <TouchableOpacity onPress={() => navigation.navigate("Login")} testID="link.claim-invite.login">
                  <MvText variant="body4" style={{ color: theme.text3 }}>
                    Já tem conta no Muvify? <MvText variant="semi3" style={{ color: theme.primary }}>Entrar</MvText>
                  </MvText>
                </TouchableOpacity>
              </>
            ) : null}

            {isAuthenticated && role !== "CLIENT" ? (
              <>
                <MvText variant="body4" style={{ color: theme.text3, textAlign: "center" }}>
                  Convites de aluno só podem ser confirmados por uma conta de aluno{user?.name ? `, não por ${user.name}` : ""}.
                </MvText>
                {/* Raio-X pós-épico (achado baixo): antes disso, esse texto
                    era um beco sem saída — nenhuma ação além do botão de
                    voltar no topo. */}
                <TouchableOpacity
                  onPress={() => void signOut()}
                  testID="button.claim-invite.switch-account"
                >
                  <MvText variant="semi3" style={{ color: theme.primary, textAlign: "center" }}>
                    Sair e entrar com uma conta de aluno
                  </MvText>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
