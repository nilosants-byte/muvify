import { queryKeys } from "../lib/queryKeys";

// Regras que valem pra todas as chaves de cache. Duas delas já viraram bug real:
// chaves iguais pra telas com formatos diferentes (2026-10-08, C9.1, C13.1) e
// "invalidar o grupo" sem alcançar uma tela, que ficava com dado velho.

type Factory = (...args: unknown[]) => readonly unknown[];
type Group = Record<string, unknown> & { all: readonly unknown[] };

const groups = Object.entries(queryKeys) as unknown as Array<[string, Group]>;

const factories = groups.flatMap(([groupName, group]) =>
  Object.entries(group)
    .filter(([, value]) => typeof value === "function")
    .map(([name, fn]) => ({ groupName, name, fn: fn as Factory, label: `${groupName}.${name}` }))
);

const SAMPLE_ARGS = ["arg-1", "arg-2", "arg-3"];
const OTHER_ARGS = ["outro-1", "outro-2", "outro-3"];

describe("estrutura das chaves de cache (queryKeys)", () => {
  it("encontra os grupos e as chaves", () => {
    expect(groups.length).toBeGreaterThan(10);
    expect(factories.length).toBeGreaterThan(80);
  });

  it.each(groups)("grupo %s tem 'all' igual ao próprio nome", (groupName, group) => {
    expect(group.all).toEqual([groupName]);
  });

  it.each(factories)("$label começa com a chave 'all' do grupo (invalidar o grupo a alcança)", ({ groupName, fn }) => {
    const key = fn(...SAMPLE_ARGS);
    expect(Array.isArray(key)).toBe(true);
    expect(key[0]).toBe(groupName);
  });

  it("nenhuma chave gera o mesmo valor que outra", () => {
    const seen = new Map<string, string>();
    for (const { label, fn } of factories) {
      const serialized = JSON.stringify(fn(...SAMPLE_ARGS));
      expect(seen.get(serialized) ?? label).toBe(label);
      seen.set(serialized, label);
    }
  });

  it.each(factories.filter(({ fn }) => fn.length > 0))(
    "$label muda quando o parâmetro muda (cache separado por contexto)",
    ({ fn }) => {
      expect(fn(...SAMPLE_ARGS)).not.toEqual(fn(...OTHER_ARGS));
    }
  );
});
