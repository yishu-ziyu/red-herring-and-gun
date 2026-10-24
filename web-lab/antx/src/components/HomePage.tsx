// 输入框照抄自 Ant Design X Sender「粘贴图片」示例 https://x.ant.design/components/sender-cn#sender-demo-paste-image
// 发送按钮照抄自 Sender「自定义后缀」示例 https://x.ant.design/components/sender-cn#sender-demo-suffix
// 名字与 logo 照抄自 Welcome 基础示例 https://x.ant.design/components/welcome-cn#welcome-demo-basic
import { CloudUploadOutlined, PictureOutlined } from "@ant-design/icons";
import { Attachments, type AttachmentsProps, Sender, Welcome } from "@ant-design/x";
import { App, Button, Flex, type GetProp, type GetRef } from "antd";
import { useRef, useState } from "react";
import { startInvestigation, type ImageInput } from "../lib/api.ts";
import { navigate } from "../lib/nav.ts";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function HomePage() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GetProp<AttachmentsProps, "items">>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null);
  const senderRef = useRef<GetRef<typeof Sender>>(null);

  const submit = async () => {
    const claim = text.trim();
    if (!claim && items.length === 0) return;
    setSending(true);
    try {
      const images: ImageInput[] = [];
      for (const item of items) {
        const file = item.originFileObj as File | undefined;
        if (file) images.push({ name: file.name, type: file.type, size: file.size, dataUrl: await readAsDataUrl(file) });
      }
      const { runId } = await startInvestigation(claim, images);
      navigate({ part: "running", live: runId });
    } catch (error) {
      message.error((error as Error).message);
      setSending(false);
    }
  };

  const senderHeader = (
    <Sender.Header title="图片" styles={{ content: { padding: 0 } }} open={open} onOpenChange={setOpen} forceRender>
      <Attachments
        ref={attachmentsRef}
        accept="image/*"
        beforeUpload={() => false}
        items={items}
        onChange={({ fileList }) => setItems(fileList)}
        placeholder={(type) =>
          type === "drop"
            ? { title: "松开即可放入图片" }
            : { icon: <CloudUploadOutlined />, title: "放入图片", description: "点击选择、拖进来，或直接在输入框里粘贴" }
        }
        getDropContainer={() => senderRef.current?.nativeElement}
      />
    </Sender.Header>
  );

  return (
    <Flex vertical align="center" justify="center" gap={32} style={{ minHeight: "calc(100vh - 160px)", padding: "24px 0" }}>
      <Welcome
        variant="borderless"
        icon={<img src="/logo.png" alt="红鲱鱼与枪" width={160} height={160} />}
        title={<span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>红鲱鱼与枪</span>}
        styles={{ root: { flexDirection: "column", alignItems: "center", background: "transparent" }, icon: { width: 160, height: 160 } }}
      />
      <div style={{ width: "100%", maxWidth: 720 }}>
        <Sender
          ref={senderRef}
          header={senderHeader}
          placeholder="贴一句要核查的话，也可以粘贴图片"
          autoSize={{ minRows: 3, maxRows: 8 }}
          prefix={<Button type="text" aria-label="添加图片" icon={<PictureOutlined />} onClick={() => setOpen(!open)} />}
          value={text}
          onChange={setText}
          loading={sending}
          onPasteFile={(files) => {
            for (const file of Array.from(files)) if (file.type.startsWith("image/")) attachmentsRef.current?.upload(file);
            setOpen(true);
          }}
          onSubmit={submit}
          suffix={(_, { components: { SendButton, LoadingButton } }) =>
            sending ? (
              <LoadingButton />
            ) : (
              <SendButton type="primary" icon={null} data-gp-start="" disabled={!text.trim() && items.length === 0} style={{ width: "auto", paddingInline: 16 }}>
                开始核查
              </SendButton>
            )
          }
        />
      </div>
    </Flex>
  );
}
