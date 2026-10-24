// 照抄 Mantine UI「HeaderSimple」（https://ui.mantine.dev/category/headers/#header-simple）：左 logo、右操作；去掉导航链接，只留「历史记录」。
import { Burger, Button, Group, Image, Text, UnstyledButton } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";

type Props = {
  onOpenHistory: () => void;
  navigate: (href: string) => void;
  burger?: { opened: boolean; toggle: () => void; label: string };
};

export function AppHeader({ onOpenHistory, navigate, burger }: Props) {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        {burger ? <Burger opened={burger.opened} onClick={burger.toggle} hiddenFrom="md" size="sm" aria-label={burger.label} /> : null}
        <UnstyledButton
          onClick={() => navigate("?part=home")}
          aria-label="回到首页"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <Image src="/mark.png" alt="" w={30} h={30} />
          <Text fw={700} size="lg" style={{ whiteSpace: "nowrap" }}>
            红鲱鱼与枪
          </Text>
        </UnstyledButton>
      </Group>
      <Button variant="subtle" color="dark" leftSection={<IconHistory size={18} />} onClick={onOpenHistory} aria-label="历史记录">
        历史记录
      </Button>
    </Group>
  );
}
