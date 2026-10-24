// 入口：antd ConfigProvider + XProvider（照 https://x.ant.design/components/x-provider-cn 的用法），中文语言包。
import { XProvider } from "@ant-design/x";
import zhCN_X from "@ant-design/x/locale/zh_CN";
import { App as AntApp, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <XProvider
      locale={{ ...zhCN, ...zhCN_X }}
      theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: "#a8071a", colorLink: "#a8071a", borderRadius: 8 } }}
    >
      <AntApp>
        <App />
      </AntApp>
    </XProvider>
  </StrictMode>,
);
