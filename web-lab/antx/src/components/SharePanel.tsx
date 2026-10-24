// 照抄自 antd Button 基础示例 https://ant.design/components/button-cn 与 Typography「可复制」示例 https://ant.design/components/typography-cn#typography-demo-interactive
import { ShareAltOutlined } from "@ant-design/icons";
import { Button, Flex, Typography } from "antd";
import { useState } from "react";
import { createShare } from "../lib/api.ts";
import { hrefOf } from "../lib/nav.ts";

/** 真实记录走 POST /api/investigations/:runId/shares；本地样例没有分享权限，退回本地分享页链接并说明。 */
export default function SharePanel({ runId, fixture }: { runId?: string; fixture?: string }) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const share = async () => {
    setLoading(true);
    setNote("");
    try {
      if (!runId) throw new Error("no run");
      setUrl(await createShare(runId));
    } catch (error) {
      if (fixture) {
        setUrl(new URL(hrefOf({ part: "share", run: fixture }), window.location.origin).toString());
        setNote("这是本地样例记录，生成的是样例分享页的链接。");
      } else {
        setNote((error as Error).message || "分享链接没能生成");
      }
    } finally {
      setLoading(false);
    }
  };
  return (
    <Flex vertical gap={6} align="center" style={{ padding: "0 12px", textAlign: "left" }}>
      <Button type="primary" icon={<ShareAltOutlined />} loading={loading} onClick={share} data-gp-share-start="">
        {url ? "重新生成分享链接" : "生成分享链接"}
      </Button>
      {url ? (
        <Typography.Text copyable={{ text: url }} style={{ maxWidth: "100%", wordBreak: "break-all" }}>
          <a href={url} target="_blank" rel="noopener noreferrer" data-gp-share-url="">{url}</a>
        </Typography.Text>
      ) : null}
      {note ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{note}</Typography.Text> : null}
    </Flex>
  );
}
