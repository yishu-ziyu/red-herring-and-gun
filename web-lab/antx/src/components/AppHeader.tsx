// 照抄自 Ant Design X Welcome「variant」示例（borderless + extra 按钮）：https://x.ant.design/components/welcome-cn#welcome-demo-variant
import { HistoryOutlined } from "@ant-design/icons";
import { Welcome } from "@ant-design/x";
import { Button, Space } from "antd";
import { navigate } from "../lib/nav.ts";

export default function AppHeader({ onHistory, extra }: { onHistory: () => void; extra?: React.ReactNode }) {
  return (
    <Welcome
      variant="borderless"
      icon={<img src="/mark.png" alt="" width={36} height={36} style={{ cursor: "pointer" }} onClick={() => navigate({ part: "home" })} />}
      title={<span style={{ cursor: "pointer", fontSize: 18 }} onClick={() => navigate({ part: "home" })}>红鲱鱼与枪</span>}
      styles={{ root: { padding: "12px 0", alignItems: "center" }, icon: { width: 36, height: 36 } }}
      extra={
        <Space>
          {extra}
          <Button icon={<HistoryOutlined />} aria-label="历史记录" onClick={onHistory}>
            <span className="hide-xs">历史记录</span>
          </Button>
        </Space>
      }
    />
  );
}
