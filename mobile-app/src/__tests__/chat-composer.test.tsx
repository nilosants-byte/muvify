import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ChatComposer } from "../screens/client/ClientChatListScreen";
import { ProfessionalChatComposer } from "../screens/professional/ProfessionalChatListScreen";
import { darkTheme } from "../theme/MvColors";

// Frente 11 (engenharia mobile), Lote 7: o composer (campo de texto + botão
// de enviar) foi extraído pra um componente próprio com estado local —
// antes, inputText vivia no mesmo componente que a lista de mensagens, e
// cada tecla digitada re-renderizava a tela inteira (recriando renderItem e
// redesenhando todas as bolhas visíveis do FlatList). Estes testes cobrem o
// comportamento do composer isoladamente, sem montar a tela de chat inteira
// (que depende de socket, useAuthQuery, useAppState etc.).

describe("Frente 11, Lote 7 — ChatComposer (cliente)", () => {
  it("envia o texto (aparado) e limpa o campo em caso de sucesso", async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Escreva para seu personal...");
    fireEvent.changeText(input, "  Olá, tudo bem?  ");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Olá, tudo bem?"));
    await waitFor(() => expect(input.props.value).toBe(""));
  });

  it("em caso de falha, restaura o texto no campo em vez de perdê-lo", async () => {
    const onSend = jest.fn().mockResolvedValue(false);
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Escreva para seu personal...");
    fireEvent.changeText(input, "mensagem importante");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("mensagem importante"));
    await waitFor(() => expect(input.props.value).toBe("mensagem importante"));
  });

  it("não envia texto vazio nem só com espaços", () => {
    const onSend = jest.fn();
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Escreva para seu personal...");
    fireEvent.changeText(input, "   ");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("digitar não chama onSend — só o toque no botão de enviar dispara o envio", () => {
    const onSend = jest.fn();
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    fireEvent.changeText(ui.getByPlaceholderText("Escreva para seu personal..."), "abc");
    fireEvent.changeText(ui.getByPlaceholderText("Escreva para seu personal..."), "abcdef");

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("Frente 11, Lote 7 — ProfessionalChatComposer", () => {
  it("envia o texto (aparado) e limpa o campo em caso de sucesso", async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    const ui = render(<ProfessionalChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Mensagem para o aluno...");
    fireEvent.changeText(input, "  Como foi o treino?  ");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Como foi o treino?"));
    await waitFor(() => expect(input.props.value).toBe(""));
  });

  it("em caso de falha, restaura o texto no campo", async () => {
    const onSend = jest.fn().mockResolvedValue(false);
    const ui = render(<ProfessionalChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Mensagem para o aluno...");
    fireEvent.changeText(input, "não pode sumir");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("não pode sumir"));
    await waitFor(() => expect(input.props.value).toBe("não pode sumir"));
  });

  it("desabilita o campo enquanto o envio está em andamento", async () => {
    let resolveSend: (ok: boolean) => void = () => {};
    const onSend = jest.fn(
      () => new Promise<boolean>((resolve) => { resolveSend = resolve; })
    );
    const ui = render(<ProfessionalChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Mensagem para o aluno...");
    fireEvent.changeText(input, "aguardando resposta");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(ui.getByPlaceholderText("Enviando...")).toBeTruthy());

    await act(async () => {
      resolveSend(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(ui.getByPlaceholderText("Mensagem para o aluno...")).toBeTruthy());
  });
});
