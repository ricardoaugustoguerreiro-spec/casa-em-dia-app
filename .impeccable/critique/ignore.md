# Achados que o detector aponta e que aqui são decisão, não descuido

- **gray-on-color (5 ocorrências)**: falso positivo. O detector lê a expressão
  `:class` inteira do Alpine e cruza classes de ramos diferentes do ternário —
  `text-gray-500` pertence ao ramo "pago" e `bg-green-50` ao ramo "a pagar";
  as duas nunca se encontram na mesma tela. Contraste medido no navegador nas
  7 telas: 0 reprovação.

- **single-font / design-system-font (Roboto)**: decisão registrada no
  DESIGN.md. App de consulta rápida no celular usa a fonte do próprio aparelho
  para abrir instantâneo, sem piscar. Hierarquia vem de tamanho, peso e cor.

- **design-system-color #B94E33**: é o `brand-action` declarado no DESIGN.md.
  O detector compara o literal em caixa diferente da tabela.

- **em-dash-overuse**: o travessão é pontuação normal em português e os textos
  do app são curtos. Mantido.
