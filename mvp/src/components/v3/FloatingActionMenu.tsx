import { useState } from "react";

export function FloatingActionMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="floating-action-menu">
      {isOpen ? (
        <div className="floating-action-panel" aria-label="快捷操作菜单">
          <a href="/model-settings-preview">配置模型服务商</a>
        </div>
      ) : null}
      <button
        className="floating-action-button"
        type="button"
        aria-label="打开快捷操作"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span aria-hidden="true">{isOpen ? "×" : "+"}</span>
      </button>
    </div>
  );
}
