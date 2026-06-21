import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ProviderBankAccount, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalFinancialDetails">;

export function ProfessionalFinancialDetailsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();

  const [account, setAccount] = useState<ProviderBankAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [bankName, setBankName] = useState("");
  const [agency, setAgency] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountDigit, setAccountDigit] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderDocument, setHolderDocument] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [accountType, setAccountType] = useState<"CHECKING" | "SAVINGS">("CHECKING");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await runWithAuth((token) => userApi.providerBankAccount(token));
      if (data) {
        setAccount(data);
        setBankName(data.bankName ?? "");
        setAgency(data.agency ?? "");
        setAccountNumber(data.accountNumber ?? "");
        setAccountDigit(data.accountDigit ?? "");
        setHolderName((data as any).holderName ?? "");
        setHolderDocument((data as any).holderDocument ?? "");
        setPixKey(data.pixKey ?? "");
        setAccountType(data.accountType ?? "CHECKING");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar dados bancários.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    if (!bankName.trim() || !agency.trim() || !accountNumber.trim() || !holderName.trim() || !holderDocument.trim()) {
      showToast("Preencha todos os campos obrigatórios.", "error");
      return;
    }
    try {
      setSaving(true);
      const updated = await runWithAuth((token) =>
        userApi.upsertProviderBankAccount(token, {
          bankName: bankName.trim(),
          accountType,
          agency: agency.trim(),
          accountNumber: accountNumber.trim(),
          accountDigit: accountDigit.trim(),
          holderName: holderName.trim(),
          holderDocument: holderDocument.replace(/\D/g, ""),
          pixKey: pixKey.trim() || undefined,
        })
      );
      setAccount(updated);
      showToast("Dados bancários salvos com sucesso.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar dados bancários.", navigation });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Dados para recebimento" onBack={() => navigation.goBack()} />

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <MvText variant="body4" color="secondary">
          Cadastre sua conta bancária para receber os pagamentos dos alunos.
        </MvText>

        {account ? (
          <MvCard>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <MvText variant="semi2">Conta cadastrada</MvText>
              <MvBadge label="Ativo" variant="green" />
            </View>
            <MvText variant="body4" color="secondary">
              {account.bankName} · Ag. {account.agency} · CC {account.accountNumber}-{account.accountDigit}
            </MvText>
            {account.pixKey ? <MvText variant="body4" color="secondary">PIX: {account.pixKey}</MvText> : null}
          </MvCard>
        ) : null}

        {loading ? (
          <MvText variant="body4" color="secondary">Carregando...</MvText>
        ) : (
          <>
            <MvCard>
              <View style={{ gap: 10 }}>
                <MvInput placeholder="Titular da conta (nome completo)" autoCapitalize="words" value={holderName} onChangeText={setHolderName} />
                <MvInput placeholder="CPF ou CNPJ do titular" keyboardType="numeric" value={holderDocument} onChangeText={setHolderDocument} />
                <MvInput placeholder="Banco (Ex.: Nubank, Itaú, Bradesco...)" autoCapitalize="words" value={bankName} onChangeText={setBankName} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvInput placeholder="Agência" keyboardType="numeric" value={agency} onChangeText={setAgency} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvInput placeholder="Conta" keyboardType="numeric" value={accountNumber} onChangeText={setAccountNumber} />
                  </View>
                  <View style={{ width: 72 }}>
                    <MvInput placeholder="DV" keyboardType="numeric" value={accountDigit} onChangeText={setAccountDigit} />
                  </View>
                </View>
                <MvInput
                  placeholder="Chave PIX (opcional — CPF, e-mail, telefone ou chave aleatória)"
                  autoCapitalize="none"
                  value={pixKey}
                  onChangeText={setPixKey}
                />
              </View>
            </MvCard>

            <MvCard>
              <MvText variant="semi3" style={{ marginBottom: 4 }}>Segurança</MvText>
              <MvText variant="body4" color="secondary">
                Seus dados bancários são criptografados e usados apenas para transferir seus ganhos.
                O repasse é de 90% do valor cobrado por sessão.
              </MvText>
            </MvCard>

            <MvButton label="Salvar dados bancários" loading={saving} onPress={() => void handleSave()} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
