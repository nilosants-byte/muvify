/**
 * Frente 15 (segunda camada, acessibilidade), Lote 4: MvAvatar (chat,
 * seguidores, cards de profissional) nunca recebia nem gerava
 * accessibilityLabel — o leitor de tela anunciava cada avatar só como
 * "imagem", indistinguível de entrada pra entrada numa lista. Sem label,
 * o avatar agora vira decorativo (accessible=false) em vez de "imagem"
 * muda focável — correto quando o nome já aparece como texto ao lado.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { MvAvatar } from "../components/mv/MvAvatar";

describe("Frente 15, Lote 4 — MvAvatar expõe (ou esconde corretamente) accessibilityLabel", () => {
  it("com accessibilityLabel: fica acessível e anunciável pelo leitor de tela (fallback de iniciais, sem foto)", () => {
    const { getByLabelText } = render(<MvAvatar initials="JD" accessibilityLabel="Foto de João Dias" />);
    expect(getByLabelText("Foto de João Dias")).toBeTruthy();
  });

  it("sem accessibilityLabel: vira decorativo (accessible=false), não polui a leitura com 'imagem' genérico", () => {
    const { queryByLabelText, UNSAFE_root } = render(<MvAvatar initials="JD" />);
    expect(queryByLabelText(/./)).toBeNull();
    // O nó raiz do fallback de iniciais deve estar marcado accessible=false.
    const gradientNode = UNSAFE_root.findAllByProps({ accessible: false });
    expect(gradientNode.length).toBeGreaterThan(0);
  });
});
