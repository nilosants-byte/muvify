// Frente 13 (segunda camada), Lote 17: EXPO_PUBLIC_GOOGLE_PLACES_KEY é lida
// como constante de módulo (avaliada uma única vez, no import) dentro de
// useGooglePlacesSearch.ts — precisa estar setada ANTES desse import
// acontecer. Import statements preservam a ordem relativa entre si mesmos
// (mesmo hoisted como bloco acima do resto do arquivo), então este arquivo
// só funciona se for literalmente o PRIMEIRO import do arquivo de teste
// que usa useGooglePlacesSearch/fetchGooglePlaceCoords.
if (!process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY) {
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY = "fake-google-places-key-for-tests";
}
