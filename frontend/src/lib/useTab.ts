import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Sincroniza la pestaña activa de una página con ?tab= en la URL, para
 * que los submenús del sidebar puedan abrir una pestaña específica.
 */
export function useTabParam(tabs: string[]): [string, (t: string) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("tab");
  const initial = fromUrl && tabs.includes(fromUrl) ? fromUrl : tabs[0];
  const [active, setActive] = useState(initial);

  // Si el usuario navega por el sidebar a otra pestaña de la misma página
  useEffect(() => {
    if (fromUrl && tabs.includes(fromUrl) && fromUrl !== active) {
      setActive(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  function change(tab: string) {
    setActive(tab);
    setParams({ tab }, { replace: true });
  }

  return [active, change];
}
