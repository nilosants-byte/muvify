/**
 * Seed dos exercícios pré-montados da plataforma Muvify (isPrebuilt = true).
 * Execute com: npx ts-node scripts/seed-exercises.ts
 * (ou: npx tsx scripts/seed-exercises.ts)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MUVIFY_EXERCISES: Array<{ name: string; category: string; description?: string }> = [
  // Peitoral
  { name: "Supino reto com barra", category: "Peitoral", description: "Exercício composto fundamental para desenvolvimento do peitoral." },
  { name: "Supino inclinado com halteres", category: "Peitoral", description: "Foco na porção superior do peitoral." },
  { name: "Supino declinado", category: "Peitoral", description: "Ativação da porção inferior do peitoral." },
  { name: "Crossover no cabo", category: "Peitoral", description: "Exercício de isolamento para definição peitoral." },
  { name: "Flexão de braços", category: "Peitoral", description: "Exercício funcional sem equipamento para peitoral e tríceps." },
  { name: "Peck deck", category: "Peitoral", description: "Máquina de isolamento para o peitoral." },
  { name: "Pullover com haltere", category: "Peitoral", description: "Expansão de caixa torácica e ativação de peitoral e dorsal." },

  // Ombros
  { name: "Desenvolvimento militar com barra", category: "Ombros", description: "Exercício composto para deltoides." },
  { name: "Desenvolvimento com halteres", category: "Ombros", description: "Desenvolvimento de deltoides com amplitude maior." },
  { name: "Elevação lateral", category: "Ombros", description: "Isolamento do deltoide medial." },
  { name: "Elevação frontal", category: "Ombros", description: "Isolamento do deltoide anterior." },
  { name: "Arnold press", category: "Ombros", description: "Variação do desenvolvimento com rotação extra." },
  { name: "Encolhimento de ombros", category: "Ombros", description: "Exercício para o trapézio superior." },

  // Tríceps
  { name: "Tríceps corda no cabo", category: "Tríceps", description: "Isolamento do tríceps com corda." },
  { name: "Tríceps testa", category: "Tríceps", description: "Tríceps francês deitado na barra." },
  { name: "Tríceps mergulho", category: "Tríceps", description: "Exercício funcional com peso corporal para tríceps." },
  { name: "Kickback com haltere", category: "Tríceps", description: "Extensão do tríceps com haltere." },
  { name: "Extensão de tríceps acima da cabeça", category: "Tríceps", description: "Cabeça longa do tríceps em ênfase." },

  // Bíceps
  { name: "Rosca direta com barra", category: "Bíceps", description: "Exercício base para hipertrofia do bíceps." },
  { name: "Rosca alternada com halteres", category: "Bíceps", description: "Trabalho unilateral para desenvolvimento do bíceps." },
  { name: "Rosca concentrada", category: "Bíceps", description: "Isolamento máximo do bíceps." },
  { name: "Rosca martelo", category: "Bíceps", description: "Ativa bíceps e braquiorradial." },
  { name: "Rosca Scott", category: "Bíceps", description: "Elimina trapaças e foca no bíceps." },

  // Dorsal
  { name: "Puxada frontal na polia", category: "Dorsal", description: "Exercício fundamental para largura dorsal." },
  { name: "Remada curvada com barra", category: "Dorsal", description: "Espessura e força dorsal." },
  { name: "Remada unilateral com haltere", category: "Dorsal", description: "Trabalho unilateral para simetria dorsal." },
  { name: "Pull-up / Barra fixa", category: "Dorsal", description: "Exercício de força corporal total com foco no dorsal." },
  { name: "Levantamento terra", category: "Dorsal", description: "Exercício composto rei para dorsal e lombar." },
  { name: "Remada cavalinho", category: "Dorsal", description: "Máquina de remada para espessura dorsal." },
  { name: "Serrote com haltere", category: "Dorsal", description: "Remada unilateral em apoio." },

  // Posterior
  { name: "Cadeira flexora", category: "Posterior", description: "Isolamento dos isquiotibiais." },
  { name: "Stiff com barra", category: "Posterior", description: "Posterior de coxa e glúteos com ênfase na flexibilidade." },
  { name: "Mesa flexora", category: "Posterior", description: "Flexão de joelho para isquiotibiais." },
  { name: "Leg curl deitado", category: "Posterior", description: "Flexão deitada para isquiotibiais." },

  // Glúteos
  { name: "Hip thrust", category: "Glúteos", description: "Exercício principal para glúteos." },
  { name: "Agachamento sumô", category: "Glúteos", description: "Ativa glúteos e adutores com posição aberta." },
  { name: "Avanço / Passada", category: "Glúteos", description: "Exercício unilateral para glúteos e quadríceps." },
  { name: "Abdução no cabo", category: "Glúteos", description: "Isolamento do glúteo médio." },

  // Quadríceps
  { name: "Agachamento livre com barra", category: "Quadríceps", description: "Exercício rainha dos membros inferiores." },
  { name: "Leg press 45°", category: "Quadríceps", description: "Desenvolvimento de quadríceps com alta carga." },
  { name: "Cadeira extensora", category: "Quadríceps", description: "Isolamento do quadríceps." },
  { name: "Agachamento Hack", category: "Quadríceps", description: "Foco em vasto lateral e medial." },

  // Panturrilha
  { name: "Panturrilha em pé", category: "Panturrilha", description: "Desenvolvimento do gastrocnêmio." },
  { name: "Panturrilha sentado", category: "Panturrilha", description: "Foco no sóleo." },
  { name: "Panturrilha no leg press", category: "Panturrilha", description: "Amplitude máxima para panturrilha." },

  // Abdômen
  { name: "Crunch abdominal", category: "Abdômen", description: "Exercício básico para reto abdominal." },
  { name: "Prancha isométrica", category: "Abdômen", description: "Core completo e estabilização." },
  { name: "Abdominal oblíquo", category: "Abdômen", description: "Ativação das oblíquas." },
  { name: "Elevação de pernas", category: "Abdômen", description: "Porção inferior do abdômen." },
  { name: "Abdominal bicicleta", category: "Abdômen", description: "Ativa reto abdominal e oblíquas alternadamente." },
  { name: "Crunch na polia", category: "Abdômen", description: "Crunch com carga variável no cabo." },

  // Alongamento
  { name: "Alongamento de isquiotibiais em pé", category: "Alongamento" },
  { name: "Alongamento de quadríceps em pé", category: "Alongamento" },
  { name: "Alongamento de panturrilha na parede", category: "Alongamento" },
  { name: "Alongamento de peitoral com braços abertos", category: "Alongamento" },
  { name: "Alongamento de ombros cruzando o braço", category: "Alongamento" },
  { name: "Flexão lateral de tronco", category: "Alongamento" },

  // Mobilidade
  { name: "Rotação de quadril no chão", category: "Mobilidade" },
  { name: "Hip flexor lunge stretch", category: "Mobilidade" },
  { name: "Rotação torácica em quatro apoios", category: "Mobilidade" },
  { name: "World's greatest stretch", category: "Mobilidade", description: "Mobilidade total em sequência." },
  { name: "Rotação de tornozelo", category: "Mobilidade" },

  // Cardio
  { name: "Esteira — corrida contínua", category: "Cardio" },
  { name: "Bicicleta ergométrica", category: "Cardio" },
  { name: "Elíptico", category: "Cardio" },
  { name: "Pular corda", category: "Cardio", description: "Cardio funcional de alta intensidade." },
  { name: "Burpee", category: "Cardio", description: "Exercício funcional de corpo inteiro." },
  { name: "Polichinelo", category: "Cardio" },
  { name: "Mountain climber", category: "Cardio", description: "Cardio com forte ativação de core." },
  { name: "HIIT — tabulata 20/10", category: "Cardio", description: "20s esforço máximo, 10s descanso, 8 rounds." },
];

async function main() {
  console.log("🌱 Iniciando seed de exercícios Muvify...");

  let created = 0;
  let skipped = 0;

  for (const ex of MUVIFY_EXERCISES) {
    const existing = await prisma.exercise.findFirst({
      where: { name: ex.name, isPrebuilt: true }
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.exercise.create({
      data: {
        name: ex.name,
        category: ex.category,
        description: ex.description ?? null,
        isPrebuilt: true,
        providerId: null
      }
    });
    created++;
  }

  console.log(`✅ Seed concluído: ${created} criados, ${skipped} já existiam.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
