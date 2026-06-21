# Lições aprendidas — Calendário do Casa em Dia

Mesma regra da skill principal: cada lição aqui precisa de um item correspondente no checklist de SKILL.md.

## #1 — 21/06/2026 — Verificação preventiva ao construir o calendário (não foi bug, mas quase virou um)
**O que foi checado, antes de qualquer usuário reportar problema:**
1. Algoritmo de cálculo da Páscoa (base de todos os feriados móveis) — testado contra 2024-2027, bateu com as datas reais (Páscoa 2026 = 5 de abril).
2. Risco de deslocamento de fuso horário nos eventos — testado criando e lendo um evento real via API: escreveu "09:00:00" sem fuso, voltou exatamente "09:00:00+00:00", sem deslocamento. Não é bug hoje, porque o app sempre lê a data/hora como string (`.slice(...)`), nunca via `new Date().toLocaleString()`. **Mas é um risco real se alguém trocar essa parte do código no futuro** — daí o item 2 do checklist existir como vigilância permanente, não como "resolvido e esquecido".

**Por que registrar isso mesmo sem ter quebrado:** o usuário pediu explicitamente "crie uma redundância para sempre aprender e fazer verificação de erros ou bugs" — ou seja, a skill deve verificar proativamente, não só reagir depois que algo já quebrou pro usuário. Essa entrada existe pra deixar registrado o que já foi validado e por quê, evitando reinvestigar do zero a cada verificação futura.
