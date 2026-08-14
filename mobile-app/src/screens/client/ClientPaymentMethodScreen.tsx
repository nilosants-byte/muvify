import React, { useEffect, useState } from "react";
import {
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { paymentsApi } from "../../services/api/client";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { handleScreenError } from "../shared/api-helpers";
import { useMvTheme } from "../../theme/MvThemeContext";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticCta, hapticPaymentSuccess } from "../../utils/haptics";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientPaymentMethod">;

type CardForm = {
  number: string;
  expiry: string;
  cvv: string;
  holderName: string;
  cpf: string;
  nickname: string;
};

const MP_TOKENIZE_URL = "https://api.mercadopago.com/v1/card_tokens";

const MP_ERROR_MAP: Record<string, string> = {
  "Invalid card number":                      "Número do cartão inválido.",
  "Invalid expiration date":                  "Data de validade inválida.",
  "Invalid CVV":                              "Código de segurança (CVV) inválido.",
  "Invalid cardholder name":                  "Nome do titular inválido.",
  "Invalid identification number":            "CPF inválido.",
  "card_number invalid":                      "Número do cartão inválido.",
  "expiration_month invalid":                 "Mês de validade inválido.",
  "expiration_year invalid":                  "Ano de validade inválido.",
  "security_code invalid":                    "Código de segurança inválido.",
  "cardholder.name invalid":                  "Nome do titular inválido.",
  "cardholder.identification.number invalid": "CPF inválido.",
  "cc_rejected_bad_filled_card_number":       "Número do cartão preenchido incorretamente.",
  "cc_rejected_bad_filled_date":              "Data de validade preenchida incorretamente.",
  "cc_rejected_bad_filled_security_code":     "Código de segurança preenchido incorretamente.",
  "cc_rejected_bad_filled_other":             "Dados do cartão inválidos.",
  "cc_rejected_insufficient_amount":          "Saldo insuficiente no cartão.",
  "cc_rejected_card_disabled":                "Cartão bloqueado ou inativo.",
  "cc_rejected_other_reason":                 "Cartão recusado. Tente outro cartão.",
};

function translateMpError(raw?: string): string {
  if (!raw) return "Dados do cartão inválidos.";
  for (const [key, msg] of Object.entries(MP_ERROR_MAP)) {
    if (raw.toLowerCase().includes(key.toLowerCase())) return msg;
  }
  return "Dados do cartão inválidos. Verifique as informações e tente novamente.";
}

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
    const err = (await res.json()) as { message?: string; cause?: { description?: string; code?: string }[] };
    const raw = err.cause?.[0]?.description ?? err.cause?.[0]?.code ?? err.message;
    throw new Error(translateMpError(raw));
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

// Campo de input padronizado V2
function PaymentInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  maxLength,
  style,
  testID,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];
  secureTextEntry?: boolean;
  autoCapitalize?: React.ComponentProps<typeof TextInput>["autoCapitalize"];
  maxLength?: number;
  style?: object;
  testID?: string;
}) {
  const { theme } = useMvTheme();
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.text3}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize ?? "none"}
      maxLength={maxLength}
      selectionColor={theme.primary}
      style={[{
        height: S.btnH,
        borderWidth: 1,
        borderColor: theme.borderMid,
        borderRadius: S.btnR,
        paddingHorizontal: 16,
        color: theme.text1,
        fontFamily: "DMSans_400Regular",
        fontSize: 14,
        backgroundColor: theme.inputBg,
      }, style]}
    />
  );
}

export function ClientPaymentMethodScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CardForm>({
    number: "", expiry: "", cvv: "", holderName: "", cpf: "", nickname: ""
  });

  const paymentQuery = useAuthQuery(
    queryKeys.payments.customerStatus(),
    async (token) => {
      const [status, setup] = await Promise.all([
        paymentsApi.customerStatus(token),
        paymentsApi.createCustomerSetupIntent(token),
      ]);
      return { configured: Boolean(status.configured), mpPublicKey: setup.mpPublicKey ?? "" };
    },
  );

  const configured = paymentQuery.data?.configured ?? false;
  const mpPublicKey = paymentQuery.data?.mpPublicKey ?? "";
  const loadingStatus = paymentQuery.isLoading;

  useEffect(() => {
    if (paymentQuery.error) {
      handleScreenError({ error: paymentQuery.error, showToast, fallbackMessage: "Falha ao consultar método de pagamento." });
    }
  }, [paymentQuery.error, showToast]);

  async function saveCard() {
    if (!form.number.replace(/\s/g, "") || !form.expiry || !form.cvv || !form.holderName || !form.cpf) {
      showToast("Preencha todos os campos do cartão.", "error");
      return;
    }
    const cpfDigits = form.cpf.replace(/\D/g, "");
    if (cpfDigits.length !== 11) {
      showToast("CPF deve ter 11 dígitos.", "error");
      return;
    }
    if (/^(\d)\1{10}$/.test(cpfDigits)) {
      showToast("CPF inválido. Verifique os dados.", "error");
      return;
    }
    if (!mpPublicKey) {
      showToast("Chave pública não carregada. Tente novamente.", "error");
      return;
    }
    try {
      setSaving(true);
      hapticCta();
      const cardToken = await tokenizeMpCard(mpPublicKey, form);
      await runWithAuth((token) =>
        paymentsApi.confirmCustomerSetupIntentWithMetadata(token, {
          cardToken,
          nickname: form.nickname || undefined,
          makeDefault: true
        })
      );
      hapticPaymentSuccess();
      showToast("Cartão salvo com sucesso.", "success");
      setForm({ number: "", expiry: "", cvv: "", holderName: "", cpf: "", nickname: "" });
      void paymentQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar cartão." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.payment-method">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) { navigation.goBack(); return; }
            navigation.navigate("ClientTabs", { screen: "ClientProfile" });
          }}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Pagamentos</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>métodos e histórico</Text>
        </View>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, gap: 14, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled
        maximumZoomScale={3}
      >
        {/* Status do cartão */}
        <View style={{
          borderRadius: S.cardR, borderWidth: 1,
          borderColor: configured ? theme.primarySubtleBorder : C.amberBorder,
          backgroundColor: configured ? "rgba(36,230,109,0.09)" : "rgba(245,166,35,0.08)",
          padding: 16,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Cartão de pagamento</Text>
            <View style={{
              backgroundColor: configured ? theme.primarySubtle : C.amberDim,
              borderWidth: 1, borderColor: configured ? theme.primarySubtleBorder : C.amberBorder,
              borderRadius: S.chipR, paddingHorizontal: 10, paddingVertical: 3,
            }}>
              <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: configured ? theme.primary : C.amber }}>
                {loadingStatus ? "Verificando..." : configured ? "Configurado" : "Pendente"}
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, lineHeight: 20 }}>
            {configured
              ? "Seu cartão está pronto. Você pode atualizá-lo a qualquer momento."
              : "Adicione um cartão para contratar serviços com pré-autorização segura."}
          </Text>
        </View>

        {/* Formulário do cartão */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: S.cardPad, gap: 10 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 4 }}>
            {configured ? "Atualizar cartão" : "Adicionar cartão"}
          </Text>

          <PaymentInput
            testID="input.payment.card-number"
            value={form.number}
            onChangeText={(t) => setForm((p) => ({ ...p, number: formatCardNumber(t) }))}
            placeholder="Número do cartão"
            keyboardType="numeric"
            maxLength={19}
          />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <PaymentInput
              testID="input.payment.expiry"
              value={form.expiry}
              onChangeText={(t) => setForm((p) => ({ ...p, expiry: formatExpiry(t) }))}
              placeholder="MM/AA"
              keyboardType="numeric"
              maxLength={5}
              style={{ flex: 1 }}
            />
            <PaymentInput
              testID="input.payment.cvv"
              value={form.cvv}
              onChangeText={(t) => setForm((p) => ({ ...p, cvv: t.replace(/\D/g, "").slice(0, 4) }))}
              placeholder="CVV"
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
              style={{ flex: 1 }}
            />
          </View>

          <PaymentInput
            testID="input.payment.holder-name"
            value={form.holderName}
            onChangeText={(t) => setForm((p) => ({ ...p, holderName: t }))}
            placeholder="Nome do titular (como no cartão)"
            autoCapitalize="characters"
          />

          <PaymentInput
            testID="input.payment.cpf"
            value={form.cpf}
            onChangeText={(t) => setForm((p) => ({ ...p, cpf: t.replace(/\D/g, "").slice(0, 11) }))}
            placeholder="CPF do titular"
            keyboardType="numeric"
            maxLength={11}
          />

          <PaymentInput
            value={form.nickname}
            onChangeText={(t) => setForm((p) => ({ ...p, nickname: t }))}
            placeholder="Apelido do cartão (opcional)"
          />
        </View>

        {/* Nota de segurança — destaque V2 */}
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 14, backgroundColor: theme.primarySubtle, borderRadius: 16, borderWidth: 1, borderColor: theme.primarySubtleBorder }}>
          <Ionicons name="shield-checkmark" size={18} color={theme.primary} style={{ marginTop: 1 }} />
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: C.zinc300, lineHeight: 18, flex: 1 }}>
            Seus dados são tokenizados pelo <Text style={{ fontFamily: "DMSans_700Bold", color: theme.text1 }}>Mercado Pago</Text> e nunca ficam armazenados nos nossos servidores.
          </Text>
        </View>

        {/* Botão de atualizar status */}
        <TouchableOpacity
          disabled={loadingStatus}
          onPress={() => void paymentQuery.refetch()}
          style={{ height: S.touchMin, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center", opacity: loadingStatus ? 0.5 : 1 }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: C.zinc300 }}>
            {loadingStatus ? "Verificando..." : "Verificar status do cartão"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Botão CTA fixo com safe area */}
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        paddingHorizontal: S.px, paddingBottom: Math.max(16, insets.bottom + 12), paddingTop: 12,
        backgroundColor: `${theme.bg}f0`, borderTopWidth: 1, borderTopColor: theme.border,
      }}>
        <TouchableOpacity
          testID="button.payment.save-card"
          disabled={loadingStatus || saving}
          onPress={() => void saveCard()}
          style={{
            height: S.btnH, borderRadius: S.btnR,
            backgroundColor: (loadingStatus || saving) ? "rgba(36,230,109,0.4)" : theme.primary,
            alignItems: "center", justifyContent: "center",
            shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
          }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
            {saving ? "Salvando..." : configured ? "Atualizar cartão" : "Salvar cartão"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
