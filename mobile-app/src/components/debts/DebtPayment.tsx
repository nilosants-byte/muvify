import React, { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { DebtRecord, debtsApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton } from "../mv";
import { handleScreenError } from "../../screens/shared/api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";
import { S } from "../../theme/v2tokens";

// Decisão do Danilo (teste manual C8.1, 20/10/2026): pendência pode ser paga
// com o cartão salvo ou por Pix. O Pix fica guardado na própria pendência
// (válido por 24h) e a pendência some sozinha quando o pagamento cai — a tela
// consulta o servidor a cada poucos segundos enquanto houver um Pix aberto.

export function hasActivePix(debt: DebtRecord) {
  return Boolean(
    debt.pendingPixCopyPasteCode &&
      debt.pendingPixExpiresAt &&
      new Date(debt.pendingPixExpiresAt).getTime() > Date.now() &&
      debt.status !== "PAID" &&
      debt.status !== "WRITTEN_OFF"
  );
}

export const DEBT_PIX_POLL_MS = 5000;

export function debtsPollInterval(debts: DebtRecord[] | undefined) {
  return debts?.some(hasActivePix) ? DEBT_PIX_POLL_MS : false;
}

export function useDebtPayment(options: {
  debts: DebtRecord[];
  refetch: () => unknown;
  title: string;
  successMessage: string;
}) {
  const { runWithAuth, showToast } = useAppState();
  const [payingId, setPayingId] = useState<string | null>(null);
  const pixIdsRef = useRef<Set<string>>(new Set());

  // Pix que estava aberto e agora a pendência foi paga → avisa o usuário.
  useEffect(() => {
    const stillOpen = new Set(options.debts.filter(hasActivePix).map((d) => d.id));
    for (const id of pixIdsRef.current) {
      const debt = options.debts.find((d) => d.id === id);
      if (!debt || debt.status === "PAID") {
        showToast(options.successMessage, "success");
      }
    }
    pixIdsRef.current = stillOpen;
  }, [options.debts, options.successMessage, showToast]);

  async function pay(debtId: string, method: "CARD" | "PIX") {
    try {
      setPayingId(debtId);
      const result = await runWithAuth((token) => debtsApi.payDebt(token, debtId, method));
      if (method === "CARD") {
        showToast(options.successMessage, "success");
      } else if (hasActivePix(result)) {
        pixIdsRef.current.add(debtId);
      }
      void options.refetch();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: method === "PIX" ? "Não foi possível gerar o Pix." : "Não foi possível processar o pagamento."
      });
    } finally {
      setPayingId(null);
    }
  }

  function confirmPay(debt: DebtRecord) {
    if (hasActivePix(debt)) {
      // Já tem um Pix aberto na tela — não pergunta de novo.
      return;
    }
    Alert.alert(
      options.title,
      `Como você quer pagar ${formatCurrencyBRL(debt.amountCents / 100)}?`,
      [
        { text: "Cartão salvo", onPress: () => void pay(debt.id, "CARD") },
        { text: "Pix", onPress: () => void pay(debt.id, "PIX") },
        { text: "Voltar", style: "cancel" }
      ]
    );
  }

  return { payingId, confirmPay };
}

export function DebtPixPanel({ debt }: { debt: DebtRecord }) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  if (!hasActivePix(debt) || !debt.pendingPixCopyPasteCode) return null;
  const code = debt.pendingPixCopyPasteCode;
  const expiresAt = new Date(debt.pendingPixExpiresAt!);
  const expiresLabel = expiresAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, padding: S.cardPad, gap: 10, alignItems: "center" }}>
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1 }}>Pague com Pix</Text>
      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text2, textAlign: "center", lineHeight: 18 }}>
        Escaneie o QR code ou copie o código no app do seu banco. Assim que o pagamento cair, a pendência some sozinha
        desta tela.
      </Text>
      <QRCode value={code} size={180} backgroundColor="transparent" color={theme.text1} />
      <Text selectable numberOfLines={3} style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, textAlign: "center" }}>
        {code}
      </Text>
      <MvButton
        label="Copiar código Pix"
        variant="outline"
        onPress={async () => {
          await Clipboard.setStringAsync(code);
          showToast("Código Pix copiado.", "success");
        }}
      />
      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>
        Válido até {expiresLabel}
      </Text>
    </View>
  );
}
