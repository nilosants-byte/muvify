import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ProviderBankAccount, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ConnectPayoutAccount">;
type AccountType = "CHECKING" | "SAVINGS";
type Tab = "bank" | "pix";

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
  const isLight = theme.mode === "light";
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>("bank");
  const [bankForm, setBankForm] = useState(initialBankForm());
  const [pixKey, setPixKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingBank, setSavingBank] = useState(false);
  const [savingPix, setSavingPix] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const account = await runWithAuth((token) => userApi.providerBankAccount(token));
      setBankForm(initialBankForm(account));
      setPixKey(account?.pixKey ?? "");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar dados bancários.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  async function saveBank() {
    if (!bankForm.bankName.trim() || !bankForm.agency.trim() || !bankForm.accountNumber.trim() || !bankForm.accountDigit.trim() || !bankForm.holderName.trim() || !bankForm.holderDocument.trim()) {
      showToast("Preencha todos os campos obrigatórios da conta.", "error");
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
    if (!pixKey.trim()) {
      showToast("Informe sua chave PIX.", "error");
      return;
    }
    try {
      setSavingPix(true);
      // Load current bank data to preserve it while updating only the PIX key
      const current = await runWithAuth((token) => userApi.providerBankAccount(token));
      await runWithAuth((token) => userApi.upsertProviderBankAccount(token, {
        bankName: current?.bankName ?? (bankForm.bankName.trim() || "—"),
        accountType: current?.accountType ?? bankForm.accountType,
        agency: current?.agency ?? (bankForm.agency.trim() || "0"),
        accountNumber: current?.accountNumber ?? (bankForm.accountNumber.trim() || "0"),
        accountDigit: current?.accountDigit ?? (bankForm.accountDigit.trim() || "0"),
        holderName: current?.holderName ?? (bankForm.holderName.trim() || "—"),
        holderDocument: current?.holderDocument ?? (bankForm.holderDocument.trim() || "00000000000"),
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
    borderBottomColor: activeTab === tab ? "#22C55E" : "transparent",
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="semi1">Conta bancária</MvText>
      </View>

      {/* Tabs */}
      <View style={{
        flexDirection: "row", marginHorizontal: 16, marginTop: 14,
        borderWidth: 1, borderColor: theme.border, borderRadius: 12,
        overflow: "hidden",
        backgroundColor: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)",
      }}>
        <TouchableOpacity style={tabStyle("bank")} onPress={() => setActiveTab("bank")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="card-outline" size={16} color={activeTab === "bank" ? "#22C55E" : theme.text3} />
            <MvText variant="semi3" style={{ color: activeTab === "bank" ? "#22C55E" : theme.text3 }}>
              Transferência Bancária
            </MvText>
          </View>
          <MvText variant="body4" color="secondary" style={{ fontSize: 10, marginTop: 2 }}>para pagamentos no cartão</MvText>
        </TouchableOpacity>

        <View style={{ width: 1, backgroundColor: theme.border }} />

        <TouchableOpacity style={tabStyle("pix")} onPress={() => setActiveTab("pix")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="flash-outline" size={16} color={activeTab === "pix" ? "#22C55E" : theme.text3} />
            <MvText variant="semi3" style={{ color: activeTab === "pix" ? "#22C55E" : theme.text3 }}>
              Chave PIX
            </MvText>
          </View>
          <MvText variant="body4" color="secondary" style={{ fontSize: 10, marginTop: 2 }}>para pagamentos em PIX</MvText>
        </TouchableOpacity>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 12 }}
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
                      <TouchableOpacity
                        key={type}
                        onPress={() => setBankForm((c) => ({ ...c, accountType: type }))}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                          backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.inputBg,
                          borderWidth: 1, borderColor: selected ? "rgba(34,197,94,0.38)" : theme.border,
                        }}
                      >
                        <MvText variant="semi3" style={{ color: selected ? "#22C55E" : theme.text2 }}>
                          {type === "CHECKING" ? "Conta corrente" : "Conta poupança"}
                        </MvText>
                      </TouchableOpacity>
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
        ) : (
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
                    <Ionicons name="flash" size={14} color="#22C55E" />
                    <MvText variant="body4" style={{ color: "#22C55E", fontSize: 12 }}>
                      Pagamentos PIX serão enviados para esta chave
                    </MvText>
                  </View>
                ) : null}
              </View>
            </MvCard>

            <MvButton label="Salvar chave PIX" loading={savingPix} disabled={loading} onPress={() => void savePix()} />
          </>
        )}

        <MvButton variant="ghost" label="Voltar ao financeiro" onPress={() => navigation.replace("PayoutStatus")} />
      </ScrollView>
    </View>
  );
}
