<!-- source: ../README.md; 中文翻译；如有出入以英文版为准 -->
[English](../README.md) | **简体中文**

# Leaflet.TrackReplay

时间轴对齐的批量数据回放系统 — A Leaflet plugin for time-aligned batch GPS track replay.

[![npm version](https://img.shields.io/npm/v/leaflet-trackreplay.svg)](https://www.npmjs.com/package/leaflet-trackreplay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

## 文档

- **人类使用指南** — [中文](HUMAN-USAGE.zh.md) · [English](HUMAN-USAGE.en.md)：安装、生成数据、常用配置、故障排查。
- **LLM 提示词包** — [中文](LLM-PROMPT.zh.md) · [English](LLM-PROMPT.en.md)：一份自包含的规范，可与你的需求一起粘贴，让另一个模型无需阅读本仓库即可生成有效数据或集成代码。
- **Python 宿主指南** — [中文](python-host/GUIDE.zh.md) · [English](python-host/GUIDE.en.md)：构建一个提供页面、插件资源和数据 API 的 FastAPI/Jinja2（或 Flask）宿主。
- **架构** — [architecture.html](architecture.html)：三张图（图层、数据旅程、重建生命周期）。
- **实现与设计** — [IMPLEMENTATION.md](IMPLEMENTATION.md) · [核心设计（中文）](时间轴对齐的批量数据回放系统%20核心设计.md)。
- 本 README 是完整参考（选项、方法、内部实现）。

## 功能

- 🎬 **类视频播放器的回放** — 播放/暂停、停止、倍速控制、进度滑块
- 🗺️ **多图层轨迹** — 在层级图层树中组织轨迹
  （存在 Leaflet.Control.Layers.Tree 时使用它，否则回退到扁平的 `L.control.layers`）
- 🎨 **基于速度的着色** — 3 种模式：固定（在可配置范围内应用 Turbo 色带）、
  自适应（P5–P95）、自定义（branca 风格）
- 📍 **节点聚合** — 为密集轨迹节点提供标记聚合，保留每一个数据点（通过 Leaflet.markercluster）
- 🌌 **背景节点** — 大量与任何时间序列无关的独立位置点
  （`element: "background_nodes"`），以可点击圆点的形式绘制在轨迹
  *下方* — 默认散点，聚合需主动开启 — 带逐节点弹窗和批量控件
- 🗂️ **数据集会话** — 运行时添加 / 移除 / 清空 GeoJSON 数据集，
  按 `layerPath` 合并；播放时间、可见性、批量标签和模式在每次数据变更后
  全部保留
- 📥 **数据源面板** — 管理会话的数据集（列表含逐项移除、全部清空）并导入新数据集：
  GeoJSON / GPX，支持文件选择、拖放到地图、粘贴、URL 或示例；无时间戳的 GPX
  降级为静态线，并在每次导入报告中注明
- 🔎 **多命中搜索（leaflet-multisearch）** — 对元素标签做文本搜索，
  *每一处出现都是命中*：包含重复项、命中数量徽标、
  Enter / ◀ / ▶ 循环切换（回绕），每次跳转会打开该节点的弹窗
  （聚合感知）；默认搜索背景节点
- ⌨️ **焦点作用域键盘** — 快捷键位于控件自身：
  点击播放条（或搜索框）以激活其按键，焦点轮廓会显示
  哪个控件拥有键盘；任何输入框中的输入都不会被拦截
- 🏃 **移动指示器** — 带基于方位角旋转的动画标记
- 🛤️ **动态路径着色** — 已行进（红）/ 未行进（蓝）边渲染
- 👁️ **视角跟随** — 自动平移以跟随移动对象（最新/随机/指定/关闭）
- ⏱️ **可编辑时间轴** — 双击输入时间戳并跳转
- 🔌 **解耦架构** — 可独立使用核心引擎 + 各个图层
- 💬 **弹窗** — 轨迹分段和节点上的逐段弹窗，以及静态要素弹窗
- 🏷️ **批量标签显示** — 批量打开任意对象或元素类型的弹窗
  （它们*就是*真实弹窗，不是仿制品）
- 🧭 **感知底图的坐标系** — WGS-84 ⇄ GCJ-02（火星）转换，使高德/AMap 瓦片与
  GPS 轨迹对齐；底图可作为单选组交给图层树
- 📡 **事件系统** — `start`、`pause`、`stop`、`finished`、`tick`、`timechange`、`speedchange`

## 安装

### npm

```bash
npm install leaflet-trackreplay
```

### CDN

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet-trackreplay/dist/leaflet-trackreplay.css" />
<script src="https://unpkg.com/leaflet-trackreplay/dist/leaflet-trackreplay.iife.js"></script>
```

### 依赖要求

- Leaflet `^1.7.0`
- Leaflet.markercluster `^1.5.0`（可选 — 用于节点聚合）
- Leaflet.Control.Layers.Tree `^1.2.0`（可选 — 可折叠的层级图层控件；
  没有它时，图层控件回退为带面包屑标签的扁平 `L.control.layers`）

## 快速开始

```javascript
// 1. Create a map
var map = L.map('map').setView([39.91, 116.41], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// 2. Prepare your data as a GeoJSON FeatureCollection
var data = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[116.40, 39.90], [116.41, 39.91], [116.42, 39.92]],
      },
      properties: {
        layerPath: ['group1', 'track1'],
        isTimestampedgeojson: true,
        times: [1700000000000, 1700000005000, 1700000010000],
        drawMovingIndicator: true,
      },
    },
  ],
};

// 3. Initialize TrackReplay
var replay = L.trackReplay(map, data, {
  colorMode: 'fixed',
  loop: false,
});

// 4. Start playback
replay.play();
```

## API

### `L.trackReplay(map, featureCollection, options)`

创建一个新的 TrackReplay 实例，并将所有图层/控件添加到地图。

#### 选项

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `colorMode` | `'fixed' \| 'adaptive' \| 'custom'` | `'fixed'` | 速度到颜色的映射模式 |
| `colorConfig` | `ColorBarConfig` | — | 自定义色带配置（`'custom'` 模式必需） |
| `colorRange` | `number[]` | `[0, 200]` | `'fixed'` 模式下色带覆盖的 `[min, max]` km/h |
| `speed` | `number` | `60` | 初始播放倍速 — 60× 是默认档位中 `1s = 1min` 的一档 |
| `speedOptions` | `number[]` | `[0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600]` | 选择器中显示的倍速档位 |
| `speedLabel` | `(speed) => string` | — | 档位的自定义标签格式化函数 |
| `playbackLabels` | `object` | 英文默认值 | 播放提示 `{stop, play, pause, speed, loop, hint}`；键名（Space / R / 0-9）会自动追加 |
| `loop` | `boolean` | `false` | 播放结束后自动重新开始 |
| `tickLen` | `number` | `250` | 刻度间隔（毫秒） |
| `minTickMs` | `number` | `16` | 刻度间隔下限 — 防止高倍速淹没 tick 循环 |
| `showControls` | `boolean` | `true` | 显示播放控件（播放/暂停、停止、倍速、循环） |
| `showLoop` | `boolean` | `true` | 在播放条中显示循环开关（`loop` 设置其初始状态） |
| `showTimeline` | `boolean` | `true` | 显示时间轴滑块 — 两者都启用时会在**一个框**内一起渲染 |
| `controlBarPosition` | `string` | `'bottomleft'` | 播放 + 时间轴组合框的角落 |
| `showLegend` | `boolean` | `true` | 显示速度颜色图例 |
| `legendTitle` | `string` | `'Speed (km/h)'` | 图例标题 |
| `legendSteps` | `number` | `10` | 图例档数（也是 `getLegend(steps)` 的默认值） |
| `showViewFollow` | `boolean` | `true` | 显示视角跟随控件 |
| `viewFollowTitle` | `string` | `'Follow:'` | 跟随控件的标题（同时作为其折叠标题） |
| `viewFollowExpanded` | `boolean` | `false` | 以展开状态启动跟随面板 |
| `bearingTransform` | `(bearing: number) => number \| null` | pass-through | 旋转前变换方位角。默认开启旋转；传 `null` 可禁用（略快） |
| `rotationOffset` | `number` | `0` | 加到方位角上的度数（例如图标朝右时为 `90`） |
| `movingIcon` | `L.Icon \| L.DivIcon` | — | 移动指示器的自定义图标 |
| `trackLayerOptions` | `object` | — | 轨迹图层选项：`{ defaultStyle }` — 无样式分段的回退样式 |
| `pointClusterOptions` | `object` | — | 节点聚合选项：`{ pointStyle, clusterStyle }` — circleMarker 样式和 `leaflet.markercluster` 选项 |
| `staticLayerOptions` | `object` | — | 传给 `L.geoJSON` 的选项，用于静态 / 事件 / 自定义元素桶（`{ style, pointToLayer, onEachFeature, … }`） |
| `traveledStyle` | `object` | `{color:'#e74c3c',weight:4}` | 已行进路径边的样式 |
| `untraveledStyle` | `object` | `{color:'#3498db',weight:4}` | 未行进路径边的样式 |
| `elementLabels` | `object` | 英文默认值 | 各元素图层的标签：`{track, points, static, events, background_nodes, traveled, untraveled, indicator}` |
| `backgroundNodesOptions` | `object` | — | `background_nodes` 元素的选项：`{ style, cluster (default false — scatter), clusterOptions }` |
| `showClusterScatterControl` | `boolean` | `true` | 显示聚合 / 散点设置面板（仅当数据包含背景节点时） |
| `clusterScatterPosition` | `string` | `'topright'` | 该面板的角落 |
| `clusterScatterTitle` | `string` | `'Cluster / Scatter'` | 该面板的标题（同时作为其折叠标题） |
| `clusterScatterExpanded` | `boolean` | `false` | 以展开状态启动聚合/散点面板 |
| `clusterScatterLabels` | `object` | `{cluster:'Cluster', scatter:'Scatter'}` | 背景节点区域内的选项标签 |
| `showDataSource` | `boolean` | `false` | 显示数据源面板（数据集列表 + 导入通道） |
| `dataSourcePosition` | `string` | `'topleft'` | 该面板的角落 |
| `dataSourceTitle` | `string` | `'Data source'` | 该面板的标题（显示数据集数量） |
| `dataSourceExpanded` | `boolean` | `false` | 启动时面板为打开状态 |
| `dataSourceLabels` | `object` | 英文默认值 | 面板 UI 字符串（`pick/add/load/pastePlaceholder/urlPlaceholder/samplesLabel/dropHint/pastedName/datasetsLabel/importLabel/removeLabel/clearLabel/clearConfirmLabel/emptyLabel/previewHint/previewCopy/previewCopied/previewCopyFailed/previewDownload/previewClose/formatHelp/formatCopy/formatCopyPython/formatPythonNote/formatFill`） |
| `dataSourceMessages` | `object` | 英文默认值 | 文本构建器 `{added, degraded, empty, error, rowMeta, previewSummary, previewTruncated, previewPositionsTruncated, previewCharsTruncated, previewTooLarge, previewMissing, importTooLarge, formatHelp, formatShapes}` — `formatHelp()` 返回通用规则（每行一条），`formatShapes()` 返回 `[{name, rules, example, python}]`（每种输入形态一列） |
| `dataSourceSamples` | `Object[]` | — | `[{label, data}]` 示例数据集，显示为按钮 |
| `dataSourcePreview` | `object` | `{maxFeatures:50, maxChars:20000, summaryScan:5000, downloadMaxChars:2e7, downloadMaxMs:3000}` | 数据集预览及其导出的限制 — 任何内容都不会被整体字符串化，导出会中止（带一行报告）而不是冻结标签页；`0`/`Infinity` 禁用某一限制 |
| `dataSourceImportMaxChars` | `number` | `5e7` | 拒绝解析超过此字符数的导入文本（同样的防冻结保护） |
| `showSearch` | `boolean` | `false` | 显示多命中搜索控件（leaflet-multisearch） |
| `searchPosition` | `string` | `'topleft'` | 搜索控件的角落 |
| `searchElements` | `string[]` | `['background_nodes']` | 纳入搜索索引的元素类型 |
| `searchZoom` | `number` | — | 每次跳转的 `setView` 缩放级别（省略则按当前缩放平移） |
| `searchLabels` | `object` | 英文默认值 | `{open, close, placeholder, prev, next, inputHint, keyboardHint}` |
| `searchMessages` | `object` | 英文默认值 | `{count, of, more, empty}` 文本构建器 |
| `mapFocusSpace` | `boolean` | `true` | 当**地图本身**获得焦点时，Space 切换播放/暂停（地图上不绑定其他按键） |
| `displayTimeZone` | `*` | `'local'` | 时间轴的读取时区：`'local'`（浏览器）、以小时为单位的固定 UTC 偏移（例如 `8`），或 IANA 名称（例如 `'Asia/Shanghai'`）。会同步改变时间标签、时间编辑器、日边界和日历查询 |
| `showDateInfo` | `boolean` | `true` | 时间轴下方的日期行（见下文） |
| `dateInfoLabels` | `object` | 英文默认值 | `{ weekdays: [7 个字符串，周日在前], holidaysField, workdaysField }` — 后两个前缀条目来自 `calendar.holidays` / `calendar.workdays`（默认：字段名本身） |
| `dateInfoMessages` | `object` | 英文默认值 | `{ dayOf(n, total) }` |
| `calendar` | `object` | — | 节假日表：`{ holidays: {'YYYY-MM-DD': label}, workdays: {'YYYY-MM-DD': label} }`，日期以显示时区为准；同一天同时出现在两者中时 `workdays` 优先。由宿主抓取 — 见“日期行、时区与节假日” |
| `showElementToggles` | `boolean` | `true` | 显示批量控件（每种元素类型一个三态复选框，跨所有对象） |
| `elementTogglesPosition` | `string` | `'topright'` | 批量控件的角落 |
| `elementTogglesTitle` | `string` | `'Batch'` | 批量控件的标题（同时作为其折叠标题） |
| `elementTogglesExpanded` | `boolean` | `false` | 以展开状态启动批量面板 |
| `showInfoLabels` | `boolean` | `true` | 批量标签显示控件 — 批量打开对象已有的弹窗（见下文） |
| `infoLabelsPosition` | `string` | `'topright'` | 标签控件的角落 |
| `infoLabelsTitle` | `string` | `'Labels'` | 标签控件的标题 |
| `dataDatum` | `'wgs84' \| 'gcj02'` | `'wgs84'` | **输入**坐标的坐标系（见底图与 GCJ-02） |
| `mapDatum` | `'wgs84' \| 'gcj02'` | `'wgs84'` | **当前底图**的坐标系 — 高德/AMap 瓦片用 `'gcj02'` |
| `baseLayers` | `{label, layer}[]` | — | 作为图层树单选组显示的底图（宿主拥有这些图层） |
| `baseLayersLabel` | `string` | `'Basemap'` | 该单选组的标签 |
| `layerControlCollapsed` | `boolean` | `true` | 启动时图层树为折叠状态；传 `false` 可展开 |

#### 逐元素图层

每个对象（`layerPath`）都会拆分为可独立开关的图层 — 其轨迹线、轨迹节点、已行进/未行进路径和移动指示器都会作为图层树中的独立条目出现，因此可以分别显示或隐藏：

```
visitor
├── Bee
│   ├── 轨迹 (Track)         — speed-coloured track lines
│   ├── 节点 (Points)        — clustered track points
│   ├── 已行进 (Traveled)    — traveled route edge
│   ├── 未行进 (Untraveled)  — remaining route edge
│   └── 箭头 (Indicator)     — moving indicator
└── Mark
    └── …
```

每个分支都有全选复选框。隐藏的元素会被时间引擎跳过（只要两条路径线都隐藏，不可见图层就没有逐帧开销）；重新打开的图层会立即刷新。

程序化访问：`replay.allLayers['visitor/Bee'].elements` 为 `[{ key, label, layer }, …]` — 用它自行切换元素：`map.addLayer(el.layer)` / `map.removeLayer(el.layer)`。

#### 批量控件

一个单独的控件（`showElementToggles`，默认开启）为**每种元素类型**提供一个**三态复选框** — 轨迹 / 节点 / 已行进 / 未行进 / 箭头 — 一次性**为所有对象**打开或关闭该类型，独立于图层树的逐对象复选框：

```
批量
☑ 轨迹    2/2      ← every object's track lines
☐ 节点    0/2
▣ 已行进  1/2      ← partial: some objects' traveled route shown
…
```

- 当只有部分对象启用了该元素类型时，复选框显示短横线，`on/total` 计数让状态一目了然。
- 批量切换也会影响初始化时 `layerVisibility` 为 `false` 的对象。
- 每次更改都通过 `map.addLayer` / `map.removeLayer`，因此图层树复选框（及其全选父项）会自动保持同步 — 双向同步。

#### 实例方法

| 方法 | 说明 |
|--------|-------------|
| `play()` | 开始/继续播放 |
| `pause()` | 暂停播放 |
| `stop()` | 停止并重置到起点 |
| `seek(timeMs)` | 跳转到指定时间戳 |
| `seekByProgress(progress)` | 跳转到进度比例（0–1） |
| `setSpeed(speed)` | 设置播放倍速 |
| `getSpeed()` | 获取播放倍速 |
| `setLoop(loop)` | 启用/禁用自动重新开始 |
| `getLoop()` | 获取循环模式 |
| `getCurrentTime()` | 获取当前时间（毫秒） |
| `getProgress()` | 获取进度（0–1） |
| `getState()` | 获取状态：`'playing'` / `'paused'` / `'stopped'` |
| `getLegend(steps?)` | 当前颜色图例，形如 `[{speed, color, label}]`，共 `steps + 1` 项（`steps` 默认为 10） |
| `addDataset(fc, opts?)` | 运行时添加数据集（按 `layerPath` 合并）；返回其 id |
| `removeDataset(id)` | 只移除该数据集的部分 |
| `clearDatasets()` | 移除所有数据集（会话保持存活） |
| `listDatasets()` | 当前数据集的元数据 |
| `getDataset(id)` | 单个数据集的原始 FeatureCollection |
| `setTimeZone(tz)` | 切换时间轴的显示时区（不重建） |
| `getTimeZone()` | 当前时区规格 |
| `setCalendar(table)` | 替换节假日表（不重建）— 宿主的抓取数据变化时调用 |
| `getCalendar()` | 当前节假日表 |
| `on(event, fn)` | 注册事件监听器 |
| `off(event, fn)` | 移除事件监听器 |
| `destroy()` | 移除所有图层、控件和监听器 |

#### 事件

| 事件 | 数据 | 说明 |
|-------|------|-------------|
| `start` | `{ time }` | 播放开始 |
| `pause` | `{ time }` | 播放暂停 |
| `stop` | `{ time }` | 播放停止（重置） |
| `finished` | `{ time }` | 到达时间轴终点 |
| `tick` | `{ time, progress }` | 每一帧 |
| `timechange` | `{ time, progress }` | 时间改变（跳转/停止） |
| `speedchange` | `{ speed }` | 倍速改变 |
| `datasetadd` | `{ id, name, featureCount, total }` | 添加了一个数据集 |
| `datasetremove` | `{ id, name, featureCount, total }` | 移除了一个数据集 |
| `datasetsclear` | `{ removed }` | 所有数据集被移除 |

### 数据集（运行时数据管理）

`L.trackReplay` 是管理一组数据集的**会话**。三种启动形态，返回同一个对象：

```javascript
L.trackReplay(map, featureCollection, options);   // one fixed dataset (as before)
L.trackReplay(map, [fc1, fc2], options);          // several datasets at once
L.trackReplay(map, null, options);                // empty; add data later
```

每次 `addDataset()` 调用就是一个数据集 — 移除的原子单位：

```javascript
var id = replay.addDataset(fc, { name: '10月14日轨迹' });
replay.removeDataset(id);   // removes exactly this dataset's parts
replay.clearDatasets();     // remove all data (session stays alive, reusable)
replay.listDatasets();      // [{ id, name, featureCount }, …]
replay.getDataset(id);      // { id, name, featureCollection }
```

- **按 `layerPath` 合并** — 共享同一 `layerPath` 的数据集合并为一个对象（例如向现有轨迹追加更多分段）。移除发生在*源头*：容器丢弃该数据集，并从剩余内容重建回放 — 跨越多个数据集的对象会带着剩余部分存活；被移除数据集拥有的对象随之消失（它们的树条目、批量显隐行和标签列也一并消失）。
- **状态在每次重建后保留** — 播放时间和运行状态、倍速、循环、逐元素可见性、勾选的批量标签单元格、聚合/散点模式和跟随模式都会被捕获并重新应用；`on()`/`off()` 监听器继续工作（一个稳定的事件总线同时承载播放*和*数据集事件）。
- **输入契约**：每个数据集必须是 **WGS-84（地球坐标系）**。没有逐数据集的坐标系设置 — 添加前请先转换 GCJ-02 源数据。
- **空会话**：没有数据时没有可显示的构建（`getState()` 为 `'stopped'`，`getCurrentTime()` 为 `null`）；第一次 `addDataset()` 会构建一切，`clearDatasets()` 返回那个空的可复用状态。`destroy()` 仍是完整拆除。

#### 数据源面板（`showDataSource`，默认关闭）

一个会话级面板（在每次重建后存活，包括展开状态），分为三部分：

1. **数据集** — 当前数据集，每个一行（名称 + 要素数），带自己的移除按钮，外加两击式**全部清空**（第一次点击进入待确认，第二次确认）。列表通过会话的数据集事件刷新，因此程序化调用 `addDataset()` / `removeDataset()` 也会更新它。标题显示数量。
   **点击某一行会打开该数据集原始 GeoJSON 的预览** — 一个模态面板（Esc / 背景 / ✕ 关闭；打开时其后的地图不可交互），在格式化文本上方有一行摘要（要素 · 几何类型 · 属性键 · 时间范围）。文本会**显式截断**（默认：前 50 个要素、最多 20 000 个字符 —
   `dataSourcePreview`），并以一条注释行说明截掉了什么，因此复制的片段绝不会被误认为完整数据集。页脚提供 **复制**（与显示内容完全一致 — 有界部分）和 **下载 .geojson**（完整数据集，在字符 + 时间预算内逐要素序列化：过大的导出会中止并给出一行报告，而不是冻结标签页）。移除或清空数据集会关闭其预览。导入时也应用同样的保护：超过 `dataSourceImportMaxChars`（默认 5e7 字符）的文本会被拒绝并给出一行报告，而不是解析。
2. **导入** — 五种通道：

| 通道 | 说明 |
|---------|-------|
| 拖放到地图 | 整个地图都是放置目标，带高亮覆盖层 |
| 文件选择器 | `.json` / `.geojson` / `.gpx` |
| 粘贴 | GeoJSON 或 GPX 文本 |
| URL | 用 `fetch` 抓取；服务器必须允许 CORS（或同源） |
| 示例 | `dataSourceSamples: [{ label, data }]` — 一键示例数据集 |

3. **报告** — 每次导入尝试一行（已添加 / 已降级 / 空 /
   错误）；文本来自 `dataSourceMessages`，因此可以本地化。

- 在粘贴框下方，**格式与示例**会打开一个模态：顶部是通用规则（每行一条，来自 `dataSourceMessages.formatHelp()`），然后是**每种输入形态一列** — 带时间戳的轨迹、事件标记、背景节点、静态上下文，以及混合集合（`formatShapes()`）。每列只包含自己的规则、自己可运行的 JSON 示例，以及 — 作为一个单独区块 — **自包含的 Python**，把原始序列转换成那份 JSON，并附一行说明（`formatPythonNote`：自己运行它 — 它打印出来的就是要粘贴的 GeoJSON，改数据即可）。它不从本项目导入任何东西，因此可以原样复制出去使用。按钮是 **复制 JSON**、**复制 Python** 和 **填入粘贴框**；填入只会把 JSON 放进框里（可编辑、已聚焦），绝不会自行导入。[`examples/convert.py`](#用-python-生成数据examplesconvertpy) 是同样逻辑打包成的现成模块。

- GeoJSON 可以是 `FeatureCollection`、单个 `Feature`，或两者的数组。**没有** `layerPath` 的要素会得到 `['imported', <name>]`，因此每次导入都落在自己的树分支中。
- **GPX** 由 `L.TrackReplay.Utils.GPX.parseGPX` 转换：所有点都带 `<time>` 的分段会变成可回放的 TimestampEdgeoJSON（默认开启移动指示器）；没有时间的段会作为**静态线**导入，并在报告中标记 — 它们无法参与回放。每个 `<trkseg>` 成为自己的要素（间隙绝不会被桥接），`<wpt>` 航点成为带 name/desc 弹窗的静态点。

### 多命中搜索（`showSearch`，默认关闭）

一个可折叠的搜索控件，搜索所配置元素类型的**标签文本**（弹窗内容）— 默认是背景节点。它的模型是*查找全部*，类似文字处理器：**每一处出现都是命中，包括重复项**（按文本给结果建键的列表式搜索器会静默丢弃重复项 — 本控件之所以存在，就是因为那种模型无法表示它们）。

- 输入即可看到命中数量（`3 处`）和匹配行；**Enter / ▶ / ◀ 循环切换命中（回绕）**，平移到每条记录并打开其弹窗。点击某一行直接跳到该命中。
- **聚合感知**：当前位于聚合气泡内的命中会先通过 `zoomToShowLayer` 展开，然后打开其弹窗。
- 匹配为不区分大小写的子串；每个命中都有脉冲圆环标记。
- 数据集变化或背景节点重新渲染（聚合/散点切换）时，索引会自行刷新。
- Esc 清空查询；再次 Esc 折叠控件。

引擎刻意设计成独立形态（`leaflet-multisearch`）：控件消费通用的记录契约，对本插件的数据模型一无所知 — 它被设计为可提取并作为独立 Leaflet 插件发布，TrackReplay 只保留一层薄适配器。

```javascript
L.trackReplay(map, data, {
  showSearch: true,
  searchElements: ['background_nodes'], // widen to ['background_nodes', 'events', …]
  searchZoom: 17,
});

// the pure engine is available on its own (no Leaflet, no DOM):
var idx = L.TrackReplay.Core.SearchIndex.createSearchIndex();
idx.set([{ text: '基站 #24 在线设备 7', ref: { id: 24 } }, { text: '基站 #24 在线设备 7', ref: { id: 99 } }]);
idx.search('基站 #24');   // → { total: 2, matches: [ … ] }  ← duplicates are separate hits
```

### 键盘（焦点作用域）

**没有全局键盘处理器**。快捷键的作用域是获得焦点的控件：点击它一次，其按键才会激活（焦点轮廓显示哪个控件拥有键盘）；点击别处即停止。文本输入始终优先 — 在搜索框、导入文本域或时间编辑器中输入数字绝不会触发播放操作。

| 焦点 | 按键 |
|-------|------|
| 播放条 | `Space` 播放/暂停 · `←`/`→` 跳转 ∓5 秒 · `0` → 1× · `1-9` 倍速档位 · `r` 停止 |
| 搜索控件 | `←`/`↑` 上一个命中 · `→`/`↓` 下一个命中（回绕）· `Enter` 下一个 · `Esc` 清空，再按折叠；在输入框内，方向键移动光标，`Enter` 仍然跳转 |
| 地图（点击它） | **仅** `Space` 播放/暂停 — Leaflet 原生的方向键平移和 `+`/`-` 缩放保持不变；`mapFocusSpace: false` 则完全不绑定任何按键 |
| 任何输入框 / 按钮 | 原生行为（输入、光标、激活）— 不会被拦截 |

每个按键都**就地**可发现：按钮在其提示中携带按键（`播放 (Space)`）并写入 `aria-keyshortcuts`；悬停在播放条（或搜索框）任意位置会显示该控件的完整按键列表。

### TimestampEdgeoJSON 格式

用额外属性扩展标准 GeoJSON 要素：

```typescript
{
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[lng, lat], ...] },
  properties: {
    layerPath: string[],            // required: hierarchical layer path
    isTimestampedgeojson: true,     // required: marks as timestamped data
    times: number[],                // required: Unix timestamps (ms or s)
    speeds?: number[],              // optional: km/h, length = coords.length - 1
    styles?: object[],              // optional: per-segment style overrides
    popups?: string[],              // optional: per-segment popup content
    pointPopups?: string[],         // optional: per-point popup content (length = coordinates.length)
    drawMovingIndicator?: boolean,  // optional: enable moving marker
    layerVisibility?: boolean,      // optional: default visibility (default true)
    style?: object,                 // optional: base style for entire track
    color?: string,                 // optional: single color for the whole track
  }
}
```

用 Python 从你自己的数据生成这一切：见
[`examples/convert.py`](#用-python-生成数据examplesconvertpy)。

### 播放速度

默认是 **60×**（`1s = 1min`）— 轨迹通常跨越数小时，此时 1× 无法观看。`speed: 1`（或任意档位值）可覆盖它。

选择器提供一组倍速档位。60× 以下的条目显示为普通倍率（`0.25×` …
`8×`）；60× 及以上切换为**时间压缩**，这是轨迹跨越数小时或数天时最自然的记法：

| 值 | 标签 |
|-------|-------|
| `60` | `1s = 1min` |
| `600` | `1s = 10min` |
| `3600` | `1s = 1h` |

```javascript
L.trackReplay(map, data, {
  // custom ladder — entries ≥ 60× are auto-labelled as time compression
  speedOptions: [1, 10, 60, 600, 3600],
  // …or take full control of the labels
  speedLabel: function (speed) { return speed + 'x'; },
});
```

在任何倍率下，时间仍按*真实经过时间 × 倍速*推进，因此 `minTickMs` 下限（默认 16 ms）只控制显示刷新频率 — 从不影响播放速率本身。

### 事件标记

带 `properties.element` 标记的非时间戳要素会归入对象下的独立元素图层 — 一个单独的树条目和批量显隐行，独立于节点聚合。典型用法是事件图层：

```json
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [116.44, 39.92] },
  "properties": {
    "layerPath": ["visitor", "Mark"],
    "element": "events",
    "popup": "<b>掉头事件</b><br>22:41:00",
    "style": { "color": "#e74c3c", "weight": 2, "radius": 14 }
  } }
```

点要素渲染为**圆环**：无填充的 `L.circleMarker`，半径以**像素**为单位（屏幕固定，类似 folium 的 `CircleMarker`）。默认样式为 `{radius: 10, color: '#e74c3c', weight: 2, fill: false}`；`properties.style` 可覆盖它（`fill: true` 为实心点，`radius` 控制大小）。点击圆环会打开其 `popup`。

- 标签来自 `elementLabels.events`（默认 `Events`）。
- 事件图层绘制在轨迹**上方**（标注保持可点击），而通用 `static` 元素（区域、面积）位于其下方。
- 地理圆环（半径以米为单位）或圆环*带*（带内环的多边形，folium 的甜甜圈技术）已经可以通过普通 GeoJSON 路径工作 — 带两个坐标环的 `Polygon` 今天就渲染为甜甜圈。

### 背景节点（`background_nodes`）

大量**不绑定任何时间序列**的独立位置点 — 采样点、POI、覆盖读数 — 用作轨迹*后方*的上下文。它们保持普通 GeoJSON；保留元素名 `background_nodes` 决定其渲染方式：

```json
// Form ① — one compact feature carrying all points (use for tens of thousands)
{ "type": "Feature",
  "geometry": { "type": "MultiPoint",
                "coordinates": [[116.40, 39.90], [116.41, 39.91], ...] },
  "properties": {
    "layerPath": ["background", "samples"],
    "element": "background_nodes",
    "popups": ["node 1", "node 2", ...],     // optional, length = coordinates
    "styles": [{...}, ...],                  // optional per-point style
    "style": { "fillColor": "#666" }         // optional base style
  } }

// Form ② — one Point feature per location (may be mixed with form ①)
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [116.40, 39.90] },
  "properties": {
    "layerPath": ["background", "stations"],
    "element": "background_nodes",
    "popup": "station 1"
  } }
```

- **渲染**：默认是小实心点（`{radius: 4, fillColor: '#6b7785'}`）；`properties.style`（以及逐点 `styles[i]`）可覆盖。
- **可点击，就像轨迹节点**：这些点通过与轨迹相同的矢量渲染器渲染，因此 Leaflet 的正常命中测试适用 — 点击节点会打开其弹窗，与点击轨迹节点完全一样。（专用的低 pane 会绘制在轨迹下方，但永远收不到点击，因为轨迹的 canvas 会盖住它。）
- **Z 顺序**：每个点在（重新）添加时都会被送到共享渲染器的底层，因此点绘制在**轨迹下方**；它们的聚合气泡位于 marker pane — 与轨迹节点聚合使用同一图层，因此点击气泡照常放大。
- **默认散点**：每个节点绘制为自己的点。聚合需主动开启 — `backgroundNodesOptions: { cluster: true }` 用 Leaflet.markercluster 对密集点云分组（带 spiderfy，与轨迹节点一样），这是数万节点的正确选择。
- **运行时切换**：*聚合 / 散点*设置面板（见下文）带有一个背景节点区域，其中是 **聚合 / 散点** 选择。切换会就地重建该元素 — 图层树、批量显隐和批量标签引用会重新指向，地图可见性保持不变，已勾选的标签单元格会在新图层上重新打开其弹窗。
- **批量控件与标签**：与每个元素相同 — 每个对象一个树条目，每种元素类型跨所有对象一个批量控件行，以及一个批量标签列（只要节点带弹窗就存在）。

```javascript
L.trackReplay(map, data, {
  // defaults shown; all optional
  backgroundNodesOptions: {
    style: { radius: 4, fillColor: '#6b7785' },
    cluster: false, // scatter (default) — true groups dense clouds
  },
});
```

注意：`background_nodes` 是一个**保留元素名** — 使用此名称的桶始终通过该图层渲染（Point/MultiPoint 几何；其他几何类型会跳过并给出控制台警告），不能用作普通静态桶。

### 批量标签显示

默认折叠的控件（`showInfoLabels`），用于**批量显示标签** — 当你仔细观察一个或少数对象，希望无需逐个点击就能读出其节点/事件/分段时很有用：

```
批量标签 (122)          ← click the title to expand; (n) = labels currently displayed
            轨迹  节点  事件  静态
☑ visitor › Bee   ☐   ☑    ☑
☑ visitor › Mark  ☑   ☐    ☑
☐ zones › study_area             ☐
```

- **行 = 对象，列 = 携带标签内容的元素类型**（列来自数据；纯视觉元素如已行进路径或指示器没有）。
- 标签**就是真实弹窗**：勾选单元格会对该组的每个图层调用 `openPopup()`，所以出现的就是手动点击会显示的同一个弹窗 — 相同内容、相同样式 — 取消勾选会关闭它们。不会复制或缩写任何内容。
- 点击**行标题**会切换整行（三态：全部 / 部分 / 无）；标题显示当前显示的标签数。
- 显示期间，这些弹窗处于“同时多个”模式（`autoClose: false`、`autoPan: false`、`closeOnClick: false`）：它们不会互相关闭，打开几十个也从不移动地图，点击地图也不会把它们扫走。关闭某个单元格会恢复正常弹窗行为，因此手动点击的弹窗照常工作。
- 标签**随图层一起移动**：隐藏元素（图层树或批量控件）也会隐藏其标签，并随图层一起恢复。这也涵盖缩放时聚合进出的节点。
- 渲染成本随*勾选单元格*数量增长，而不是随数据中对象数量增长 — 只要打开的行很少，数百条轨迹也安全。低缩放级别下预期会有重叠 — 这是同时显示大量弹窗的固有现象；放大或减少开启的行。

### 日期行、时区与节假日

时间轴下方有一行日期行，一行截屏高度的文本，回答“我到底处在什么时间？”：

```
00:00:00 ————————————————●———————      ← unchanged: time label + slider
周四 · 第 1/3 天 · holidays · National Day,国庆节,3 · Asia/Shanghai
                   └── 节日 · 假期名 ──┘
```

- **时区** — `displayTimeZone` 决定整条时间轴如何读取：时间标签、双击编辑器的解析、滑块上的午夜刻度，以及节假日查询使用哪个日历日。`'local'`（浏览器时区）是默认值；数字是固定偏移（`8` = UTC+8）；IANA 名称（`'Asia/Shanghai'`）从平台的 tz 数据库获取夏令时。`replay.setTimeZone(tz)` 可实时切换，无需重建。
- **天序号** — `第 N/M 天` 仅在数据跨越多个日历日时出现，每个午夜在滑块上有一个细线刻度（拥挤时会抽稀）。
- **节假日** — 插件*不*附带节假日数据（每年变化，各国不同）。宿主抓取后以 `calendar: { holidays, workdays }` 交入（日期以**显示时区**下的 `YYYY-MM-DD` 为键），并在更新时调用 `replay.setCalendar()`；日期行会显示来源字段作为前缀，因此调休不会被误认为休息日。
- **从哪里获取数据** — 对中国（含调休/补班），[chinese-days](https://www.npmjs.com/package/chinese-days) 的年度 JSON（`https://cdn.jsdelivr.net/npm/chinese-days/dist/years/<year>.json`）已经正好是这种双桶形状 — 无需转换。它启用了 CORS（`access-control-allow-origin: *`）且可缓存一周，因此宿主可以按年抓取并保存在 `localStorage` 中；未来年份在国务院发布前会 404。[holiday-cn](https://github.com/NateScarlet/holiday-cn) 是等价的扁平列表来源（`{name, date, isOffDay}`），如果你需要官方文档链接。

### 速度 → 颜色映射

`colorMode` 决定分段速度如何变成颜色。`fixed` 和 `adaptive` 共享同一条连续的 **Turbo 风格色带** — 幅度约定（类似 Traccar/Garmin）：慢 = 深蓝 → 青 → 绿 → 黄 → 橙 → 红 = 快。它们只在覆盖范围上不同：

| 模式 | 范围 |
|------|-------|
| `fixed` | `colorRange`，默认 **0–200 km/h**（可外部配置） |
| `adaptive` | 数据中所有速度的 P5–P95（自动） |
| `custom` | `colorConfig.vmin` … `vmax`，使用你自己的色标 |

```javascript
L.trackReplay(map, data, { colorMode: 'fixed', colorRange: [0, 120] });
```

图例始终报告当前生效范围，因此其标签会自动跟随 `colorRange`。

### 弹窗

- **轨迹分段** — 提供 `popups: string[]`（长度 = `coordinates.length - 1`，逐分段）。点击轨迹分段会打开对应弹窗。带要素级 `style`/`color` 的轨迹在存在 `popups` 时仍会逐分段拆分（基础样式保留在每个分段上）。
- **轨迹节点（点）** — 提供 `pointPopups: string[]`（长度 = `coordinates.length`，逐节点）。点击节点会打开自己的弹窗，而不是分段的。没有 `pointPopups` 时，节点回退到到达该节点的分段弹窗。
- **静态要素** — 在 `properties` 中设置 `popup: string`。
- 已行进/未行进路径覆盖层不可交互，绝不会吞掉点击，静态图层绘制在轨迹下方，因此即使区域多边形覆盖分段，分段弹窗仍然有效。

### 节点聚合

带时间戳轨迹的每个数据点都有自己的标记。坐标完全相同的点（例如往返轨迹两次经过同一地点）会保留为独立标记：即使在最大缩放级别它们仍保持聚合，点击这样的聚合会 spiderfy，以便逐个查看每次到访 — 与 folium 的 `MarkerCluster` 行为相同。Spider 腿用 SVG 渲染器渲染且不可交互，因此它们在 `preferCanvas` 地图上仍能工作，不会吞掉瞄准标记的点击。

### 底图与 GCJ-02（火星）坐标系

Leaflet 始终在 WGS-84 之上的 Web Mercator 中工作 — 但瓦片的*内容*是 WGS-84 还是 GCJ-02（高德/AMap、腾讯、Google 中国使用的混淆坐标系）由提供商决定。在 GCJ-02 瓦片上绘制 WGS-84 轨迹（或反之）会让它们偏移大约 300–600 米，因此 TrackReplay 将其建模为两个独立轴：

| 选项 | 含义 | 默认值 |
|--------|---------|---------|
| `dataDatum` | **输入**坐标的坐标系 | `'wgs84'` |
| `mapDatum` | **当前底图**的坐标系（高德瓦片为 `'gcj02'`） | `'wgs84'` |

两者不同时，数据会在**解析时一次性转换**（`DataParser`），因此所有下游图层 — 轨迹、节点、事件、已行进/未行进边、指示器 — 都在地图自身坐标系中工作，所有内部计算（速度、方位角、插值）保持一致。两个方向都支持；在中国以外转换是无操作。

```javascript
L.trackReplay(map, data, {
  dataDatum: 'wgs84',    // our GPS data
  mapDatum: 'gcj02',     // 高德 (GCJ-02) basemap
  baseLayers: [          // host creates/holds the tile layers …
    { label: '标准', layer: amapVector },
    { label: '卫星', layer: amapSatellite },
  ],
  baseLayersLabel: '底图', // … and the plugin renders them as the tree's radio group
});
```

值得了解的后果：

- `dataDatum` 是集合级而非逐要素的 — 混合坐标系输入需要单独的实例。
- 地图*报告*的坐标 — `map.getCenter()`、点击 `latlng`、测量工具读数 — 始终位于**地图坐标系**（GCJ-02 底图激活时为 GCJ-02）。将你自己的逻辑接入时，用 `L.TrackReplay.Utils.GCJ02.gcj02ToWgs84(lng, lat)` 转换回去。
- 弹窗原样传递；如果弹窗打印坐标，请明确决定打印哪个坐标系。
- 距离/面积不受影响（GCJ-02 偏移场在空间上变化非常缓慢）。
- 更改地图坐标系意味着数据必须重新投影：重新创建实例（`destroy()` 后用新的 `mapDatum` 重新初始化，如需保留播放时间 — 这正是演示的设置面板在切换源时所做的事情）。

### ColorBar 配置（自定义模式）

```javascript
var colorbarConfig = {
  colors: ['#0000FF', '#00FF00', '#FFFF00', '#FF0000', '#800080'],
  index: [-10, 0, 75.0, 150, 500],
  vmin: -10,
  vmax: 500,
};
```

### 进阶：独立使用核心模块

```javascript
// Parse data without rendering
var parsed = L.TrackReplay.Core.DataParser.parseFeatureCollection(data, colorMapper);

// WGS-84 ⇄ GCJ-02 (火星坐标系) conversion, for coordinates the map reports back
var gcj = L.TrackReplay.Utils.GCJ02.wgs84ToGcj02(116.40, 39.90);
var wgs = L.TrackReplay.Utils.GCJ02.gcj02ToWgs84(gcj[0], gcj[1]);

// GPX → GeoJSON: timed segments become replayable TimestampEdgeoJSON,
// time-less segments become static lines (see the report)
var gpx = L.TrackReplay.Utils.GPX.parseGPX(gpxText, { layerPath: ['gpx', 'watch'] });
// gpx.featureCollection — a GeoJSON FeatureCollection
// gpx.report — { segments, timedSegments, staticSegments, points, waypoints }

// Create individual layers manually
var trackLayer = L.TrackReplay.Layers.TrackLayer.createTrackLayer(parsed.layerFeatures[0].features);

// Custom time engine
var engine = L.TrackReplay.Core.TimeEngine.createTimeEngine({ speed: 2 });
engine.on('tick', function (d) {
  console.log('Time:', d.time, 'Progress:', d.progress);
});
```

## 开发

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Watch mode
npm run dev

# Check the user docs against the source (add --smoke to run the Hello World example)
node _docs_check.mjs

# Run Python demo server
cd examples
pip install fastapi uvicorn jinja2
python server.py
# Open http://localhost:8000
```

演示页面从 `examples/vendor/`（随仓库提交）加载 Leaflet 及其辅助插件 — **不需要外部 CDN**；只有底图瓦片需要网络访问。

### 用 Python 生成数据（`examples/convert.py`）

对于**你自己的**数据，演示服务器旁有一个仅依赖标准库的转换器：

```python
from convert import track, event, background_nodes, area, write_geojson

write_geojson({
    "type": "FeatureCollection",
    "features": [
        track([(t, lng, lat), ...], layer_path=["visitor", "Bee"], name="Bee"),
        event([116.410, 39.905], layer_path=["visitor", "Bee"], popup="掉头"),
    ],
}, "demo.geojson")
```

`track()` 接受 `(time, lng, lat)` 样本序列 — `time` 可以是 `datetime`、秒或毫秒 — 并填入格式所需的一切：毫秒为单位的 `times`、逐分段的 `speeds`（haversine ÷ 时间差）、逐分段的 `popups`（“时间 → 时间 / 速度 / 距离”）、可选的带累计距离的 `pointPopups`，以及 `drawMovingIndicator`。其余三个辅助函数各用几行覆盖剩余形态。运行 `python convert.py out.geojson` 会写出一个小型混合示例，可直接拖到演示地图上。

## 项目结构

```
├── src/
│   ├── TrackReplay.js          # Session facade + internal buildReplay builder
│   ├── TrackReplay.css         # Styles
│   ├── core/
│   │   ├── DataParser.js       # GeoJSON parsing & processing
│   │   ├── DatasetContainer.js # Runtime datasets (add/remove/clear/merge)
│   │   ├── SearchIndex.js      # Multi-occurrence text index (leaflet-multisearch engine)
│   │   ├── ColorMapper.js      # Speed-to-color mapping
│   │   ├── TimeEngine.js       # Shared time-axis engine
│   │   └── LayerTreeBuilder.js # Layer tree construction
│   ├── layers/
│   │   ├── TrackLayer.js       # Speed-colored track lines
│   │   ├── PointClusterLayer.js# Marker cluster for points
│   │   ├── MovingIndicator.js  # Animated moving marker
│   │   ├── DynamicRoute.js     # Traveled/untraveled route
│   │   ├── StaticLayer.js      # Regular GeoJSON layer
│   │   └── BackgroundNodesLayer.js # Clickable scatter/cluster dots (background nodes)
│   ├── controls/
│   │   ├── PlaybackControls.js # Play/pause/stop/speed UI
│   │   ├── TimelineControl.js  # Progress slider + time editor
│   │   ├── ControlBar.js       # Buttons + timeline in one box
│   │   ├── ViewFollowControl.js# Map view following
│   │   ├── ElementToggles.js   # Batch show/hide by element type
│   │   ├── InfoLabels.js       # Batch label display
│   │   ├── ClusterScatterControl.js # Cluster/scatter settings panel
│   │   ├── DataSourceControl.js# Datasets list + import panel (file/drop/paste/URL/samples)
│   │   ├── SearchControl.js    # Multi-search UI (leaflet-multisearch, extractable)
│   │   └── ColorLegend.js      # Speed color legend
│   └── utils/
│       ├── GeoUtils.js          # Distance, bearing, interpolation
│       ├── GCJ02.js             # WGS-84 ⇄ GCJ-02 conversion
│       ├── GPX.js               # GPX → GeoJSON conversion
│       ├── EventBus.js          # Session event bus
│       └── TimeUtils.js         # Timestamp formatting/parsing
├── examples/
│   ├── server.py               # Python demo host (FastAPI)
│   └── templates/
│       └── demo.html.jinja2    # Jinja2 template
├── docs/
│   ├── HUMAN-USAGE.zh.md / .en.md   # Getting-started guide
│   ├── LLM-PROMPT.zh.md / .en.md    # Self-contained spec pack for other models
│   ├── python-host/
│   │   └── GUIDE.zh.md / .en.md     # Build a Python host
│   ├── architecture.html            # Three architecture diagrams
│   ├── IMPLEMENTATION.md            # Implementation notes
│   └── 时间轴对齐的批量数据回放系统 核心设计.md  # Original design (Chinese)
├── dist/                       # Build output
└── package.json
```

## 许可证

MIT © Frank Yao
