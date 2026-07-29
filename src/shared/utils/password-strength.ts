// Raio-X Muvify, Frente 2 (Segurança do código), Lote 2: a validação de
// senha exigia só min(8) + letra+dígito — "senha123"/"abcd1234" passavam.
// Lista curta das senhas mais comuns em vazamentos reais (inglês + as
// variações em português mais óbvias para um público brasileiro), usada
// pra recusar o caso mais básico de senha fraca (OWASP ASVS 2.1.7). Não é
// uma defesa completa contra dicionário — é o piso mínimo que qualquer
// checagem de senha comum deveria cobrir.
const COMMON_PASSWORDS = new Set(
  [
    "12345678",
    "123456789",
    "1234567890",
    "password",
    "password1",
    "password123",
    "qwerty123",
    "qwertyuiop",
    "letmein123",
    "welcome123",
    "admin1234",
    "iloveyou1",
    "sunshine1",
    "princess1",
    "football1",
    "baseball1",
    "monkey123",
    "dragon123",
    "trustno1a",
    "abcd12345",
    "abcdefgh1",
    "a1b2c3d4e5",
    "senha1234",
    "senha123456",
    "brasil123",
    "brasil1234",
    "12345senha",
    "mudar123456",
    "trocaresta",
    "eusamzam123",
    "unbrasil1",
    "flamengo123",
    "vasco12345",
    "corinthians1",
    "palmeiras1",
    "amoretebem1",
    "teamoeu123",
    "cachorro123",
    "gatinho123",
    "12341234a",
    "11111111a",
    "00000000a",
    "aaaaaaaaa1"
  ].map((value) => value.toLowerCase())
);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}
