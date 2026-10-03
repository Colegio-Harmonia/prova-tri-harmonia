/**
 * Pedido direto (16/07/2026): fórmula em ASCII solto ("2^(n-1)", "3*2^(n-1)")
 * é difícil de ler pro aluno, muito diferente de livro impresso. A notação
 * LaTeX delimitada por $...$ é convertida em imagem tipografada de verdade
 * (ver src/lib/math/latexRender.ts — tela de revisão e documento final),
 * então a IA precisa marcar a fórmula nesse formato pra virar imagem.
 */
export function buildMathNotationInstruction(): string {
  return `Toda expressão matemática com expoente, fração, raiz, subscrito, somatório, ou qualquer notação que não seja texto corrido simples DEVE vir em LaTeX delimitado por $...$ — nunca em ASCII solto. Como a saída é JSON, toda barra do LaTeX deve ser escapada: escreva \\\\times, \\\\text e \\\\frac no JSON (duas barras); nunca escreva \\times, \\text ou \\frac com uma única barra, pois \t vira TAB. Exemplos: "$3 \\cdot 2^{n-1}$" (não "3*2^(n-1)" nem "3 * 2^(n-1)"), "$\\frac{a+b}{2}$" (não "(a+b)/2"), "$\\sqrt{x^2+1}$" (não "raiz(x^2+1)"). Operações simples sem elevado/fração/raiz (ex: "x + 5 = 12") podem ficar em texto normal, sem $...$. Fórmula molecular, íons e notação química ficam INTEIROS em um único $...$ — "$C_4H_8O$", "$H_2SO_4$", "$SO_4^{2-}$" — NUNCA cerque só o subscrito: "C$_4$H$_8$O" está errado e renderiza um subscrito solto. Use em statement, supportText e em cada alternativa que precisar.`
}
