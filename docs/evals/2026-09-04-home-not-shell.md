# 2026-09-04 · 首页是输入入口，不是空的案件页

一句话：打开 `/` 只看见品牌、一句话、输入和开始核对；左右空栏和「整句判决 / 已完成」只出现在案件页。

## Change

用户打开首页，中间是一张纸：标题、定位句、输入、主按钮。没有左侧案件栏、没有右侧空卷宗。点进 `/cases/:id` 才是三栏壳。

## Not this

- 把 `mvp/src` 的组件或 17.8K 行 CSS 拷过来
- 首页继续套 `AppShell`
- 只改文案、不拆壳

## Evaluator

```bash
npm test -w @rhg/web -- src/App.test.tsx src/pages/HomePage.test.tsx src/shell/AppShell.test.tsx
```

- 首页 1280：`document.querySelector("aside")` 为 null；没有「整句判决」；有「开始核对」
- 案件 fixture `/cases/fx-done`：仍有 `nav`、`main`、`aside`

浏览器：刷新 http://127.0.0.1:5173/ 看不到左右空栏。

## Goal / Hard bar / Improve

- Goal: 首页不再像空 IDE
- Hard bar: 上列测试绿；真打开首页无 aside
- Improve: none
