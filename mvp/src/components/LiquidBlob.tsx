/**
 * LiquidBlob — gooey 液态容器。
 *
 * 用 SVG 滤镜（feGaussianBlur 高斯模糊 + feColorMatrix 提高对比度）
 * 让内部圆形元素在相邻时产生粘滞融合的液态感。这是 liquid-gooey 的核心。
 *
 * 关键：
 * - 不要 operator="atop"：那会把原始清晰图形叠回液体上，破坏融合。
 * - 子元素必须是圆形/胶囊实心元素，用 transform 移动，靠近时经滤镜融合、
 *   拉开时像液体分离。
 * - 容器单独挂 filter，文字/装饰不要放进会糊掉的区域。
 */
import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";

interface LiquidBlobProps {
  children: ReactNode;
  /** 模糊半径 px（越大越粘滞、越"糊"） */
  blur?: number;
  /** 对比度提升（越大边缘越硬、液体越"收"） */
  contrast?: number;
  /** alpha 阈值：多少不透明度算"实心"。越大越容易断开 */
  threshold?: number;
  className?: string;
  style?: CSSProperties;
}

function gooMatrix(contrast: number, threshold: number): string {
  return [
    "1 0 0 0 0",
    "0 1 0 0 0",
    "0 0 1 0 0",
    `0 0 0 ${contrast} ${-threshold}`,
  ].join(" ");
}

export function LiquidBlob({
  children,
  blur = 8,
  contrast = 18,
  threshold = 10,
  className,
  style,
}: LiquidBlobProps) {
  const id = useId().replace(/:/g, "");
  const filterId = `goo-${id}`;

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values={gooMatrix(contrast, threshold)}
              result="goo"
            />
          </filter>
        </defs>
      </svg>
      <div
        className={className}
        style={{ filter: `url(#${filterId})`, ...style }}
      >
        {children}
      </div>
    </>
  );
}