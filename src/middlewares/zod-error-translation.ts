import { ZodIssue, ZodIssueCode } from "zod";

// Frente 10 (segunda camada), Lote 2: error.middleware.ts sempre montava a
// mensagem de erro de validação usando error.flatten().fieldErrors, cujas
// chaves de topo são sempre "body"/"params"/"query" (o objeto que o
// validate() realmente passa pro Zod) - nunca o campo de verdade
// (ex: "priceCents"). E a maioria dos validators não tem mensagem
// customizada, então o texto que sobrava era a mensagem padrão do Zod, em
// inglês (ex: "Number must be greater than or equal to 100"), vazando pro
// usuário final em dezenas de formulários.
//
// Esta função resolve os dois problemas: usa o path completo do issue (não
// só a chave de topo) e reconhece quando a mensagem é a mensagem PADRÃO do
// Zod (comparando com o que o mapa de erro em inglês do Zod geraria pra
// aquele issue) pra traduzir - mensagens customizadas (escritas por nós,
// já em português) nunca são tocadas.

function fieldLabel(issue: ZodIssue): string {
  // path[0] é sempre "body"/"params"/"query" (ver validate.middleware.ts) -
  // não é o campo de verdade, então é descartado daqui.
  const rest = issue.path.slice(1);
  if (rest.length === 0) return "dados enviados";
  return rest.join(".");
}

// Reimplementação mínima do mapa de erro em inglês default do Zod (só os
// códigos realmente usados pelos validators deste projeto), pra conseguir
// comparar e detectar "essa é a mensagem padrão, nunca foi customizada".
function defaultEnglishZodMessage(issue: ZodIssue): string | null {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return issue.received === "undefined" ? "Required" : `Expected ${issue.expected}, received ${issue.received}`;
    case ZodIssueCode.invalid_literal:
      return `Invalid literal value, expected ${JSON.stringify(issue.expected)}`;
    case ZodIssueCode.invalid_enum_value:
      return `Invalid enum value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}, received '${issue.received}'`;
    case ZodIssueCode.invalid_date:
      return "Invalid date";
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "string" && issue.validation !== "regex") {
        return `Invalid ${issue.validation}`;
      }
      return null;
    case ZodIssueCode.too_small: {
      const { type, minimum, exact, inclusive } = issue;
      if (type === "array") return `Array must contain ${exact ? "exactly" : inclusive ? "at least" : "more than"} ${minimum} element(s)`;
      if (type === "string") return `String must contain ${exact ? "exactly" : inclusive ? "at least" : "over"} ${minimum} character(s)`;
      if (type === "number" || type === "bigint") return `Number must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${minimum}`;
      return null;
    }
    case ZodIssueCode.too_big: {
      const { type, maximum, exact, inclusive } = issue;
      if (type === "array") return `Array must contain ${exact ? "exactly" : inclusive ? "at most" : "less than"} ${maximum} element(s)`;
      if (type === "string") return `String must contain ${exact ? "exactly" : inclusive ? "at most" : "under"} ${maximum} character(s)`;
      if (type === "number" || type === "bigint") return `Number must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${maximum}`;
      return null;
    }
    case ZodIssueCode.not_multiple_of:
      return `Number must be a multiple of ${issue.multipleOf}`;
    case ZodIssueCode.not_finite:
      return "Number must be finite";
    case ZodIssueCode.custom:
      return "Invalid input";
    default:
      return null;
  }
}

// Tradução pt-BR pros mesmos casos cobertos acima, usando os mesmos dados
// estruturados do issue (nunca reconstrói a partir do texto em inglês).
function translateDefaultMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return issue.received === "undefined" ? "Campo obrigatório." : `Tipo inválido (esperado ${issue.expected}).`;
    case ZodIssueCode.invalid_literal:
      return "Valor inválido.";
    case ZodIssueCode.invalid_enum_value:
      return `Valor inválido. Opções aceitas: ${issue.options.join(", ")}.`;
    case ZodIssueCode.invalid_date:
      return "Data inválida.";
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "string") {
        if (issue.validation === "uuid") return "Identificador inválido.";
        if (issue.validation === "email") return "E-mail inválido.";
        if (issue.validation === "url") return "Link inválido.";
        if (issue.validation === "datetime") return "Data/hora inválida.";
        return "Formato inválido.";
      }
      return "Formato inválido.";
    case ZodIssueCode.too_small: {
      const { type, minimum, exact, inclusive } = issue;
      const cmp = exact ? "igual a" : inclusive ? "maior ou igual a" : "maior que";
      if (type === "array") return `Selecione ${cmp} ${minimum} item(ns).`;
      if (type === "string") return `Deve ter ${cmp} ${minimum} caractere(s).`;
      if (type === "number" || type === "bigint") return `Deve ser ${cmp} ${minimum}.`;
      return "Valor muito pequeno.";
    }
    case ZodIssueCode.too_big: {
      const { type, maximum, exact, inclusive } = issue;
      const cmp = exact ? "igual a" : inclusive ? "menor ou igual a" : "menor que";
      if (type === "array") return `Selecione ${cmp} ${maximum} item(ns).`;
      if (type === "string") return `Deve ter ${cmp} ${maximum} caractere(s).`;
      if (type === "number" || type === "bigint") return `Deve ser ${cmp} ${maximum}.`;
      return "Valor muito grande.";
    }
    case ZodIssueCode.not_multiple_of:
      return `Deve ser múltiplo de ${issue.multipleOf}.`;
    case ZodIssueCode.not_finite:
      return "Número inválido.";
    case ZodIssueCode.custom:
      return "Valor inválido.";
    default:
      return "Valor inválido.";
  }
}

export function translateZodIssue(issue: ZodIssue): { field: string; message: string } {
  const isDefaultMessage = defaultEnglishZodMessage(issue) === issue.message;
  const message = isDefaultMessage ? translateDefaultMessage(issue) : issue.message;
  return { field: fieldLabel(issue), message };
}
