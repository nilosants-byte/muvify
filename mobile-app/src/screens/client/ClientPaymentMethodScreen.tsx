import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StatusBar, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { paymentsApi } from "../../services/api/client";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientPaymentMethod">;

type CardForm = {
  number: string;
  expiry: string; // MM/YY
  cvv: string;
  holderName: string;
  cpf: string;
  nickname: string;
};

const MP_TOKENIZE_URL = "https://api.mercadopago.com/v1/card_tokens";

async function tokenizeMpCard(publicKey: string, form: CardForm): Promise<string> {
  const [expMonth, expYear] = form.expiry.split("/");
  const body = {
    card_number: form.number.replace(/\s/g, ""),
    expiration_month: expMonth?.padStart(2, "0") ?? "",
    expiration_year: expYear ? `20${expYear}` : "",
    security_code: form.cvv,
    cardholder: {
      name: form.holderName.trim(),
      identification: { type: "CPF", number: form.cpf.replace(/\D/g, "") }
    }
  };

  const res = await fetch(`${MP_TOKENIZE_URL}?public_key=${encodeURIComponent(publicKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = (await res.json()) as { message?: string; cause?: { description?: string }[] };
    const detail = err.cause?.[0]?.description ?? err.message ?? "Dados do cartão inválidos.";
    throw new Error(detail);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

function formatCardNumber(raw: string) {
  return raw.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

export function ClientPaymentMethodScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [configured, setConfigured] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mpPublicKey, setMpPublicKey] = useState("");
  const [form, setForm] = useState<CardForm>({
    number: "", expiry: "", cvv: "", holderName: "", cpf: "", nickname: ""
  });

  const loadStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const [status, setup] = await Promise.all([
        runWithAuth((token) => paymentsApi.customerStatus(token)),
        runWithAuth((token) => paymentsApi.createCustomerSetupIntent(token))
      ]);
      setConfigured(Boolean(status.configured));
      if (setup.mpPublicKey) setMpPublicKey(setup.mpPublicKey);
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao consultar método de pagamento." });
    } finally {
      setLoadingStatus(false);
    }
  }, [runWithAuth, showToast]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function saveCard() {
    if (!form.number.replace(/\s/g, "") || !form.expiry || !form.cvv || !form.holderName || !form.cpf) {
      showToast("Preencha todos os campos do cartão.", "error");
      return;
    }
    if (!mpPublicKey) {
      showToast("Chave pública do Mercado Pago não carregada. Tente novamente.", "error");
      return;
    }
    try {
      setSaving(true);
      const cardToken = await tokenizeMpCard(mpPublicKey, form);
      await runWithAuth((token) =>
        paymentsApi.confirmCustomerSetupIntentWithMetadata(token, {
          cardToken,
          nickname: form.nickname || undefined,
          makeDefault: true
        })
      );
      showToast("Cartão salvo com sucesso.", "success");
      setForm({ number: "", expiry: "", cvv: "", holderName: "", cpf: "", nickname: "" });
      await loadStatus();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar cartão." });
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.inputText,
    fontSize: 14,
    backgroundColor: theme.inputBg,
    marginBottom: 10
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) { navigation.goBack(); return; }
            navigation.navigate("ClientTabs", { screen: "ClientProfile" });
          }}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="h4">Pagamento</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
            Cadastre ou atualize seu cartão de pagamento.
          </MvText>
        </View>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled
        maximumZoomScale={3}
      >
        <MvCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <MvText variant="semi2">Status do cartão</MvText>
            <MvBadge label={configured ? "Configurado" : "Pendente"} variant={configured ? "green" : "orange"} />
          </View>
          <MvText variant="body4" color="secondary">
            {configured
              ? "Seu cartão está pronto para novas contratações."
              : "Adicione um cartão para contratar serviços com pré-autorização segura."}
          </MvText>
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 12 }}>{configured ? "Atualizar cartão" : "Adicionar cartão"}</MvText>

          <TextInput
            style={inputStyle}
            placeholder="Número do cartão"
            placeholderTextColor={theme.text2}
            keyboardType="numeric"
            value={form.number}
            onChangeText={(t) => setForm((p) => ({ ...p, number: formatCardNumber(t) }))}
            maxLength={19}
          />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="Validade MM/AA"
              placeholderTextColor={theme.text2}
              keyboardType="numeric"
              value={form.expiry}
              onChangeText={(t) => setForm((p) => ({ ...p, expiry: formatExpiry(t) }))}
              maxLength={5}
            />
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="CVV"
              placeholderTextColor={theme.text2}
              keyboardType="numeric"
              secureTextEntry
              value={form.cvv}
              onChangeText={(t) => setForm((p) => ({ ...p, cvv: t.replace(/\D/g, "").slice(0, 4) }))}
              maxLength={4}
            />
          </View>

          <TextInput
            style={inputStyle}
            placeholder="Nome do titular (como no cartão)"
            placeholderTextColor={theme.text2}
            autoCapitalize="characters"
            value={form.holderName}
            onChangeText={(t) => setForm((p) => ({ ...p, holderName: t }))}
          />

          <TextInput
            style={inputStyle}
            placeholder="CPF do titular"
            placeholderTextColor={theme.text2}
            keyboardType="numeric"
            value={form.cpf}
            onChangeText={(t) => setForm((p) => ({ ...p, cpf: t.replace(/\D/g, "").slice(0, 11) }))}
            maxLength={11}
          />

          <TextInput
            style={inputStyle}
            placeholder="Apelido do cartão (opcional)"
            placeholderTextColor={theme.text2}
            value={form.nickname}
            onChangeText={(t) => setForm((p) => ({ ...p, nickname: t }))}
          />

          <MvText variant="body4" color="secondary" style={{ marginBottom: 12 }}>
            Seus dados são tokenizados pelo Mercado Pago e não ficam armazenados no nosso servidor.
          </MvText>

          <MvButton
            label={configured ? "Atualizar cartão" : "Salvar cartão"}
            loading={saving}
            disabled={loadingStatus || saving}
            onPress={() => void saveCard()}
          />
        </MvCard>

        <MvButton
          variant="outline"
          label="Atualizar status"
          disabled={loadingStatus}
          onPress={() => void loadStatus()}
        />
      </ScrollView>
    </View>
  );
}
