import {
  applyRealtime,
  confirmSent,
  makeSendingMessage,
  markFailed,
  markSending,
  mergeServerList,
} from "../utils/chatOptimistic";

// Teste manual C9.1 (21/10/2026): mensagem aparece na hora (relógio →
// 1 check → 2 checks) e nunca duplica, venha a confirmação pela resposta do
// envio ou pelo socket, em qualquer ordem.
const me = "me";
const server = (id: string, content: string, senderId = me) => ({
  id,
  senderId,
  content,
  readAt: null,
  createdAt: new Date().toISOString(),
});

describe("chat otimista", () => {
  it("resposta do envio troca a bolha local pela mensagem do servidor", () => {
    const local = makeSendingMessage(me, "oi");
    expect(local.localStatus).toBe("sending");
    const after = confirmSent([local], local.id, server("s1", "oi"));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("s1");
    expect(after[0].localStatus).toBeUndefined();
  });

  it("socket chega antes da resposta do envio: não duplica (bug do C9.1)", () => {
    const local = makeSendingMessage(me, "oi");
    const viaSocket = applyRealtime([local], server("s1", "oi"), me);
    expect(viaSocket.map((m) => m.id)).toEqual(["s1"]);
    const viaResponse = confirmSent(viaSocket, local.id, server("s1", "oi"));
    expect(viaResponse.map((m) => m.id)).toEqual(["s1"]);
  });

  it("resposta do envio chega antes do socket: não duplica", () => {
    const local = makeSendingMessage(me, "oi");
    const viaResponse = confirmSent([local], local.id, server("s1", "oi"));
    const viaSocket = applyRealtime(viaResponse, server("s1", "oi"), me);
    expect(viaSocket.map((m) => m.id)).toEqual(["s1"]);
  });

  it("várias mensagens seguidas mantêm a ordem", () => {
    const a = makeSendingMessage(me, "a");
    const b = makeSendingMessage(me, "b");
    let list = [a, b];
    list = confirmSent(list, b.id, server("sb", "b"));
    list = confirmSent(list, a.id, server("sa", "a"));
    expect(list.map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("falha marca a bolha, e tentar de novo volta pra enviando", () => {
    const local = makeSendingMessage(me, "oi");
    const failed = markFailed([local], local.id);
    expect(failed[0].localStatus).toBe("failed");
    expect(markSending(failed, local.id)[0].localStatus).toBe("sending");
  });

  it("recarga do servidor mantém bolha que falhou e some com a que já chegou", () => {
    const sending = makeSendingMessage(me, "chegou");
    const failed = { ...makeSendingMessage(me, "falhou"), localStatus: "failed" as const };
    const merged = mergeServerList(
      [server("old", "antiga", "other"), sending, failed],
      [server("old", "antiga", "other"), server("s1", "chegou")],
      me
    );
    expect(merged.map((m) => m.content)).toEqual(["antiga", "chegou", "falhou"]);
  });

  it("mensagem do outro pelo socket entra no fim", () => {
    const list = applyRealtime([server("s1", "oi")], server("s2", "e aí", "other"), me);
    expect(list.map((m) => m.id)).toEqual(["s1", "s2"]);
  });
});
