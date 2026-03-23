# Guqinize

一个把 MusicXML 五线谱转成古琴减字谱显示与 PNG 导出的前端工具。

目前这版重点做了几件事：

- 解析 MusicXML 主旋律并转换成简谱时值
- 映射到古琴弦位、徽位与基本指法
- 将减字谱字形用专用字体组合显示
- 按 MusicXML 的 `beam` 规则额外渲染时值连接横线
- 支持连音弧、跨小节 tie 弧线与 PNG 导出

## 环境要求

- Node.js 18 或更高
- npm

## 安装依赖

```bash
npm install
```

## 本地开发运行

```bash
npm run dev
```

启动后打开：

```text
http://localhost:5173
```

你可以用两种方式测试：

1. 点击页面左侧 `Load Sample Score`
2. 上传仓库里的 MusicXML 文件，例如 [assist/小半.musicxml](/Users/bernard/Code/Guqin-Notation/assist/小半.musicxml)

## 生产构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

如果想本地预览构建结果：

```bash
npm run preview
```

## 使用流程

1. 上传 `.xml` 或 `.musicxml`
2. 选择定弦
3. 点击 `Transcribe`
4. 在右侧查看减字谱结果
5. 点击 `Export PNG` 导出图片

## 当前实现说明

- 时值连接横线不是拉伸字符本身，而是单独叠加渲染
- 一级、二级 beam 会按 MusicXML 原始层级分别分段
- `forward hook` / `backward hook` 也会保留为独立短横
- 小节按单位分组后再换行，避免连线组被中途挤断

## 关键文件

- [App.tsx](/Users/bernard/Code/Guqin-Notation/App.tsx)
- [components/ScoreViewer.tsx](/Users/bernard/Code/Guqin-Notation/components/ScoreViewer.tsx)
- [components/BeamGroup.tsx](/Users/bernard/Code/Guqin-Notation/components/BeamGroup.tsx)
- [components/JianzipuChar.tsx](/Users/bernard/Code/Guqin-Notation/components/JianzipuChar.tsx)
- [utils/parser.ts](/Users/bernard/Code/Guqin-Notation/utils/parser.ts)
- [utils/mapper.ts](/Users/bernard/Code/Guqin-Notation/utils/mapper.ts)
