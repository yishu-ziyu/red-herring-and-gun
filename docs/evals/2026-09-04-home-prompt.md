# 2026-09-04 · 首页搬回 mvp 排版和输入卡

一句话：打开 `/` 看到左栏「新查一条 / 最近核查」，中间标题「与」为红，输入卡是灰底 + 加号 + 圆箭头发送。

## Change

用户打开脊柱首页，版面接近现网 mvp：左栏历史，中间品牌与 PromptInput 卡。点加号或粘贴可附图。点圆箭头立案。

## Not this

- 拷 `mvp/src/styles.css` 或 PromptInput.tsx 整文件
- 搬登录 / 中英切换 / 厂商条 / ①–⑤ 步骤
- 再把首页塞进案件三栏壳

## Evaluator

```bash
npm test -w @rhg/web -- src/pages/HomePage.test.tsx src/App.test.tsx
```

浏览器 1280：有「新查一条」、标题里「与」为强调色、发送钮 `aria-label` 为「开始核对」、无「整句判决」。

## Goal / Hard bar / Improve

- Goal: 首页看起来像你圈的那两张，不是骨架输入框
- Hard bar: 测试绿；真打开 5173 对照那两张图
- Improve: none
