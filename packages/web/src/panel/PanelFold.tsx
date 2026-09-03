import { useState, type ReactNode } from "react";

export function PanelFold(props: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen !== false);
  return (
    <section className="panel-fold">
      <h2 className="panel-fold-title">
        <button
          type="button"
          className="btn btn-ghost fold-btn"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {props.title}
        </button>
      </h2>
      {open ? <div className="panel-fold-body">{props.children}</div> : null}
    </section>
  );
}
