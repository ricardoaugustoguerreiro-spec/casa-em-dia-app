---
name: Casa em Dia
description: App financeiro e calendário de um casal — superfície neutra clara, coral como único sinal de ação, vermelho reservado para atraso real.
colors:
  brand-coral: "#DC6B4F"
  brand-action: "#B94E33"
  brand-ink: "#A8442C"
  brand-tint: "#FDF0EC"
  bg: "#F5F6F8"
  surface: "#FFFFFF"
  surface-sunken: "#EEF0F3"
  ink: "#1B2430"
  ink-2: "#55606E"
  ink-3: "#97A1AE"
  border: "#E2E6EB"
  border-strong: "#CBD2DA"
  paid: "#0F7A57"
  paid-bg: "#E8F5EF"
  due: "#8A5A00"
  due-bg: "#FCF2E0"
  late: "#B3271E"
  late-bg: "#FCEBE9"
typography:
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  numeric: "ui-monospace, 'SF Mono', 'Roboto Mono', monospace"
---

# Casa em Dia — sistema visual

## Tema

Claro. O app é aberto de manhã, no ônibus, no mercado, na cozinha — quase sempre com luz
ambiente forte e a tela do celular no automático. Tema escuro perderia legibilidade justamente
onde ele mais é usado.

**Estratégia de cor: restrained.** Superfície neutra em ~90% da tela; o coral aparece em ação
primária, item selecionado e identidade. Cor saturada em área grande é o que o produto recusa.

## Paleta e papéis

| Token | Valor | Papel | Contraste |
|---|---|---|---|
| `--bg` | `#F5F6F8` | fundo da página (sem degradê) | — |
| `--surface` | `#FFFFFF` | cartão, modal, linha de lista | — |
| `--surface-sunken` | `#EEF0F3` | campo de entrada, trilho de aba, área rebaixada | — |
| `--ink` | `#1B2430` | título, valor, texto principal | 15.6:1 no branco |
| `--ink-2` | `#55606E` | texto secundário, rótulo, data | 6.4:1 no branco · 5.9:1 no bg |
| `--ink-3` | `#97A1AE` | ícone decorativo, separador, desabilitado — **nunca texto de leitura** | — |
| `--brand-coral` | `#DC6B4F` | identidade, aro de foco, item selecionado | 3.4:1 — não usar como texto |
| `--brand-action` | `#B94E33` | fundo de botão primário (texto branco) | 5.0:1 |
| `--brand-ink` | `#A8442C` | coral como texto/link em fundo claro | 6.0:1 |
| `--paid` | `#0F7A57` | pago, recebido, concluído | 5.3:1 |
| `--due` | `#8A5A00` | vence em até 5 dias | 5.9:1 |
| `--late` | `#B3271E` | **só** atraso real | 6.5:1 |

Regras não negociáveis:

1. Fundo da página nunca é degradê e nunca é colorido.
2. Vermelho não é usado para "atenção" genérica — só para vencido.
3. Estado nunca depende só da cor: sempre acompanha texto ("Pago 07/08") ou ícone.
4. Nenhum matiz fora desta tabela. Rosa, violeta, azul e verde-água saem.

## Tipografia

Uma família só (a fonte do próprio sistema: `system-ui`, `-apple-system`, `Segoe UI`, `Roboto`),
em pesos variados. **Decisão consciente, não descuido:** é um app de consulta rápida no celular,
aberto dezenas de vezes por dia. Fonte de fora custa carregamento e pisca na primeira abertura;
a fonte do sistema aparece instantânea e já é a letra que a pessoa lê o dia inteiro no aparelho.
A hierarquia vem de tamanho, peso e cor — não de um segundo tipo.

| Papel | Tamanho | Peso | Cor |
|---|---|---|---|
| Título de tela | `clamp(1.25rem, 4vw, 1.5rem)` | 700 | `--ink` |
| Título de cartão | `0.875rem` | 600 | `--ink` |
| Valor em destaque | `1.5rem`, `font-variant-numeric: tabular-nums` | 650 | `--ink` |
| Corpo / item de lista | `0.9375rem` | 500 | `--ink` |
| Apoio (data, rótulo) | `0.8125rem` | 500 | `--ink-2` |

Dinheiro e data usam `tabular-nums` — coluna de valor tem que alinhar na vírgula.
Nada de texto de leitura abaixo de `0.8125rem`.

## Forma e espaço

- **Raio**: `--r-sm 10px` (chip, badge) · `--r-md 14px` (campo, botão) · `--r-lg 18px` (cartão,
  modal) · `--r-pill 999px` (aba, seletor). Quatro degraus, sem exceção.
- **Escala de espaço**: 4 · 8 · 12 · 16 · 24 · 32 · 48. Densidade maior dentro da lista,
  respiro maior entre blocos.
- **Elevação**: um degrau só — `0 1px 2px rgba(27,36,48,.06), 0 1px 8px rgba(27,36,48,.04)`.
  Modal ganha um segundo degrau. Cartão dentro de cartão não existe.
- **Borda**: `1px solid var(--border)`. Faixa colorida na lateral do cartão é proibida.

## Componentes

- **Aba (Painel / Financeiro / Calendário / Ajustes)**: trilho `--surface-sunken`, pílula ativa
  branca com sombra de 1 degrau e texto `--ink`; inativa `--ink-2`. Altura mínima 44px.
- **Linha de conta**: nome (`--ink`) + data de vencimento (`--ink-2`) à esquerda, valor à
  direita em `tabular-nums`, e um chip de estado. Separador `--border`, nunca cartão por item.
- **Chip de estado**: `Pago` (paid), `Vence em 3 dias` (due), `Atrasado 4 dias` (late),
  `Pendente` (neutro `--surface-sunken` + `--ink-2`). Texto sempre presente.
- **Botão primário**: fundo `--brand-action`, texto branco, raio `--r-md`, altura 44px.
- **Botão secundário**: fundo `--surface`, borda `--border-strong`, texto `--ink`.
- **Campo**: fundo `--surface-sunken`, borda `--border`, `font-size: 16px` no celular (abaixo
  disso o iOS dá zoom), foco com aro coral de 2px e deslocamento de 2px.
- **Estado vazio**: uma frase concreta do que fazer, não emoji sozinho.

## Movimento

Curto e discreto: 120–180ms, `cubic-bezier(.22,1,.36,1)`. Trocar de aba, abrir modal e mudar
estado de pagamento têm transição; o resto não. Sem bounce, sem entrada em cascata.
`prefers-reduced-motion: reduce` corta tudo para troca instantânea.

## Fora do padrão (dívida conhecida em 19/Ago/2026)

- Fundo em degradê `from-orange-50 to-rose-50`.
- 49 ocorrências de `text-gray-400` como texto de leitura (2.5:1 — reprova).
- Onze matizes Tailwind em uso sem papel definido.
- Cinco raios diferentes misturados na mesma tela.
- Emoji como ícone de seção em todos os cartões.
