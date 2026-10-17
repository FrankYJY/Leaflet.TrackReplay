<!-- canonical: 本文件；镜像：GUIDE.en.md；一致性检查：node _docs_check.mjs -->

# Python host 说明书

这份文档教你用一个 Python 服务作为 **host**：由它提供地图页面、插件资产与数据接口，Leaflet.TrackReplay 在页面里负责回放。参考实现就是本仓库的 demo（`examples/server.py` + `examples/templates/demo.html.jinja2`），本文把它拆成最小可复制的版本。

## 1. 什么是 Python host

插件不是独立应用：它附着在你建的 `L.Map` 上。**host / 插件分工**：

| 职责 | host（你的 Python 服务 + 页面） | 插件（Leaflet.TrackReplay） |
|---|---|---|
| 地图与容器 | 建 `L.Map`、给容器高度 | 不创建地图 |
| 底图 | 提供 tile layer / `baseLayers` | 不提供底图 |
| 数据 | 从数据库 / 文件 / 接口产出 GeoJSON | 解析、校验、拆段、按时间轴回放 |
| 选项 | 决定 `speed`、时区、语言等 | 消费选项 |
| 页面 UI | 设置面板、登录、业务按钮 | 播放条、时间轴、图层树、批量、搜索、数据源面板 |
| 节假日 | 抓取并注入 `calendar` | 只读表，不抓取 |
| 取景 | `setView` / `fitBounds` | 从不取景 |

Python host 有两种常见形态：

| 形态 | 数据怎么进页面 | 适合 |
|---|---|---|
| **A. 服务端渲染** | Jinja2 把 GeoJSON 直接注入 HTML | 固定数据集、首屏即用 |
| **B. 数据 API** | 页面 `fetch('/api/...')` 后 `replay.addDataset(fc)` | 动态数据、大数据、按需加载 |
| **C. 混合** | 首屏内嵌一份，之后增量拉取 | 常见生产形态 |

两种形态可以同时用：首屏内嵌保证秒开，后续刷新走 API。

## 2. 最小可运行 host

### 2.1 目录结构

```text
my-host/
├── app.py                 # FastAPI 服务
├── templates/
│   └── index.html         # 页面（Leaflet + 插件）
├── dist/                  # 插件构建产物
│   ├── leaflet-trackreplay.umd.js
│   └── leaflet-trackreplay.css
└── vendor/                # Leaflet（+ 可选插件）
    ├── leaflet.js
    ├── leaflet.css
    └── images/            # Leaflet 的图标资源
```

### 2.2 `app.py`

<!-- BEGIN PYAPP -->
```python
# A minimal Python host for Leaflet.TrackReplay.
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent
app = FastAPI()

# The plugin build and the vendored Leaflet live next to this file.
app.mount("/dist", StaticFiles(directory=ROOT / "dist"), name="dist")
app.mount("/vendor", StaticFiles(directory=ROOT / "vendor"), name="vendor")
templates = Jinja2Templates(directory=str(ROOT / "templates"))


def make_data():
    """Replace this with your real data source (DB, CSV, upstream API)."""
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [116.400, 39.900],
                    [116.410, 39.910],
                    [116.420, 39.920],
                ],
            },
            "properties": {
                "layerPath": ["demo", "track1"],
                "isTimestampedgeojson": True,
                "times": [1700000000000, 1700000060000, 1700000120000],
                "drawMovingIndicator": True,
            },
        }],
    }


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"data": make_data()},
    )


@app.get("/api/tracks")
async def api_tracks():
    # Same-origin data for runtime loading (pattern B).
    return JSONResponse(make_data())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
```
<!-- END PYAPP -->

### 2.3 `templates/index.html`

<!-- BEGIN PYTEMPLATE -->
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Python host</title>
  <link rel="stylesheet" href="/vendor/leaflet.css">
  <link rel="stylesheet" href="/dist/leaflet-trackreplay.css">
  <style>html, body, #map { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="map"></div>

  <script src="/vendor/leaflet.js"></script>
  <script src="/dist/leaflet-trackreplay.umd.js"></script>
  <script>
    var map = L.map('map').setView([39.91, 116.41], 14);   // [lat, lng]
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Jinja2's tojson escapes <, > and & — safe inside a <script> block.
    var replay = L.trackReplay(map, {{ data | tojson }}, { speed: 60 });
    replay.play();

    // Pattern B: load more data from the same origin at runtime.
    // fetch('/api/tracks')
    //   .then(function (r) { return r.json(); })
    //   .then(function (fc) { replay.addDataset(fc, { name: 'api' }); });
  </script>
</body>
</html>
```
<!-- END PYTEMPLATE -->

### 2.4 依赖与启动

```bash
pip install fastapi uvicorn jinja2
python app.py            # http://127.0.0.1:8000
# 或：uvicorn app:app --reload --port 8000
```

启动前确认 `dist/` 与 `vendor/` 已存在——`StaticFiles` 在目录缺失时会直接报错，这是有意的：早失败好过页面 404。

## 3. 插件与 Leaflet 资产从哪来

| 资产 | 来源 |
|---|---|
| 插件 JS/CSS | 在本仓库 `npm run build` 后复制 `dist/`；或 `npm install leaflet-trackreplay` 后取 `node_modules/leaflet-trackreplay/dist/` |
| Leaflet | `npm install leaflet` 后取 `node_modules/leaflet/dist/`；或本仓库的 `examples/vendor/` |
| 可选插件 | `leaflet.markercluster`（点聚合）、`L.Control.Layers.Tree`（层级图层树）；缺失时插件自动降级 |

两个原则：

1. **顺序固定**：Leaflet 先、插件后。插件要求执行时存在全局 `L`。
2. **本地化优于 CDN**：demo 把 Leaflet 放在 `/vendor`，页面运行时不依赖外部 CDN，只有底图瓦片需要网络。CDN 方案可用，但要把版本钉死。

开发时给 `/dist`、`/vendor` 和 `/` 加 `Cache-Control: no-store`（demo 的中间件就是这么做的），避免改完构建产物却看到旧 JS；生产环境反过来，静态资源加 hash 或长缓存。

## 4. 数据怎么从 Python 出来

数据形状的完整契约见 [HUMAN-USAGE 第 4 节](../HUMAN-USAGE.zh.md#4-数据格式速查)，这里只列 host 最容易写错的三点：

1. 坐标是 `[lng, lat]`；`setView` 是 `[lat, lng]`。
2. `times` 长度 = 坐标点数，**严格升序，毫秒**（单位只看第一个值：`> 1e12` 为毫秒）。
3. `speeds` / `styles` / `popups` 长度 = 点数 − 1；`pointPopups` = 点数；没有就省略，不要传 `[]`。

一个把数据库行转成轨迹的骨架：

```python
from datetime import datetime, timezone


def rows_to_track(rows, layer_path, name=None):
    """rows: iterable of (time, lng, lat); time may be datetime, s or ms."""
    rows = sorted(rows, key=lambda r: r[0])
    times, coords = [], []
    for t, lng, lat in rows:
        if isinstance(t, datetime):
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            ms = int(t.timestamp() * 1000)
        else:
            ms = int(t) if abs(t) > 1e12 else int(float(t) * 1000)
        times.append(ms)
        coords.append([float(lng), float(lat)])
    if len(coords) < 2:
        raise ValueError("a track needs at least 2 points")
    if any(times[i] >= times[i + 1] for i in range(len(times) - 1)):
        raise ValueError("timestamps must be strictly ascending")
    props = {
        "layerPath": layer_path,
        "isTimestampedgeojson": True,
        "times": times,
        "drawMovingIndicator": True,
    }
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": props,
    }
```

> 仓库里的 [`examples/convert.py`](../../examples/convert.py) 已经是这个逻辑的完整包装（`track` / `event` / `background_nodes` / `area` / `write_geojson`），可以直接复用。

**大数据不要内嵌**：几十万个点的 JSON 塞进 HTML 会让首屏变慢。走 API：

- `GET /api/tracks?bbox=...&since=...` 返回一个 `FeatureCollection`；
- 页面 `fetch` 后 `replay.addDataset(fc)`；
- 数据源面板的 URL 通道要求同源或 CORS——同源部署时直接用站内路径。

## 5. 运行时加载与刷新

```js
// Full replacement: add the new dataset first, then drop the old one.
var liveId = null;
function refresh() {
  fetch('/api/tracks').then(function (r) { return r.json(); }).then(function (fc) {
    var id = replay.addDataset(fc, { name: 'live' });
    if (liveId !== null) { replay.removeDataset(liveId); }
    liveId = id;
  });
}
setInterval(refresh, 60000);
```

要点：

- **先加后删**：顺序反过来，时间轴会短暂收缩，视图可能闪一下。
- 每次 `addDataset` 都是一份独立数据集；增量追加时记得定期清理旧 id，否则内存持续增长。
- 增删会重建图层，但**播放时刻、倍速、循环、逐元素显隐、标签、跟随、面板状态都会保留**。
- 新数据超出当前时间轴范围时，时间轴自动扩张。
- 同一 `layerPath` 跨数据集会合并；想整份替换就 `removeDataset(oldId)`。

## 6. 时区与节假日

Python host 的优势是可以**抓一次、所有客户端共用**。用标准库即可：

```python
import json
import urllib.request
from functools import lru_cache


@lru_cache(maxsize=8)
def holiday_table(year):
    """chinese-days yearly JSON, keyed by date in the display zone."""
    url = f"https://cdn.jsdelivr.net/npm/chinese-days/dist/years/{year}.json"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.load(r)
    except Exception:
        return None      # 404 = that year is not published yet
```

两种注入方式，二选一：

```python
# 1) 随页面下发
context = {"data": data, "calendar": holiday_table(2025)}
```

```js
// 2) 运行时注入（不重建）
fetch('/api/holidays?year=2025')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (t) { if (t) replay.setCalendar(t); });
```

注意事项：

- 键是**显示时区下的日期**（`YYYY-MM-DD`）；同一天既是节假日又是调休时，`workdays` 优先。
- `displayTimeZone` 默认是浏览器时区；由 host 统一时，把它写进选项（如 `'Asia/Shanghai'` 或 `8`）。
- `setCalendar()` / `setTimeZone()` 都是会话方法，不触发重建。
- 不要把年度 JSON 打进前端包；按年缓存即可。

## 7. 安全与运维

| 事项 | 做法 |
|---|---|
| 弹窗内容 | `popup` / `popups` / `pointPopups` 按 **HTML** 绑定。不可信文本先在 Python 里 `html.escape()`，不要直接拼进 HTML |
| JSON 注入 | Jinja2 用 `{{ data | tojson }}`（转义 `<`、`>`、`&`），不要用 `{{ data_json | safe }}` 处理不可信数据 |
| CORS | 页面与 API 同源时不需要；前后端分域部署时给 API 加 `CORSMiddleware`，并收紧 `allow_origins` |
| MIME | 直接提供 `.geojson` 文件时确认响应类型是 `application/geo+json`（或至少 `application/json`）；`StaticFiles` 在部分 Windows 环境会给出 `application/octet-stream` |
| 缓存 | 开发：`no-store`；生产：静态资源长缓存 + 内容 hash，HTML 短缓存 |
| 大响应 | 分页/增量接口，不要一次返回整库；服务端 gzip |
| 数据不可变 | 交给插件的 FeatureCollection 按引用持有；不要在插件使用期间原地修改同一对象 |

## 8. 与本仓库 demo 对照

| demo 里的部分 | 位置 | 归属 |
|---|---|---|
| 挂载 `/dist`、`/vendor` | `examples/server.py` | host |
| 数据注入 `data_json` | `examples/templates/demo.html.jinja2` | host |
| 设置面板（底图、时区、节假日状态） | demo 模板 | host UI |
| 节假日抓取与缓存 | demo 模板（浏览器端） | host（本文改成服务端抓取） |
| 数据源面板（数据集列表、导入） | `showDataSource: true` | 插件 |
| 多命中搜索 | `showSearch: true` | 插件 |
| 播放条、时间轴、图层树、批量、标签 | 插件默认控件 | 插件 |
| 开发期 no-cache 中间件 | `examples/server.py` | host（开发便利） |
| 示例数据生成 | `examples/server.py` | host |

## 9. 检查清单与排错

上线前逐条核对：

- [ ] `/vendor/leaflet.js` 在 `/dist/leaflet-trackreplay.umd.js` **之前**加载。
- [ ] 插件 CSS 已加载，`#map` 有显式高度。
- [ ] 数据里 `times` 与坐标等长、升序、毫秒；`layerPath` 是数组。
- [ ] 页面首屏能看到底图与轨迹，播放条可用。
- [ ] API 返回 JSON 且同源可访问；CORS 只在分域时需要。
- [ ] 不可信文本已转义；`tojson` 而不是 `safe`。
- [ ] 生产环境静态资源缓存策略已配置。

| 症状 | 原因 | 修法 |
|---|---|---|
| 启动即报目录不存在 | `dist/` 或 `vendor/` 缺失 | 构建/复制资产，或改成可选挂载 |
| 页面 404 `/dist/...` | 挂载路径或文件名不对 | 检查 `app.mount` 与 HTML 里的 `src` |
| `L is not defined` | Leaflet 未加载或顺序反了 | Leaflet 先、插件后 |
| 地图空白 / 一条灰条 | 容器没高度、CSS 没加载 | 补高度，加载插件 CSS |
| 轨迹不显示 | 不是 `LineString`，或 `times` 长度不对 | 看控制台 `times.length` 报错，补齐长度 |
| 点跑到海里 | 坐标写成 `[lat, lng]` | 改成 `[lng, lat]` |
| 播放立刻结束 | `times` 未升序，或秒/毫秒判错 | 升序；统一毫秒 |
| 刷新后轨迹翻倍 | 只 `addDataset` 没删旧的 | 记录 id，先加后删 |
| 直接打开 `.geojson` 变成下载 | MIME 不对 | 设 `application/geo+json` |
| 数据源面板 URL 导入失败 | 跨域或无 CORS | 同源部署，或给 API 加 CORS |
