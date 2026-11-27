import type { Toast } from "@/lib/messages";

export interface ToastItem extends Toast {
  id: number;
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="who">{t.title}</span>
          {t.body}
        </div>
      ))}
    </div>
  );
}
