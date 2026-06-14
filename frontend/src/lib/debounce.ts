/**
 * Debounce simple y cancelable. Colapsa ráfagas de llamadas en una sola tras
 * `ms` de inactividad. Útil para no re-fetchear N veces cuando llegan varios
 * eventos SSE seguidos (p. ej. pay_order borra varias notificaciones de una
 * orden → varios eventos casi simultáneos → un único reload).
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
