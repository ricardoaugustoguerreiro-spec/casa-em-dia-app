# Product

## Register

product

## Users

Duas pessoas: Ricardo e Jéssica, um casal. Não são usuários corporativos e não estão em jornada
de descoberta — são donos do próprio dinheiro tentando não perder o fio.

- **Contexto**: uso curto e frequente, quase sempre no celular, muitas vezes em pé (fila do
  mercado, antes de dormir, no caminho). Sessões longas no PC são exceção, não regra.
- **Job to be done**: saber o que já foi pago, o que ainda vence, quanto sobra — e registrar um
  gasto ou uma entrada em segundos, sem abrir planilha.
- **Consequência de design**: cada tela precisa responder em um olhar e num polegar. Informação
  que exige zoom, hover ou conta de cabeça é informação perdida.

## Product Purpose

PWA (HTML/CSS/JS puro + Supabase, hospedado no GitHub Pages) que junta em um lugar só o
financeiro do casal e o calendário compartilhado:

- contas fixas e faturas de cartão, com data de vencimento e estado de pagamento;
- compras parceladas e quando cada uma acaba;
- lançamentos do dia a dia e entradas de renda (inclusive a renda das joias, sincronizada);
- calendário com compromissos das duas pessoas e os vencimentos do mês na mesma grade.

**Sucesso** é abrir o app e, em menos de dez segundos, saber o que vence essa semana e quanto
falta. E fechar o mês sem susto — nada vencido por esquecimento, nada lançado duas vezes.

## Brand Personality

**Casa arrumada.** O app é a gaveta organizada da casa, não o extrato do banco.

- **Voz**: direta e concreta. "Vence quinta, R$ 850" no lugar de "há pendências no período".
- **Tom**: calmo. Dinheiro já é assunto tenso; a interface não aumenta a temperatura. Vermelho
  é reservado para o que está de fato atrasado — se tudo grita, nada é urgente.
- **Emoção-alvo**: controle e tranquilidade. Abrir e sentir que está tudo no lugar.
- **Marca**: coral `#DC6B4F` (a cor do ícone do app) sobre superfície neutra clara. O coral
  marca ação e o item em foco — nunca decora o fundo inteiro.

> **Restrição (19/Ago/2026).** O coral da identidade e o ícone do app são para manter. Trabalho
> de design acontece em hierarquia, contraste, espaçamento, estado, tipografia e cópia. O que
> sai é o uso errado da cor (degradê de fundo, paleta de dez matizes sem sistema), não a
> identidade.

## Anti-references

- **Degradê pastel de fundo.** O fundo laranja-para-rosa que o app tem hoje é o visual padrão de
  app gerado por IA. Fundo é superfície neutra; cor é sinal.
- **Arco-íris sem sistema.** Rosa, violeta, azul, verde-água, âmbar e vermelho na mesma tela sem
  regra. Cada cor precisa significar uma coisa só.
- **Texto cinza-claro "elegante".** Cinza fraco em cima de branco é a falha mais cara do app hoje
  e some no celular ao sol.
- **Planilha do Excel.** Grade de linhas iguais onde tudo pesa o mesmo e nada guia o olho.
- **App de banco.** Frio, genérico, cheio de jargão e de aviso que não diz o que fazer.

## Design Principles

1. **Responde antes de detalhar.** A primeira linha de cada tela é a resposta ("faltam R$ 850
   esse mês"); o detalhe vem depois, não antes.
2. **Cor é sinal, não enfeite.** Coral = ação e foco. Verde = pago. Âmbar = vence em breve.
   Vermelho = atrasado, e só isso. Fundo e superfície são neutros.
3. **Número no lugar de adjetivo.** Valor, data e quantidade concretos vencem rótulo vago.
4. **O polegar decide.** Alvo de toque ≥ 44px, nada cortado, nenhuma função escondida em hover.
   Se funciona no celular, funciona em tudo.
5. **Calma é função.** Uma tela sem alarme quando não há alarme é informação — o silêncio
   também comunica.

## Accessibility & Inclusion

Alvo: **WCAG 2.1 AA**.

- **Contraste**: corpo de texto ≥ 4.5:1 contra a superfície real. Texto secundário no mínimo
  `#55606E` (6.4:1 no branco); nada mais claro que isso como cor de leitura. Cinza claro só
  para elemento decorativo ou desabilitado, nunca para texto que se lê.
- **Toque**: alvos ≥ 44px, inclusive as abas, as setas de mês e os botões dentro das listas.
- **Teclado**: foco sempre visível; Esc fecha modal; formulário submete no Enter.
- **Movimento**: `prefers-reduced-motion: reduce` obrigatório em qualquer animação.
- **Cor nunca sozinha**: estado (pago / vence / atrasado) sempre acompanhado de texto ou ícone,
  não só do matiz.
