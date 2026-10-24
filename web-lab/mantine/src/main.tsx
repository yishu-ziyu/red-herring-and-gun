import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./app.css";
import { Anchor, createTheme, MantineProvider } from "@mantine/core";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// 主题只改主色与字体栈，其余沿用 Mantine 默认（https://mantine.dev/theming/theme-object/）。
const theme = createTheme({
  primaryColor: "red",
  primaryShade: 7,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
  defaultRadius: "md",
  // 外链用蓝色，免得和红色主色（警示、反驳）混淆。
  components: { Anchor: Anchor.extend({ defaultProps: { c: "blue.8" } }) },
});

createRoot(document.getElementById("root")!).render(
  <MantineProvider theme={theme} defaultColorScheme="light" forceColorScheme="light">
    <App />
  </MantineProvider>,
);
