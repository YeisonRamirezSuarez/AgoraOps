import { Hammer } from "lucide-react";

/** Submódulo presente en el menú (paridad Polaris Food) pendiente de fase. */
export function EnConstruccion({ titulo, nota }: { titulo: string; nota?: string }) {
  return (
    <div className="glass grid place-items-center rounded-2xl py-16 text-center">
      <Hammer size={36} className="mb-3 text-accent-amber opacity-70" />
      <p className="font-medium">{titulo}</p>
      <p className="mt-1 max-w-md text-sm text-text-muted">
        {nota ?? "Este submódulo está en construcción — siguiente en el roadmap del plan."}
      </p>
    </div>
  );
}
