import React from "react";
import { Alert } from "react-native";

// TEMPORÁRIO (teste manual C9.1, 21/10/2026): aviso "Each child in a list
// should have a unique key" aparece ao abrir a tela de conversas, mas a tela
// em si foi descartada como origem (testada com os dados reais). Só no modo
// desenvolvimento: mostra QUAL componente gerou o aviso. Remover depois.
export function installKeyWarningDetector() {
  if (!__DEV__) return;
  const original = console.error;
  let shown = false;
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (!shown && (first.includes('unique "key"') || first.includes("same key"))) {
      shown = true;
      const owner = (React as unknown as { captureOwnerStack?: () => string | null }).captureOwnerStack?.() ?? "";
      const extra = args.slice(1).map(String).join(" ");
      const where = `${owner}\n${extra}`.replace(/\(.*?\)/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 14).join("\n");
      setTimeout(() => Alert.alert("Detector de key (tira print)", where || "(sem pilha)"), 300);
    }
    original(...args);
  };
}
