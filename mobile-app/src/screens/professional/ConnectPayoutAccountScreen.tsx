import React, { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ProviderAccountStatus, ProviderBankAccount, paymentsApi, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ConnectPayoutAccount">;
type AccountType = "CHECKING" | "SAVINGS";
type Tab = "bank" | "pix" | "mp";

function initialBankForm(input?: ProviderBankAccount | null) {
  return {
    bankName: input?.bankName ?? "",
    accountType: (input?.accountType ?? "CHECKING") as AccountType,
    agency: input?.agency ?? "",
    accountNumber: input?.accountNumber ?? "",
    accountDigit: input?.accountDigit ?? "",
    holderName: input?.holderName ?? "",
    holderDocument: input?.holderDocument ?? "",
  };
}

export function ConnectPayoutAccountScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isLight = theme.mode === "light";

  const [activeTab, setActiveTab] = useState<Tab>("bank");
  const [bankForm, setBankForm] = useState(initialBankForm());
  const [pixKey, setPixKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingBank, setSavingBank] = useState(false);
  const [savingPix, setSavingPix] = useState(false);
  const [mpStatus, setMpStatus] = useState<ProviderAccountStatus | null>(null);
  const [connectingMp, setConnectingMp] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [account, mpAccountStatus] = await Promise.all([
        runWithAuth((token) => userApi.providerBankAccount(token)),
        runWithAuth((token) => paymentsApi.providerStatus(token)).catch(() => null),
      ]);
      setBankForm(initialBankForm(account));
      setPixKey(account?.pixKey ?? "");
      setMpStatus(mpAccountStatus);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar dados bancários.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function connectMpAccount() {
    try {
      setConnectingMp(true);
      const { onboardingUrl } = await runWithAuth((token) => paymentsApi.createOnboardingLink(token));
      await Linking.openURL(onboardingUrl);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao iniciar conexão com Mercado Pago." });
    } finally {
      setConnectingMp(false);
    }
  }

  async function saveBank() {
    if (!bankForm.bankName.trim() || !bankForm.agency.trim() || !bankForm.accountNumber.trim() || !bankForm.accountDigit.trim() || !bankForm.holderName.trim() || !bankForm.holderDocument.trim()) {
      showToast("Preencha todos os campos obrigatórios da conta.", "error");
      return;
    }
    if (!/^\d{4,6}$/.test(bankForm.agency.replace(/\D/g, ""))) {
      showToast("Agência deve ter 4 a 6 dígitos numéricos.", "error");
      return;
    }
    if (!/^\d{3,12}$/.test(bankForm.accountNumber.replace(/\D/g, ""))) {
      showToast("Número de conta deve ter entre 3 e 12 dígitos.", "error");
      return;
    }
    const docDigits = bankForm.holderDocument.replace(/\D/g, "");
    if (docDigits.length !== 11 && docDigits.length !== 14) {
      showToast("Documento do titular deve ser CPF (11 dígitos) ou CNPJ (14 dígitos).", "error");
      return;
    }
    try {
      setSavingBank(true);
      await runWithAuth((token) => userApi.upsertProviderBankAccount(token, {
        bankName: bankForm.bankName.trim(),
        accountType: bankForm.accountType,
        agency: bankForm.agency.trim(),
        accountNumber: bankForm.accountNumber.trim(),
        accountDigit: bankForm.accountDigit.trim(),
        holderName: bankForm.holderName.trim(),
        holderDocument: bankForm.holderDocument.trim(),
        pixKey: pixKey.trim() || undefined,
      }));
      showToast("Dados bancários salvos com sucesso.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar dados bancários.", navigation });
    } finally {
      setSavingBank(false);
    }
  }

  async function savePix() {
    const pix = pixKey.trim();
    if (!pix) {
      showToast("Informe sua chave PIX.", "error");
      return;
    }
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pix);
    const isCpf = /^\d{11}$/.test(pix.replace(/\D/g, "")) && pix.replace(/\D/g, "").length === 11;
    const isCnpj = /^\d{14}$/.test(pix.replace(/\D/g, ""));
    const isPhone = /^\+?55?\d{10,11}$/.test(pix.replace(/[\s\-()]/g, ""));
    const isRandom = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pix);
    if (!isEmail && !isCpf && !isCnpj && !isPhone && !isRandom) {
      showToast("Chave PIX inválida. Use e-mail, CPF, celular ou chave aleatória.", "error");
      return;
    }
    try {
      setSavingPix(true);
      // Load current bank data to preserve it while updating only the PIX key
      const current = await runWithAuth((token) => userApi.providerBankAccount(token));
      if (!current?.bankName || !current?.agency || !current?.accountNumber) {
        showToast("Preencha os dados bancários antes de salvar a chave PIX.", "error");
        return;
      }
      await runWithAuth((token) => userApi.upsertProviderBankAccount(token, {
        bankName: current.bankName,
        accountType: current.accountType,
        agency: current.agency,
        accountNumber: current.accountNumber,
        accountDigit: current.accountDigit,
        holderName: current.holderName,
        holderDocument: current.holderDocument,
        pixKey: pixKey.trim(),
      }));
      showToast("Chave PIX salva com sucesso.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar chave PIX.", navigation });
    } finally {
      setSavingPix(false);
    }
  }

  const tabStyle = (tab: Tab) => ({
    flex: 1, paddingVertical: 10, alignItems: "center" as const,
    borderBottomWidth: 2,
    borderBottomColor: activeTab === tab ? theme.primary : "transparent",
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader title="Conta bancária" onBack={() => navigation.goBack()} />

      {/* Tabs */}
      <View style={{
        flexDirection: "row", marginHorizontal: 16, marginTop: 14,
        borderWidth: 1, borderColor: theme.border, borderRadius: 12,
        overflow: "hidden",
        backgroundColor: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)",
      }}>
        <TouchableOpacity activeOpacity={0.7} style={tabStyle("bank")} onPress={() => setActiveTab("bank")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="card-outline" size={16} color={activeTab === "bank" ? theme.primary : theme.text3} />
            <MvText variant="semi3" style={{ color: activeTab === "bank" ? theme.primary : theme.text3 }}>
              Banco
            </MvText>
          </View>
          <MvText variant="body4" color="secondary" style={{ fontSize: 10, marginTop: 2 }}>cartão de crédito</MvText>
        </TouchableOpacity>

        <View style={{ width: 1, backgroundColor: theme.border }} />

        <TouchableOpacity activeOpacity={0.7} style={tabStyle("pix")} onPress={() => setActiveTab("pix")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="flash-outline" size={16} color={activeTab === "pix" ? theme.primary : theme.text3} />
            <MvText variant="semi3" style={{ color: activeTab === "pix" ? theme.primary : theme.text3 }}>
              PIX
            </MvText>
          </View>
          <MvText variant="body4" color="secondary" style={{ fontSize: 10, marginTop: 2 }}>pagamento em PIX</MvText>
        </TouchableOpacity>

        <View style={{ width: 1, backgroundColor: theme.border }} />

        <TouchableOpacity activeOpacity={0.7} style={tabStyle("mp")} onPress={() => setActiveTab("mp")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="shield-checkmark-outline" size={16} color={activeTab === "mp" ? theme.primary : theme.text3} />
            <MvText variant="semi3" style={{ color: activeTab === "mp" ? theme.primary : theme.text3 }}>
              MP
            </MvText>
            {mpStatus?.hasAccount ? (
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.primary }} />
            ) : (
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#F59E0B" }} />
            )}
          </View>
          <MvText variant="body4" color="secondary" style={{ fontSize: 10, marginTop: 2 }}>split automático</MvText>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 12 }}>
          {[52, 52, 44, 44, 44, 44].map((h, i) => (
            <View key={i} style={{ height: h, borderRadius: 12, backgroundColor: theme.chipBg }} />
          ))}
        </View>
      ) : null}

      <ScreenEntrance key={loading ? "loading" : "ready"}>
      <ScrollView automaticallyAdjustKeyboardInsets={true} style={{ display: loading ? "none" : "flex" }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(40, insets.bottom + 24), gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "bank" ? (
          <>
            <MvCard>
              <MvText variant="body4" color="secondary">
                Quando um aluno pagar com <MvText variant="semi3" style={{ color: theme.text1 }}>cartão</MvText>, o repasse será enviado para esta conta bancária conforme o ciclo de liquidação.
              </MvText>
            </MvCard>

            <MvCard>
              <View style={{ gap: 10 }}>
                <MvInput
                  placeholder="Banco (Ex: Banco do Brasil, Nubank)"
                  value={bankForm.bankName}
                  onChangeText={(v) => setBankForm((c) => ({ ...c, bankName: v }))}
                />

                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["CHECKING", "SAVINGS"] as AccountType[]).map((type) => {
                    const selected = bankForm.accountType === type;
                    return (
                      <PressableScale
                        key={type}
                        scale={0.95}
                        onPress={() => setBankForm((c) => ({ ...c, accountType: type }))}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                          backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.inputBg,
                          borderWidth: 1, borderColor: selected ? "rgba(34,197,94,0.38)" : theme.border,
                        }}
                      >
                        <MvText variant="semi3" style={{ color: selected ? theme.primary : theme.text2 }}>
                          {type === "CHECKING" ? "Conta corrente" : "Conta poupança"}
                        </MvText>
                      </PressableScale>
                    );
                  })}
                </View>

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvInput placeholder="Agência" keyboardType="number-pad" value={bankForm.agency} onChangeText={(v) => setBankForm((c) => ({ ...c, agency: v }))} />
                  </View>
                  <View style={{ flex: 2 }}>
                    <MvInput placeholder="Conta" keyboardType="number-pad" value={bankForm.accountNumber} onChangeText={(v) => setBankForm((c) => ({ ...c, accountNumber: v }))} />
                  </View>
                  <View style={{ width: 66 }}>
                    <MvInput placeholder="DV" keyboardType="number-pad" value={bankForm.accountDigit} onChangeText={(v) => setBankForm((c) => ({ ...c, accountDigit: v }))} />
                  </View>
                </View>

                <MvInput placeholder="Nome do titular" value={bankForm.holderName} onChangeText={(v) => setBankForm((c) => ({ ...c, holderName: v }))} />
                <MvInput placeholder="CPF / CNPJ do titular" keyboardType="number-pad" value={bankForm.holderDocument} onChangeText={(v) => setBankForm((c) => ({ ...c, holderDocument: v }))} />
              </View>
            </MvCard>

            <MvButton label="Salvar dados bancários" loading={savingBank} disabled={loading} onPress={() => void saveBank()} />
          </>
        ) : activeTab === "pix" ? (
          <>
            <MvCard>
              <MvText variant="body4" color="secondary">
                Quando um aluno pagar com <MvText variant="semi3" style={{ color: theme.text1 }}>PIX</MvText>, o valor será enviado diretamente para esta chave. Use e-mail, CPF, celular ou chave aleatória.
              </MvText>
            </MvCard>

            <MvCard>
              <View style={{ gap: 10 }}>
                <MvInput
                  placeholder="Chave PIX (e-mail, CPF, celular ou chave aleatória)"
                  value={pixKey}
                  onChangeText={setPixKey}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {pixKey.trim() ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
                    <Ionicons name="flash" size={14} color={theme.primary} />
                    <MvText variant="body4" style={{ color: theme.primary, fontSize: 12 }}>
                      Pagamentos PIX serão enviados para esta chave
                    </MvText>
                  </View>
                ) : null}
              </View>
            </MvCard>

            <MvButton label="Salvar chave PIX" loading={savingPix} disabled={loading} onPress={() => void savePix()} />
          </>
        ) : activeTab === "mp" ? (
          <>
            {/* Status da conta MP */}
            {mpStatus?.hasAccount ? (
              <MvCard>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="shield-checkmark" size={20} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi2">Conta Mercado Pago vinculada</MvText>
                    <MvText variant="body4" color="secondary">ID: {mpStatus.accountId}</MvText>
                  </View>
                  <MvBadge label="Ativo" variant="green" />
                </View>
                <MvText variant="body4" color="secondary">
                  O split automático está configurado. Quando um aluno pagar, 90% do valor será transferido diretamente para sua conta Mercado Pago pelo próprio MP.
                </MvText>
              </MvCard>
            ) : (
              <MvCard>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="alert-circle-outline" size={20} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi2">Conta não vinculada</MvText>
                    <MvBadge label="Pendente" variant="orange" />
                  </View>
                </View>
                <MvText variant="body4" color="secondary">
                  Conecte sua conta Mercado Pago para ativar o repasse automático. Quando um aluno pagar, o Mercado Pago divide automaticamente: 90% vai direto para você, 10% fica com a plataforma. Nenhuma ação manual necessária.
                </MvText>
              </MvCard>
            )}

            {/* Como funciona */}
            <MvCard>
              <MvText variant="semi3" style={{ marginBottom: 8 }}>Como funciona o repasse</MvText>
              {[
                { icon: "flash-outline" as const,          label: "PIX",           desc: "Disponível no mesmo dia (D+0)" },
                { icon: "card-outline" as const,           label: "Cartão",        desc: "Disponível em até 14 dias (D+14)" },
                { icon: "shield-checkmark-outline" as const, label: "Segurança",   desc: "100% processado pelo Mercado Pago" },
                { icon: "pie-chart-outline" as const,      label: "Divisão",       desc: "90% para você · 10% para a Muvify" },
              ].map((item) => (
                <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.borderSub }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.10)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={item.icon} size={14} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3" style={{ fontSize: 12 }}>{item.label}</MvText>
                    <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>{item.desc}</MvText>
                  </View>
                </View>
              ))}
            </MvCard>

            <MvButton
              label={mpStatus?.hasAccount ? "Reconectar conta Mercado Pago" : "Conectar conta Mercado Pago"}
              loading={connectingMp}
              onPress={() => void connectMpAccount()}
            />
            {mpStatus?.hasAccount ? (
              <MvButton
                variant="ghost"
                label="Atualizar status"
                onPress={() => void load()}
              />
            ) : null}
          </>
        ) : null}

        <MvButton variant="ghost" label="Voltar ao financeiro" onPress={() => navigation.replace("PayoutStatus")} />
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
