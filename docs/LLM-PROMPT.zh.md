# Leaflet.TrackReplay 集成规格（v0.1.0）

> **给大模型**：这是 Leaflet.TrackReplay 的完整对外契约。读本文档即可生成可运行的数据与集成代码，无需访问任何代码库。本文档自包含——所有标识符、默认值、数组长度规则与失败行为都在这里。

## 1. 你的任务与规则

你正在帮助用户使用 **Leaflet.TrackReplay**：一个把带时间戳的 GeoJSON 轨迹按共享时间轴回放的 Leaflet 插件。

用户的需求会接在本文档后面（可能以 `--- USER REQUIREMENT ---` 分隔，也可能直接给出）。先判定任务类型（见第 9 节），再作答。

规则，按优先级：

1. **闭世界**：只使用本文档列出的标识符——选项、方法、事件、属性名。文档没写的，一律视为不存在；需要时先说明缺什么并向用户确认，**不要发明**（未知选项会被静默忽略，错误不会报出来）。
2. 生成的代码必须完整可运行：不留 `...`，不引用不存在的文件或变量。
3. 数据里的坐标一律 `[lng, lat]`；`map.setView` / `L.marker` 里的坐标一律 `[lat, lng]`。两者顺序相反，写错不一定报错，只会让点跑到海里。
4. 回答前逐条执行第 10 节的自检清单，并在结尾报告结果与你的假设。
5. 用户需求超出本文档（例如要求未文档化的定制）时，明确说明"本文档未覆盖"，不要猜。

## 2. 最小契约（可单独截取使用）

<!-- BEGIN MINIMAL CONTRACT -->

**依赖与引入顺序**

1. Leaflet 1.7+ 必须先加载；插件把接口挂在全局 `L` 上（所有构建产物都要求执行时存在全局 `L`，ESM 包也不会替你 import Leaflet）。
2. 插件的 CSS 必须加载；地图容器必须有显式高度（否则地图是空白的一条）。
3. 打包器场景：先让 `L` 成为全局，再执行插件模块，例如
   `import L from 'leaflet'; window.L = L; await import('leaflet-trackreplay');`。
4. 你要产出的是一个 **host 页面**：地图、底图、容器高度都由它创建。插件**不提供底图**，也**不会**调用 `fitBounds`。

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

**10 条不变量**

1. 一条时间轨迹 = 一个 `LineString` Feature；带时间戳的其它几何类型会被**静默丢弃**。
2. `coordinates` 是 `[[lng, lat], ...]`，至少 2 个点。
3. `properties.isTimestampedgeojson` 必须为布尔 `true`（拼写全小写 `edgeojson`）。
4. `properties.times` 是数字数组，长度必须等于坐标点数，**严格升序**，单位毫秒（见第 4 节的时间单位规则）。
5. `properties.layerPath` 必须是字符串数组，例如 `["group", "object"]`；传字符串会在解析时崩溃。
6. `speeds` / `styles` / `popups` 长度 = 点数 − 1；`pointPopups` 长度 = 点数。**没有就省略，绝不传空数组 `[]`。**
7. 省略 `speeds` 时，插件按 Haversine 距离 ÷ 时间差自动计算（km/h）。
8. 没有时间戳的要素是普通 GeoJSON，用于事件、静态区域、背景节点；它们不参与回放时间轴。
9. 插件不提供底图、不自动取景；地图容器高度与插件 CSS 由宿主负责。
10. 时间轴的范围 = 所有时间轨迹的 `times[0]` 最小值到 `times[last]` 最大值；增删数据集会重建，播放时刻、倍速、显隐等状态自动保留。

<!-- END MINIMAL CONTRACT -->

## 3. 入口与会话语义

### 3.1 构造：三种形态

```js
L.trackReplay(map, featureCollection, options);  // 一份数据集
L.trackReplay(map, [fc1, fc2], options);         // 两份数据集
L.trackReplay(map, null, options);               // 空会话，稍后 addDataset
```

**陷阱**：顶层数组是"数据集列表"，不是"要素列表"。`L.trackReplay(map, [f1, f2])` 会把两个 Feature 各自当成一份数据集；想让两个要素属于同一份数据集，用 `FeatureCollection`，或再包一层：`L.trackReplay(map, [[f1, f2]])`。

### 3.2 运行时增删

```js
var id = replay.addDataset(featureCollectionOrFeatureOrArray, { name: 'x' }); // → 数字 id
replay.addDataset([f1, f2]);        // 一个数据集，含两个要素
replay.removeDataset(id);           // 只删这一份数据集的贡献
replay.clearDatasets();             // 清空数据，会话仍可用
replay.listDatasets();              // [{ id, name, featureCount }]
replay.getDataset(id);              // { id, name, featureCollection } | null
replay.destroy();                   // 拆除全部图层、控件、监听
```

- 一次 `addDataset` = 一个数据集 = 删除的原子单位。
- 不同数据集里 `layerPath` 完全相同的要素会**合并成同一个对象**；删除其中一份后，对象保留剩余部分。
- 新增数据超出当前时间轴范围时，时间轴范围自动更新。
- `clearDatasets()` 之后会话仍可继续用（可再加数据）；`destroy()` 是整体拆除，之后不可再用。

### 3.3 `layerPath` 的缺省值因入口而异

| 入口 | 缺 `layerPath` 时 |
|---|---|
| `L.trackReplay` / `addDataset`（程序化） | 解析器回退为 `['default']` |
| 数据源面板导入（粘贴 / 文件 / URL / 拖拽） | 补为 `['imported', 文件名或 'Pasted data']` |

### 3.4 空会话

`L.trackReplay(map, null)` 不会构建任何回放控件（没有播放条、时间轴、图例、图层树），但会话级控件（数据源面板、搜索）如果开启仍会出现。第一次 `addDataset` 才构建。

空会话下的返回值：`getCurrentTime()` → `null`，`getState()` → `'stopped'`，`getProgress()` → `0`，`getSpeed()` → `1`，`getLegend()` → `[]`；`play()` / `pause()` 等是空操作。

### 3.5 GPX（仅浏览器）

```js
var r = L.TrackReplay.Utils.GPX.parseGPX(gpxText, { layerPath: ['gpx', 'ride'] });
replay.addDataset(r.featureCollection);
// r.report = { segments, timedSegments, staticSegments, points, waypoints }
```

没有 `<time>` 的 GPX 段会降级为静态线（不参与回放），`report.staticSegments` 会告诉你降级了几段。

## 4. 带时间轨迹的格式

### 4.1 一份完整的数据集

<!-- BEGIN JSON-EXAMPLE -->
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[116.400, 39.900], [116.410, 39.910], [116.420, 39.920]]
      },
      "properties": {
        "layerPath": ["demo", "track1"],
        "isTimestampedgeojson": true,
        "times": [1700000000000, 1700000060000, 1700000120000],
        "speeds": [12.5, 13.8],
        "popups": ["segment 1", "segment 2"],
        "pointPopups": ["node 1", "node 2", "node 3"],
        "style": { "color": "#3388ff", "weight": 4 },
        "drawMovingIndicator": true
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [116.410, 39.910] },
      "properties": {
        "layerPath": ["demo", "track1"],
        "element": "events",
        "popup": "<b>arrived</b>",
        "style": { "color": "#e74c3c", "radius": 12 }
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "MultiPoint",
        "coordinates": [[116.405, 39.905], [116.415, 39.915]]
      },
      "properties": {
        "layerPath": ["context", "samples"],
        "element": "background_nodes",
        "popups": ["sample 1", "sample 2"],
        "style": { "fillColor": "#6b7785" }
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[116.395, 39.895], [116.425, 39.895], [116.425, 39.925], [116.395, 39.925], [116.395, 39.895]]]
      },
      "properties": {
        "layerPath": ["context", "area"],
        "popup": "study area",
        "style": { "color": "#ff7800", "fillOpacity": 0.1 }
      }
    }
  ]
}
```
<!-- END JSON-EXAMPLE -->

这个例子包含：一条时间轨迹、一个事件点、一组背景节点、一个静态多边形。它们可以放在同一个 `FeatureCollection` 里。

### 4.2 时间轨迹字段

| 属性 | 必填 | 类型 | 长度 | 说明 |
|---|---|---|---|---|
| `layerPath` | 是 | `string[]` | — | 层级路径；同一路径 = 同一个对象 |
| `isTimestampedgeojson` | 是 | `boolean` | — | 必须 `true` |
| `times` | 是 | `number[]` | 坐标点数 | 时间戳；单位规则见 4.3 |
| `speeds` | 否 | `number[]` | 点数 − 1 | km/h；省略则自动计算 |
| `styles` | 否 | `object[]` | 点数 − 1 | 逐段 Leaflet path 样式，叠加在基础样式上 |
| `popups` | 否 | `string[]` | 点数 − 1 | 逐段弹窗（HTML） |
| `pointPopups` | 否 | `string[]` | 坐标点数 | 逐点弹窗（HTML） |
| `style` | 否 | `object` | — | 整条轨迹的基础样式 |
| `color` | 否 | `string` | — | `style.color` 的简写（**仅时间轨迹**支持） |
| `drawMovingIndicator` | 否 | `boolean` | — | 显示移动指示器（默认关闭） |
| `layerVisibility` | 否 | `boolean` | — | 初始可见性；只有严格 `false` 会隐藏 |

### 4.3 时间单位与排序

- 单位**只看 `times[0]`**：`> 1e12` 视为毫秒，否则视为秒（整组乘 1000）。不检测混用。
- 2001-09-09 之前的毫秒值 ≤ 1e12，会被当成秒——这类数据请直接传秒。
- 时间**必须严格升序**（插件不校验）。插件用 `times[0]` 和 `times[last]` 作为时间轴首尾；乱序会导致播放立刻结束或进度异常。
- 重复时间戳不报错，但该段速度为 0。

### 4.4 样式与弹窗的优先级

- 基础样式 = `properties.style`（优先）或 `properties.color`（`{ color }` 简写）；都没有则为空。
- 逐段样式 = `基础样式` 被 `styles[i]` 覆盖。`styles[i]` 只写 `weight` 时，颜色仍由速度映射决定。
- 没有 `styles` 且有基础样式 → 整条不拆段，使用基础样式。
- 没有基础样式也没有 `styles` → 每段按速度着色。
- 有 `popups` → 即使有基础样式也会逐段拆分（弹窗必须逐段绑定）。
- 注意：`style: {}`（空对象）是 truthy，会**关闭**速度着色。

### 4.5 校验与失败行为

| 情况 | 实际行为 |
|---|---|
| `times.length !== coordinates.length` | `console.error`，**该要素被跳过**（不会降级成静态要素） |
| 坐标点少于 2 个 | 静默跳过 |
| 带时间戳的几何不是 `LineString` | 静默跳过 |
| `times` 非升序 | 不校验；时间轴取首尾，播放可能立刻结束 |
| `pointPopups.length` 不等于点数 | `console.error`，整组置空；轨迹仍显示，节点弹窗回退为所在段的 `popups[i]` |
| `speeds` / `styles` / `popups` 长度不对 | 不校验；缺的段没有速度色或弹窗，多出的忽略 |
| 传空数组 `[]` | 空数组是 truthy：`speeds: []` 抑制自动计算、`styles: []` 强制拆段、`pointPopups: []` 报错。**没有就省略** |
| `layerPath` 是字符串 | 解析时崩溃（对字符串调用 `.join`）；必须是数组 |
| `background_nodes` 的 `popups[]` / `styles[]` 长度不对 | 整组忽略（`console.error`），使用默认样式 |
| `background_nodes` 不是 Point / MultiPoint | `console.warn`，跳过该要素 |

## 5. 静态要素、事件与背景节点

### 5.1 普通静态要素

不带 `isTimestampedgeojson` 的要素是普通 GeoJSON：支持任意几何类型（Point / MultiPoint / LineString / Polygon / MultiPolygon / GeometryCollection）。

| 属性 | 说明 |
|---|---|
| `layerPath` | 同时间轨迹；同一路径归入同一个对象 |
| `popup` | 弹窗内容（HTML 字符串），点击该要素时打开 |
| `style` | Leaflet path / circleMarker 样式 |
| `layerVisibility` | 初始可见性（严格 `false` 才隐藏） |

- **静态要素不读 `properties.color`**，颜色必须写在 `properties.style.color`。
- Point / MultiPoint 默认渲染成空心圆环：`{ radius: 10, color: '#e74c3c', weight: 2, fill: false }`；`style` 可覆盖（`fill: true` 变实心）。

### 5.2 `element`：要素进哪个桶

| `element` | 去向 |
|---|---|
| 缺省 或 `"static"` | 通用静态桶，绘制在轨迹**下方** |
| `"events"` | 该对象的事件元素层，绘制在轨迹**上方** |
| `"background_nodes"` | 保留值，交给背景节点层（见 5.3） |
| 任意其它字符串 | 该对象的一个自定义元素层，绘制在轨迹上方，标签 = `elementLabels[名称]` 或名称本身 |

- `element` 只对**没有时间戳**的要素生效；时间轨迹永远进入轨迹/节点层。
- `elementLabels` 只覆盖 8 个固定键（`track`、`points`、`static`、`events`、`background_nodes`、`traveled`、`untraveled`、`indicator`）；自定义桶名无法通过它改名。

### 5.3 背景节点（`element: "background_nodes"`）

两种写法，可混用：

```json
{ "type": "Feature",
  "geometry": { "type": "MultiPoint", "coordinates": [[116.40, 39.90], [116.41, 39.91]] },
  "properties": {
    "layerPath": ["background", "samples"],
    "element": "background_nodes",
    "popups": ["sample 1", "sample 2"],
    "styles": [{ "radius": 6 }, { "radius": 3 }],
    "style": { "fillColor": "#6b7785" }
  } }
```

```json
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [116.40, 39.90] },
  "properties": {
    "layerPath": ["background", "samples"],
    "element": "background_nodes",
    "popup": "sample 1",
    "style": { "fillColor": "#e67e22", "radius": 5 }
  } }
```

- 只接受 **Point / MultiPoint**；其它几何被跳过并 `console.warn`。
- `popups[]` 与 `styles[]` 的长度必须等于坐标点数，否则**整组忽略**。
- 默认渲染为轨迹下方的小圆点，可点击；默认散点，聚合需要运行时存在 `L.markerClusterGroup`（`backgroundNodesOptions.cluster: true`）。
- 样式优先级：默认样式 < `properties.style` < `properties.styles[i]`。

## 6. 运行时 API

### 6.1 最常用的选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `speed` | `60` | 初始倍速；60× 即"1 秒 = 1 分钟" |
| `speedOptions` | `[0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600]` | 倍速档位 |
| `loop` | `false` | 播完自动重播 |
| `colorMode` | `'fixed'` | `'fixed'` / `'adaptive'` / `'custom'` |
| `colorRange` | `[0, 200]` | `'fixed'` 模式下颜色映射的速度范围（km/h） |
| `showControls` | `true` | 播放条 |
| `showTimeline` | `true` | 时间轴（与播放条合并成一个控件） |
| `controlBarPosition` | `'bottomleft'` | 播放条位置 |
| `showLegend` | `true` | 速度颜色图例 |
| `showDataSource` | `false` | 数据源面板（会话级，重建不销毁） |
| `showSearch` | `false` | 多命中搜索（会话级） |
| `displayTimeZone` | `'local'` | 时间轴读取时区；`'local'` / 小时偏移 / IANA 名 |
| `calendar` | — | 节假日表（见第 7 节） |
| `dataDatum` / `mapDatum` | `'wgs84'` | 输入坐标与底图基准；高德底图用 `'gcj02'` |
| `baseLayers` | — | `[{ label, layer }]` 底图单选组 |

### 6.2 完整选项清单（68 项）

**以下清单是闭世界的边界：不在此列的选项名不存在。**

<!-- BEGIN OPTIONS -->

**播放与颜色**

| 选项 | 默认 | 说明 |
|---|---|---|
| `colorMode` | `'fixed'` | `'fixed'` / `'adaptive'` / `'custom'` |
| `colorConfig` | — | `'custom'` 模式的 branca 风格色带配置 |
| `colorRange` | `[0, 200]` | `'fixed'` 模式的 km/h 范围 |
| `speed` | `60` | 初始倍速 |
| `speedOptions` | `[0.25, 0.5, 1, 2, 4, 8, 60, 600, 3600]` | 倍速档位 |
| `speedLabel` | — | `fn(speed) => string` 自定义档位标签 |
| `playbackLabels` | 英文 | 播放条 tooltip `{ stop, play, pause, speed, loop, hint }` |
| `minTickMs` | `16` | tick 最小间隔，防止高倍速刷爆循环 |
| `loop` | `false` | 播完自动重播 |
| `tickLen` | `250` | tick 间隔（ms） |

**播放条、图例与跟随**

| 选项 | 默认 | 说明 |
|---|---|---|
| `showControls` | `true` | 播放条 |
| `showLoop` | `true` | 显示循环开关 |
| `showTimeline` | `true` | 时间轴 |
| `controlBarPosition` | `'bottomleft'` | 播放条位置 |
| `showLegend` | `true` | 颜色图例 |
| `legendTitle` | `'Speed (km/h)'` | 图例标题 |
| `legendSteps` | `10` | 图例档数（`getLegend` 返回 `steps + 1` 项） |
| `showViewFollow` | `true` | 视角跟随控件 |
| `viewFollowTitle` | `'Follow:'` | 跟随控件标题 |
| `viewFollowExpanded` | `false` | 跟随面板初始展开 |

**图层与样式**

| 选项 | 默认 | 说明 |
|---|---|---|
| `bearingTransform` | — | `fn(bearing) => number \| null`，旋转前变换方位角 |
| `rotationOffset` | `0` | 方位角附加角度（图标朝右时用 `90`） |
| `trackLayerOptions` | — | `{ defaultStyle }` 轨迹段的兜底样式 |
| `pointClusterOptions` | — | `{ pointStyle, clusterStyle }` 节点与聚合样式 |
| `staticLayerOptions` | — | 传给静态桶 `L.geoJSON` 的选项 `{ style, pointToLayer, onEachFeature, … }` |
| `traveledStyle` | `{color:'#e74c3c',weight:4}` | 已行进路线样式 |
| `untraveledStyle` | `{color:'#3498db',weight:4}` | 未行进路线样式 |
| `movingIcon` | — | 移动指示器图标 |
| `elementLabels` | 英文 | 8 个固定元素标签 |
| `backgroundNodesOptions` | — | `{ style, cluster=false, clusterOptions }` |

**批量显隐、标签与聚合面板**

| 选项 | 默认 | 说明 |
|---|---|---|
| `showClusterScatterControl` | `true` | 聚合/散点面板（有背景节点时） |
| `clusterScatterPosition` | `'topright'` | 面板位置 |
| `clusterScatterTitle` | `'Cluster / Scatter'` | 面板标题 |
| `clusterScatterExpanded` | `false` | 面板初始展开 |
| `clusterScatterLabels` | `{cluster:'Cluster',scatter:'Scatter'}` | 面板文案 |
| `showElementToggles` | `true` | 批量显隐控件 |
| `elementTogglesPosition` | `'topright'` | 控件位置 |
| `elementTogglesTitle` | `'Batch'` | 控件标题 |
| `elementTogglesExpanded` | `false` | 面板初始展开 |
| `showInfoLabels` | `true` | 批量标签控件 |
| `infoLabelsPosition` | `'topright'` | 控件位置 |
| `infoLabelsTitle` | `'Labels'` | 控件标题 |

**坐标系与底图**

| 选项 | 默认 | 说明 |
|---|---|---|
| `dataDatum` | `'wgs84'` | 输入坐标基准（`'wgs84'` / `'gcj02'`） |
| `mapDatum` | `'wgs84'` | 底图基准（高德用 `'gcj02'`） |
| `baseLayers` | — | `[{ label, layer }]` 底图单选组 |
| `baseLayersLabel` | `'Basemap'` | 底图组标签 |
| `layerControlCollapsed` | `true` | 图层树初始折叠；传 `false` 展开 |

**数据源面板**

| 选项 | 默认 | 说明 |
|---|---|---|
| `showDataSource` | `false` | 显示数据源面板 |
| `dataSourcePosition` | `'topleft'` | 面板位置 |
| `dataSourceTitle` | `'Data source'` | 面板标题 |
| `dataSourceExpanded` | `false` | 面板初始展开 |
| `dataSourceLabels` | 英文 | 面板 UI 文案 |
| `dataSourceMessages` | 英文 | 文本构造函数（含 `formatHelp` / `formatShapes`） |
| `dataSourceSamples` | — | `[{ label, data }]` 示例数据按钮 |
| `dataSourcePreview` | `{maxFeatures:50,maxChars:20000,summaryScan:5000,downloadMaxChars:2e7,downloadMaxMs:3000}` | 预览与导出上限 |
| `dataSourceImportMaxChars` | `5e7` | 导入文本字符上限，超过直接拒绝 |

**搜索**

| 选项 | 默认 | 说明 |
|---|---|---|
| `showSearch` | `false` | 多命中搜索控件 |
| `searchPosition` | `'topleft'` | 控件位置 |
| `searchElements` | `['background_nodes']` | 参与索引的元素类型 |
| `searchZoom` | — | 每次跳转的 `setView` 缩放级别 |
| `searchLabels` | 英文 | 控件文案 |
| `searchMessages` | 英文 | 计数文案 |

**时间与日期**

| 选项 | 默认 | 说明 |
|---|---|---|
| `displayTimeZone` | `'local'` | 显示时区：`'local'` / 小时偏移 / IANA 名 |
| `showDateInfo` | `true` | 时间轴下方的日期行 |
| `dateInfoLabels` | 英文 | `{ weekdays, holidaysField, workdaysField }` |
| `dateInfoMessages` | 英文 | `{ dayOf(n, total) }` |
| `calendar` | — | `{ holidays, workdays }` 节假日表 |

**其它**

| 选项 | 默认 | 说明 |
|---|---|---|
| `mapFocusSpace` | `true` | 地图获得焦点时 Space 播放/暂停 |

<!-- END OPTIONS -->

### 6.3 会话方法（25 个）

<!-- BEGIN METHODS -->

| 方法 | 说明 |
|---|---|
| `play()` | 开始/继续播放 |
| `pause()` | 暂停 |
| `stop()` | 停止并回到起点 |
| `seek(timeMs)` | 跳到指定时间戳 |
| `seekByProgress(p)` | 跳到进度 `p`（0–1） |
| `setSpeed(n)` | 设置倍速 |
| `getSpeed()` | 当前倍速 |
| `setLoop(b)` | 设置循环 |
| `getLoop()` | 当前循环状态 |
| `getCurrentTime()` | 当前时间（ms） |
| `getProgress()` | 当前进度（0–1） |
| `getState()` | `'playing'` / `'paused'` / `'stopped'` |
| `getLegend(steps?)` | `[{ speed, color, label }]`，`steps + 1` 项 |
| `addDataset(data, opts?)` | 加一份数据集；返回数字 id |
| `removeDataset(id)` | 删除一份数据集 |
| `clearDatasets()` | 清空全部数据集 |
| `listDatasets()` | `[{ id, name, featureCount }]` |
| `getDataset(id)` | 一份数据集的原始数据 |
| `setTimeZone(tz)` | 切换显示时区（不重建） |
| `getTimeZone()` | 当前时区写法 |
| `setCalendar(table)` | 替换节假日表（不重建） |
| `getCalendar()` | 当前节假日表 |
| `on(event, fn)` | 注册事件 |
| `off(event, fn)` | 移除事件 |
| `destroy()` | 拆除全部图层、控件、监听 |

<!-- END METHODS -->

### 6.4 事件（10 个）

| 事件 | 数据 |
|---|---|
| `start` | `{ time }` |
| `pause` | `{ time }` |
| `stop` | `{ time }` |
| `finished` | `{ time }` |
| `tick` | `{ time, progress }` |
| `timechange` | `{ time, progress }` |
| `speedchange` | `{ speed }` |
| `datasetadd` | `{ id, name, featureCount, total }` |
| `datasetremove` | `{ id, name, featureCount, total }` |
| `datasetsclear` | `{ removed }` |

`time` 是毫秒时间戳；`tick` 在每一帧触发，`timechange` 在 seek / stop 时触发。

## 7. 时间与节假日（仅当需求涉及日期、时区或节假日时使用）

`displayTimeZone` 影响四处，且总是一起移动：时间标签、双击编辑、日界刻度、节假日查表键。取值：

- `'local'`（默认）：浏览器时区。
- 数字：固定 UTC 偏移小时数，例如 `8`。
- 字符串：IANA 名，例如 `'Asia/Shanghai'`。

节假日表由宿主抓取后注入，插件不内置（日期每年变）。形状与 `chinese-days` 的年度 JSON 完全一致：

```js
// https://cdn.jsdelivr.net/npm/chinese-days/dist/years/<year>.json
// → { "holidays": { "2025-10-01": "National Day,国庆节,3" }, "workdays": { ... } }
fetch('https://cdn.jsdelivr.net/npm/chinese-days/dist/years/2025.json')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (table) {
    if (table) { replay.setCalendar(table); }   // 不需要重建；日期行立即更新
  });
```

- 键是**显示时区下的日期**（`YYYY-MM-DD`）；同一天同时出现在两张表里时 `workdays` 优先。
- `setCalendar` 与 `setTimeZone` 都是会话方法，不触发重建。
- 年份 JSON 404 表示该年还没发布，当作无数据即可。

## 8. Python 配方：把原始行变成数据

<!-- BEGIN PYTHON -->
```python
# Rows -> TimestampEdgeoJSON FeatureCollection. Standard library only.
# Each row is (time, lng, lat); time may be a datetime, seconds or ms.
# The output uses integer milliseconds and strictly ascending timestamps.
import json
import sys
from datetime import datetime, timezone


def to_ms(t):
    if isinstance(t, datetime):
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return int(t.timestamp() * 1000)
    t = float(t)
    # The library reads the first value: > 1e12 means ms, otherwise seconds.
    return int(t) if abs(t) > 1e12 else int(t * 1000)


def track(rows, layer_path):
    rows = sorted(rows, key=lambda r: to_ms(r[0]))
    times = [to_ms(r[0]) for r in rows]
    coords = [[float(r[1]), float(r[2])] for r in rows]  # [lng, lat]
    if len(coords) < 2:
        raise ValueError("a track needs at least 2 points")
    if any(times[i] >= times[i + 1] for i in range(len(times) - 1)):
        raise ValueError("timestamps must be strictly ascending")
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "layerPath": layer_path,
            "isTimestampedgeojson": True,
            "times": times,
            "drawMovingIndicator": True,
        },
    }


def main():
    rows = [
        # (time_ms,       lng,     lat)
        (1700000000000, 116.400, 39.900),
        (1700000060000, 116.410, 39.910),
        (1700000120000, 116.420, 39.920),
    ]
    fc = {
        "type": "FeatureCollection",
        "features": [track(rows, ["demo", "track1"])],
    }
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fc, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```
<!-- END PYTHON -->

用法：把 `rows` 换成你的原始数据，运行脚本，**打印出来的 JSON 就是可直接使用的数据**——保存为 `.geojson`、粘贴进数据源面板，或作为 `L.trackReplay` 的数据参数。

规则：

- 只用标准库；输出到 stdout。
- 一律输出整数毫秒（2001-09-09 之前的数据例外，见 4.3）。
- 生成事件 / 背景节点 / 静态区域时，照第 4.1 节的 JSON 形状追加要素；事件与背景节点不需要 `times`。

## 9. 输出契约

按用户的任务类型交付：

| 任务类型 | 交付物 |
|---|---|
| 只要数据 | 完整的 `FeatureCollection`（JSON 代码块），或能直接运行的 Python 脚本（二选一，或都给）；附一句怎么用 |
| 只要页面 / 集成 | **单个完整 host 页面（HTML）**（`<!DOCTYPE html>` 到 `</html>`），双击可打开；CDN 地址用第 2 节的 |
| 改现有代码 | 最小 diff + 插入位置说明；不要重排无关代码 |
| 只要解释 | 只解释，不生成代码 |

任何回答的结尾都必须包含：

1. **假设**：你替用户做的选择（时间单位、数据量、底图等）。
2. **自检结果**：第 10 节清单逐条勾选的结果。

## 10. 自检清单与常见错误

### 10.1 回答前逐条核对

- [ ] 每条时间轨迹都是 `LineString`，坐标至少 2 个点。
- [ ] 每个坐标都是 `[lng, lat]`（不是 `[lat, lng]`）；经度在 −180..180，纬度在 −90..90。
- [ ] `times.length === coordinates.length`，严格升序，单位一致。
- [ ] `speeds` / `styles` / `popups` 长度 = 点数 − 1；`pointPopups` = 点数；**没有的数组直接省略**。
- [ ] 每个要素都有 `layerPath`，且是字符串数组。
- [ ] `isTimestampedgeojson` 拼写正确且为布尔 `true`。
- [ ] 静态要素的颜色写在 `style.color`，没有用 `color`。
- [ ] 只用了第 6 节的选项、方法与事件名；没有发明标识符。

### 10.2 常见错误对照

| 症状 | 原因 | 修法 |
|---|---|---|
| 地图空白，只有一条 | 容器没有高度 / CSS 没加载 | 给容器显式高度，加载插件 CSS |
| 轨迹完全不显示 | 几何不是 `LineString`，或 `times` 长度不匹配 | 拆成逐条 `LineString`；补齐 `times` |
| 点跑到海里 | 写成了 `[lat, lng]` | 反转成 `[lng, lat]` |
| 播放一开始就结束 | `times` 没升序，或单位被当成毫秒/秒判错 | 升序排序；统一单位 |
| 轨迹是灰的、没有速度色 | `style: {}` 或 `styles` 里写了 `color` | 删掉空 `style`；把颜色留给速度映射 |
| 静态要素没颜色 | 用了 `properties.color` | 改成 `properties.style.color` |
| 背景节点没有弹窗 | `popups[]` 长度与点数不等 | 补齐或删除整个数组 |
| 控制台报 `times.length (...) !== coordinates.length` | 长度不匹配 | 每个点一个时间戳 |
| 节点弹窗不对 | `pointPopups` 长度不是点数 | 长度改为点数 |
| 面板导入后没反应 | 导入文本超过 `dataSourceImportMaxChars` | 减小数据量或调高上限 |
