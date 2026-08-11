export function spotlightVars(x: number, y: number): Record<string, string> {
  return { "--mx": `${Math.round(x)}px`, "--my": `${Math.round(y)}px` };
}
