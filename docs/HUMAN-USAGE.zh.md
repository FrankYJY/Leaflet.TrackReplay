<!-- canonical: 本文件；镜像：HUMAN-USAGE.en.md；一致性检查：node _docs_check.mjs -->

# Leaflet.TrackReplay 使用说明

这份文档回答四件事：**怎么跑起来**、**数据从哪来**、**常用配置怎么调**、**出问题怎么修**。
全量选项、方法与内部实现见 [README](../README.md)；想知道内部怎么搭的，看 [架构图](architecture.html)。

## 1. 这是什么

Leaflet.TrackReplay 是一个 Leaflet 插件：把**带时间戳的 GeoJSON 轨迹**放到地图上，用一条共享时间轴回放。多条轨迹可以同时播、按对象分层、逐元素开关；数据可以随时增删，播放时刻与界面状态不会丢。

插件不是独立应用，而是一个**会话**，附着在你自己建好的 `L.Map` 上。你的页面是**宿主（host）**：地图、底图、数据、选项都由它决定，插件只负责把数据变成可回放的图层与控件。下面第 2 节的示例就是一个最小可用的宿主页面。

适合：GPS 轨迹回放、车辆/人员移动复盘、带时间信息的点位与事件叠加展示。

## 2. 五分钟跑起来

下面这段是一个**最小宿主页面**：建地图 → 加底图 → 给数据 → 交给插件。存成 `index.html` 双击打开即可（需要联网加载 Leaflet 与插件）：

<!-- BEGIN HELLO-WORLD -->
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>TrackReplay minimal</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="https://unpkg.com/leaflet-trackreplay@0.1.0/dist/leaflet-trackreplay.css">
  <style>html, body, #map { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-trackreplay@0.1.0/dist/leaflet-trackreplay.iife.js"></script>
  <script>
    var map = L.map('map').setView([39.91, 116.41], 14);   // [lat, lng]
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    var data = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[116.40, 39.90], [116.41, 39.91], [116.42, 39.92]]  // [lng, lat]
        },
        properties: {
          layerPath: ['demo', 'track1'],
          isTimestampedgeojson: true,
          times: [1700000000000, 1700000060000, 1700000120000],  // ms, ascending
          drawMovingIndicator: true
        }
      }]
    };

    var replay = L.trackReplay(map, data, { speed: 60 });  // 60× = 1 s per minute
    replay.play();
  </script>
</body>
</html>
```
<!-- END HELLO-WORLD -->

### npm 与打包器

```bash
npm install leaflet leaflet-trackreplay
```

所有构建产物都要求执行时存在**全局 `L`**（插件不会替你 import Leaflet）。打包器里先让 `L` 成为全局，再执行插件模块：

```js
import L from 'leaflet';
window.L = L;
await import('leaflet-trackreplay');   // 需要支持顶层 await；否则用一个动态 import 的回调
```

用 `<script>` 标签时没有这个问题：先 Leaflet，后插件，顺序对就行。

### 地图空白的四个原因

1. 地图容器没有显式高度（`#map { height: 100% }` 且 `html, body` 也有高度）。
2. 插件 CSS 没加载（控件会错位或不可见）。
3. 数据没通过校验（打开控制台看有没有 `times.length` 报错）。
4. 插件不会自动取景——你需要在代码里 `setView` 或 `fitBounds`。

## 3. 数据从哪来

### 路径 1：数据源面板（零代码）

给构造选项加上 `showDataSource: true`，地图左上角会出现数据源面板：

- **拖拽** `.geojson` / `.json` / `.gpx` 到地图上；
- **文件选择**、**粘贴**文本、填 **URL**（需要 CORS 或同源）；
- 内置**示例数据**按钮（`dataSourceSamples`）。

面板里每份数据是一个**数据集**，可以单独删除；点击数据集行可以预览原始数据（截断显示），也能整份下载。导入失败或 GPX 无时间戳降级，都会在面板底部给一行报告。

### 路径 2：Python 生成

仓库自带 [`examples/convert.py`](../examples/convert.py)（只用标准库）：

```python
import sys
sys.path.insert(0, "examples")
from convert import track, event, background_nodes, area, write_geojson

fc = {
    "type": "FeatureCollection",
    "features": [
        track([(1700000000, 116.40, 39.90), (1700000060, 116.41, 39.91)], ["demo", "t1"]),
        event([116.41, 39.91], ["demo", "t1"], popup="到点"),
        background_nodes([[116.40, 39.90], [116.42, 39.92]], ["ctx", "samples"],
                         popups=["采样 1", "采样 2"]),
        area([[116.39, 39.89], [116.43, 39.89], [116.43, 39.93]], ["ctx", "area"]),
    ],
}
write_geojson(fc, "demo.geojson")
```

时间参数可以是 `datetime`、秒或毫秒，`convert.py` 统一转成毫秒；缺 `speeds` 时插件会自动算。

### 路径 3：自己写 GeoJSON

直接按第 4 节的规则写。可以先从最小轨迹开始，逐步加事件、背景节点、静态区域。

### 路径 4：GPX

面板导入最省事。代码里用：

```js
var r = L.TrackReplay.Utils.GPX.parseGPX(gpxText, { layerPath: ['imported', 'ride'] });
replay.addDataset(r.featureCollection);
```

没有 `<time>` 的段会变成静态线（不参与回放），`r.report.staticSegments` 告诉你降级了几段。

### 路径 5：让 AI 帮你写

把 [`docs/LLM-PROMPT.zh.md`](LLM-PROMPT.zh.md) 整份贴给大模型，后面接上你的需求即可——见第 9 节。

## 4. 数据格式速查

最小的时间轨迹：

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [[116.40, 39.90], [116.41, 39.91]]
  },
  "properties": {
    "layerPath": ["demo", "track1"],
    "isTimestampedgeojson": true,
    "times": [1700000000000, 1700000060000]
  }
}
```

**六条铁律**：

1. 时间轨迹必须是 `LineString`，至少 2 个点；其它几何类型会被静默丢弃。
2. 坐标顺序是 `[lng, lat]`——和 `setView` 的 `[lat, lng]` 相反。
3. `times` 长度 = 坐标点数，严格升序，单位毫秒（单位只看第一个值）。
4. `speeds` / `styles` / `popups` 长度 = 点数 − 1；`pointPopups` = 点数；**没有的数组直接省略，不要传 `[]`**。
5. `layerPath` 必须是字符串数组。
6. 没有 `times` 的要素是普通 GeoJSON：事件、静态区域、背景节点都走这条路，不参与回放。

事件点、背景节点、静态区域的最小写法与字段表见 [README 的数据格式一节](../README.md#timestampedgeojson-format) 与 [`docs/LLM-PROMPT.zh.md`](LLM-PROMPT.zh.md) 第 4–5 节。

## 5. 界面上有什么

| 控件 | 默认 | 说明 |
|---|---|---|
| 播放条 | 开 | 播放/暂停、停止、倍速档位、循环；与时间轴合并成一个控件 |
| 时间轴 | 开 | 拖动跳转；双击可输入时间；下方的**日期行**显示星期、第 N 天、节假日/调休、时区 |
| 图层树 | 开 | 每个对象按元素拆分（轨迹 / 节点 / 已行进 / 未行进 / 箭头 / 事件 / 静态 / 背景节点），可逐项开关 |
| 批量显隐 | 开 | 按**元素类型**跨所有对象三态开关，带 `on/total` 计数 |
| 批量标签 | 开 | 批量打开对象或元素类型的既有弹窗（是真的弹窗，不是仿制的标签） |
| 视角跟随 | 开 | 跟随最新 / 随机 / 指定对象，或关闭 |
| 聚合 / 散点 | 有背景节点时 | 背景节点在聚合与散点之间切换 |
| 颜色图例 | 开 | 当前速度色带 |
| 数据源面板 | 关 | 见第 3 节路径 1 |
| 多命中搜索 | 关 | 按标签文本搜索，每一处都算命中；Enter / ◀ / ▶ 循环跳转 |
| 键盘 | — | 无全局快捷键：先点中控件，键才生效（播放条 Space / ← → / 0-9 / R） |

## 6. 常用配置

### 速度

默认 `speed: 60`——**1 秒 = 1 分钟**。档位从 `0.25×` 到 `3600×`（1 秒 = 1 小时），`speedOptions` 可换。

### 颜色

```js
L.trackReplay(map, data, {
  colorMode: 'fixed',      // 'fixed' | 'adaptive' | 'custom'
  colorRange: [0, 120],    // fixed 模式的速度范围（km/h）
});
```

`adaptive` 按当前数据的 P5–P95 自适应；`custom` 需要 `colorConfig`（branca 风格色带）。

### 时区与节假日

```js
var replay = L.trackReplay(map, data, {
  displayTimeZone: 'local',   // 或 8，或 'Asia/Shanghai'
  showDateInfo: true,
});
```

节假日表由宿主抓取后注入（插件不内置，日期每年变）。[chinese-days](https://github.com/vsme/chinese-days) 的年度 JSON 与我们的形状完全一致：

```js
fetch('https://cdn.jsdelivr.net/npm/chinese-days/dist/years/2025.json')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (table) {
    if (table) { replay.setCalendar(table); }   // 不重建，日期行立即更新
  });
```

- 键是**显示时区下的日期**；同一天同时是节假日与调休时，调休优先。
- 建议按年缓存（`localStorage`），不要把年度 JSON 打进页面。
- `setTimeZone()` / `setCalendar()` 都是会话方法，不会重建图层。

### 底图与 GCJ-02

高德/腾讯等底图是 GCJ-02（火星坐标）。如果你的数据是 WGS-84：

```js
L.trackReplay(map, data, { dataDatum: 'wgs84', mapDatum: 'gcj02' });
```

转换在解析时做一次，之后所有图层都在底图坐标系里。底图交给插件管理时用 `baseLayers: [{ label, layer }]`，会出现在图层树的单选组里。

### 中文界面

所有 UI 文案都能替换：`playbackLabels`、`elementLabels`、`dataSourceLabels` / `dataSourceMessages`、`searchLabels` / `searchMessages`、`dateInfoLabels` / `dateInfoMessages`、`clusterScatterLabels`。键名见 [README 选项表](../README.md#options)。

## 7. 运行时增删数据

```js
var replay = L.trackReplay(map, null, { showDataSource: true }); // 空会话

var id = replay.addDataset(fc, { name: '第一趟' });  // 一份数据集
replay.addDataset([f1, f2]);                        // 仍是一份数据集，含两个要素
replay.removeDataset(id);                           // 只删这一份
replay.clearDatasets();                             // 清空，会话还在
```

- **合并规则**：不同数据集里 `layerPath` 相同的要素合并成同一个对象；删掉其中一份，对象保留剩余部分。
- **状态保留**：增删数据会重建图层，但播放时刻、倍速、循环、逐元素显隐、标签勾选、跟随模式、面板折叠都会恢复。
- 顶层数组的陷阱：`L.trackReplay(map, [f1, f2])` 是**两份数据集**；要一份数据集请用 `FeatureCollection` 或 `[[f1, f2]]`。

事件（与播放共用一条总线）：

```js
replay.on('datasetadd', function (e) { console.log(e.id, e.name, e.total); });
replay.on('tick', function (e) { /* e.time, e.progress */ });
```

## 8. 方法与事件

常用方法：

| 方法 | 作用 |
|---|---|
| `play()` / `pause()` / `stop()` | 播放控制 |
| `seek(ms)` / `seekByProgress(p)` | 跳转 |
| `setSpeed(n)` / `getSpeed()` | 倍速 |
| `getCurrentTime()` / `getProgress()` / `getState()` | 读数 |
| `addDataset()` / `removeDataset(id)` / `clearDatasets()` | 数据管理 |
| `setTimeZone(tz)` / `setCalendar(table)` | 时区与节假日（不重建） |
| `on(event, fn)` / `off(event, fn)` | 事件 |
| `destroy()` | 整体拆除 |

完整方法表（25 个）与事件表（10 个）见 [README](../README.md#instance-methods) 与 [`LLM-PROMPT.zh.md` 第 6 节](LLM-PROMPT.zh.md)。

## 9. 让 AI 帮你写（提示词包怎么用）

`docs/LLM-PROMPT.zh.md`（中文）与 `docs/LLM-PROMPT.en.md`（英文）是**自包含的规格包**：不依赖本仓库、不需要模型读源码。

**拼法**：

```text
<整份 LLM-PROMPT.zh.md 的内容>

--- 你的需求 ---
<你要做什么 + 原始数据样例（注明列顺序）+ 已有代码 / 报错>
```

**两个提问模板**：

```text
按上面的规格，把我下面这批 (时间, 经度, 纬度) 行生成可回放的 GeoJSON；
同时给一个能直接运行的 Python 脚本，运行后打印这份数据。

2025-10-01 08:00:00, 116.40, 39.90
2025-10-01 08:01:00, 116.41, 39.91
```

```text
按上面的规格写一个完整的 host 页面（index.html）：地图 + 轨迹回放 + 播放条，
底图用 OpenStreetMap，另外在地图上标 3 个事件点。
```

**注意**：

1. **只贴一种语言**，不要把中英文两份都贴进去。
2. 模型应在结尾给出**自检结果**；没有的话，让它按规格第 10 节补一遍。
3. 版本要对齐：包里的 CDN 地址是 `leaflet-trackreplay@0.1.0`；你的项目用别的版本时，把地址换成你的版本。
4. 不要在提示词里再贴 README 或仓库路径——包已经自包含了。

## 10. 排错

| 症状 | 原因 | 修法 |
|---|---|---|
| 地图空白 / 只有一条灰条 | 容器没高度、CSS 没加载 | 给容器显式高度；加载插件 CSS |
| 轨迹不显示 | 不是 `LineString`，或 `times` 长度不匹配 | 控制台看 `times.length` 报错；补齐长度 |
| 点跑到海里 | 坐标写成了 `[lat, lng]` | 改成 `[lng, lat]` |
| 播放一开始就结束 | `times` 没升序，或秒/毫秒判错 | 升序；统一单位（毫秒） |
| 轨迹没有速度色 | `style: {}` 或 `styles` 里写了 `color` | 删掉空 `style`，把颜色留给速度映射 |
| 静态要素没颜色 | 用了 `properties.color` | 改成 `properties.style.color` |
| 背景节点没弹窗 | `popups[]` 长度与点数不等 | 补齐或删掉整个数组 |
| 节点弹窗不对 | `pointPopups` 长度不是点数 | 长度改为点数 |
| 面板导入没反应 | 文本超过 `dataSourceImportMaxChars`（默认 5e7 字符） | 减小数据量或调高上限 |
| 高德底图上轨迹整体偏移 | 坐标系没配对 | `mapDatum: 'gcj02'`（必要时 `dataDatum`） |

## 11. 更多

- [README](../README.md) — 全量选项、方法、事件与实现说明
- [架构图](architecture.html) — 分层总览、数据的旅程、一次 rebuild 的生命周期
- [Python host 说明书](python-host/GUIDE.zh.md) — 用一个 Python 服务提供页面、资产与数据接口
- [`examples/convert.py`](../examples/convert.py) — Python 数据转换器
- [`examples/`](../examples/) — 本地 demo 服务器（`python examples/server.py`）
- [`docs/LLM-PROMPT.zh.md`](LLM-PROMPT.zh.md) — 给大模型的规格包
