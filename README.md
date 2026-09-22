# FlyConnectome —— 果蝇连接组 × 行为仿真（L0–L3）

从真实神经元形态出发，逐级搭建果蝇行为仿真：L0 神经元可视化 → L1 回路脉冲仿真 →
L2 连接组约束网络 × 环境闭环 → L3 具身神经力学仿真（NeuroMechFly v2 / MuJoCo）。
全部离线可跑，零鉴权。

## 目录结构

- `.venv/` —— L0–L2 环境（Python 3.9 + navis 1.10，约 412 MB）
- `.venv-l3/` —— L3 环境（Python 3.12 + flygym 2.0.1 + MuJoCo 3.6，约 460 MB）
- `demo_neuron.py` —— L0：加载神经元 → 突触连接器 → 网络分析 → 3 张图
- `neurons_3d.png` / `roi_synapse_network.png` / `neuron_2d_projection.png` —— L0 输出
- `fly_l1_sim.html` —— L1：嗅觉回路（OR→PN→LN→KC）脉冲仿真，单文件离线网页
- `fly_l2_sim.html` —— L2：连接组约束网络 + 中央复合体（CX）环形吸引子航向，
  三种环境（觅食/T 迷宫/视觉）可切换，单文件离线网页
- `nmf_ctrl/` —— 移植自 NeuroMechFly v2 官方参考实现（flygym v2.1.0
  `flygym_demo/complex_terrain/`，Apache-2.0）并适配 flygym 2.0.1 + MuJoCo 3.6 的
  运动控制栈：三脚架 CPG、真实绑缚行走录音提取的预编程单腿步态、转向控制器、
  CX 环形吸引子航向积分器（`cx_heading.py`）
- `l3_walk.py` —— L3a：CPG 直线行走 → `l3_walk_side.mp4`
- `l3_closedloop.py` —— L3b：具身闭环导航（CX 航向估计 → 下行信号 → CPG 转向）
  → `l3_steer_top.mp4` + `l3_traj.png`
- `l3_walk_side.mp4` / `l3_steer_top.mp4` / `l3_traj.png` —— L3 输出

## 运行

### L3 可视化工作台（新增）

双击项目里的 **`start_l3.command`**，浏览器会打开 **http://127.0.0.1:8873**。
启动后需等待身体构建与转向标定；完成后点击「开始运行」。关闭启动终端或按 Ctrl+C 可停止服务。
重复双击会打开已经运行的工作台。

也可从项目目录启动：

```bash
./start_l3.command
# 不自动打开浏览器：
.conda-web/bin/python -m l3_workbench.server --port 8873
```

使用方式：

1. 在左侧选择预设，调整出生位置／朝向、地面摩擦、粘附强度、时长与种子；点击「重置场景」应用。
2. 在目标地图拖动目标点，或点击空白处添加；也可直接输入坐标、删除目标。支持 1–8 个目标，坐标单位 mm。
3. 开始／暂停／步进 0.1 秒。自主导航会依次经过目标；手动模式可分别设置左右信号或点击前进、转向、归零。
4. 运行中可改变行走强度、转向增益、罗盘噪声与遮挡。参数在下一控制周期生效。
5. 查看真实 MuJoCo 画面、轨迹、速度、目标距离、真实／估计航向、16 单元 CX 活动、六腿实际接触及粘附指令。
6. 「保存配置」下载 JSON；「导入配置」载入后点击重置。暂停或实验完成后点击「导出本次实验」，再下载结果包。

结果保存在 `outputs/l3-workbench/<实验编号>/`：

- `experiment.zip`：下载结果包，包含下面四项。
- `simulation.mp4`：25 fps 视频，每 0.04 秒仿真记录一帧，按仿真时间播放；切换视角会影响之后记录的画面。
- `telemetry.csv`：每 0.01 秒控制周期的反馈数据；`speed_mm_s` 为平滑后的平面速度，`error_deg` 为估计航向减真实航向后环绕至 ±180°。
- `experiment.json`：初始／最终参数、随机种子、转向标定值、时间步与依赖版本。
- `events.jsonl`：暂停、启动、参数调整及视角变更的仿真时间记录。

每次重置创建新目录，不覆盖旧实验。实验最长 60 秒，原始 JPEG 帧也保留在各实验的 `frames/` 目录；长期使用可自行清理不再需要的实验目录。
多个浏览器页面共享同一个实验。

**模型边界：** 第一版只有平地；摩擦和粘附参数接入真实物理计算。罗盘由真实体姿加噪声生成，尚未读取复眼图像；导航位置使用仿真真值。未加入坡面、障碍、风或气味模型。改变物理参数可能降低步态稳定性，标定失败时可恢复默认预设。
计算通常慢于真实时间，页面同时显示仿真时间、累计计算耗时和速度倍率。初次标定与暂停时间不计入运行速度。

工作台代码在 `l3_workbench/`：`server.py` 提供本机 HTTP 服务并管理子进程；`worker.py` 在独立进程主线程运行物理及 GLFW 渲染；`config.py` 校验参数；`static/` 是无外部依赖的网页。
旧 L3 脚本及其环境保持兼容。

网页服务使用 conda 创建的 `.conda-web`（Python 标准库，无额外 Web 包）；物理进程复用 `.venv-l3`。在新机器上创建网页环境：

```bash
conda env create --prefix .conda-web -f environment-web.yml
# 如物理依赖安装在其他环境，指定它的 Python：
.conda-web/bin/python -m l3_workbench.server --port 8873 --worker-python /path/to/physics/python
```

测试：

```bash
.conda-web/bin/python -m unittest discover -s tests -v
L3_INTEGRATION=1 .conda-web/bin/python -m unittest discover -s tests -v
node --check l3_workbench/static/app.js
node --test tests/test_sync.cjs
```

第二条会实际初始化、步进、暂停、干预、导出视频，并验证相同种子的重置复现，需要可用的 GLFW 图形环境；测试实验同样保存在输出目录。

### 原有演示脚本

```bash
cd /Users/nick/Desktop/workProject/FlyConnectome
.venv/bin/python demo_neuron.py                 # L0
open fly_l1_sim.html fly_l2_sim.html            # L1 / L2（浏览器直接打开）
MUJOCO_GL=glfw ./.venv-l3/bin/python l3_walk.py         # L3a 直线行走（约 1 分钟）
MUJOCO_GL=glfw ./.venv-l3/bin/python l3_closedloop.py   # L3b 闭环导航（约 4 分钟）
```

## L3 架构速记

具身闭环 = 身体（MuJoCo 物理）→ 感觉（体姿四元数 + 复眼罗盘）→ 中枢（CX 环形
吸引子航向估计 + 目标航向比较）→ 下行信号 `[左, 右]` → 脊髓（三脚架 CPG + 预编程
步态 + 足底粘附门控）→ 42 个腿关节位置执行器。

- 转向机制与 v2 参考一致：`[左, 右]` 下行信号分别调制两侧 CPG 的振幅（步幅）与
  频率符号（前进/后退），差动即转向；增益由 0.6 s 开环探针自动标定。
- CX 航向积分：自运动通道按 `dψ = ω·dt` **精确平移**活动包（粗环上用不对称输入
  "推"包会被步态摆动整流成棘轮漂移）；罗盘通道用 von Mises 线索平滑锚定包。
  罗盘遮挡 1 s 期间纯自运动积分，恢复后重新锚定。
- 控制周期 10 ms（CX/下行），物理 0.1 ms；角速度输入经 120 ms 低通滤除 7.4 Hz
  步态摆头。

## 本机坑位（macOS x64）

- 离屏渲染必须 `MUJOCO_GL=glfw`（osmesa/egl 在此 MuJoCo 3.6 构建上无效）。
- MuJoCo 相机沿自身 −Z 看：顶视 = 单位旋转，`euler(-π/2,0,0)` 会平视地平线。
- 粘附执行器 `ctrlrange=[1,100]`：布尔 "关"(0) 被钳到 1 → 脚永远粘地；编译后需
  `mj_model.actuator_ctrlrange[adh_ids, 0] = 0.0`，摆动相写真 0 才能迈腿。
- MuJoCo 3.6 的 `MjsJoint.stiffness/damping` 是标量（3.7 才变成多项式数组）。
- flygym 2.0.1 没有 `NeuroMechFly` 别名，用 `Fly`。

## 关于真实 FlyWire 数据

本目录的示例神经元是 navis 自带的真实 FAFB 果蝇神经元（如 DA1_lPN_R），离线即可用。
要拉取 **FlyWire 全脑连接组**（16.6 万神经元 / 1.25 亿突触）需要：

1. 在 flywire.org 注册并获取 API token（当前网络下该门户连不通，需换网络或配代理）
2. 安装 `cloudvolume` / `fafbseg`，通过 GCS + CAVE 接口按神经元 ID 按需取数（不要全量下载，TB 级）

## 清理 / 回收空间

- 删除 L3 环境：`rm -rf .venv-l3`（约回收 460 MB）
- 删除 L0–L2 环境：`rm -rf .venv`（约回收 412 MB）
- 清理 pip 缓存：`.venv/bin/pip cache purge`

### 图片二选一奖励学习

启动工作台后，点击页头「图片奖励学习」，或访问 <http://127.0.0.1:8873/learning.html>。

1. 页面先用 200 张留出图片记录训练前成绩。点击「训练 1 轮」观察选图、概率和奖励，或点击「连续训练 600 轮」快速积累经验。
2. 点击「测试 200 张留出图片」，比较训练前后成绩。测试冻结参数，使用固定的独立随机流，不消耗训练数据或更新策略。
3. 点击「新建 L3 演示」，用冻结的策略识别一张新图，驱动果蝇走到所选区域。它会重置共享 L3 实验；期间可暂停、继续、结束。识别正确与实际到达分别记录，物理失败不会改变识别奖励。
4. 用「导出完整记录」保存 JSON（模型权重、随机状态、逐轮训练、测试混淆矩阵和演示轨迹），或导出训练 CSV。CSV 类别编号 0=圆形、1=三角形，`probability_triangle` 为更新前的三角形选择概率。刷新或「重新开始」会清空当前页面记录；先导出再离开。

此场景只支持自动生成的圆形和三角形，不支持任意照片上传或数字识别。32×32 像素经前景裁剪和 8×8 占用率编码去除位置、尺度与颜色差异，再输入两动作策略；训练仅根据所选动作的奖励（正确 1、错误 0）进行策略梯度更新，学习率 0.12、奖励基线 0.5。答案不进入编码器或策略。该模块是简化奖励学习示范，不是对真实果蝇连接组学习或复眼视觉的复现。留出集成绩仅适用于这类生成图形。

快速训练在浏览器运行，每个页面有独立学习状态；同种子可重复，最多 10000 轮。L3 身体仍由原控制器驱动，仿真时间最多 10 秒，实际计算可能需要几分钟。学习页通过实验编号保护控制请求，避免过期操作干扰其他页面的新实验。

学习模块测试：`node --test tests/test_learning*.cjs tests/test_sync.cjs`。

### 池塘 3D 场景（新增）

启动工作台后，点击页头「池塘 3D 场景」，或访问 <http://127.0.0.1:8873/pond.html>。

一个基于 Three.js 的具身交互沙盒：中央荷叶上坐着一只青蛙，周围有多只果蝇在空中飞。全部物理与行为都在浏览器里运行，不依赖 MuJoCo worker。可以观察到的现象：

1. **青蛙状态机**：`IDLE → LOCK（0.3s 反应延迟）→ STRIKE（弹舌）→ RETRACT → CHEW`。眼球实时追踪视野内的果蝇；只有当目标进入舌头射程才会发起攻击。饥饿周期决定主动捕猎频率。
2. **果蝇 Giant Fiber 逃逸**：真实果蝇的尾须感受器检测到接近的捕食者时会触发全或无的爆发跳跃。本场景用同样逻辑：舌头尖端进入触发半径时按概率瞬间获得一个向上偏置的爆发速度，之后 1s 冷却。
3. **水面 Shader**：顶点位移 + Fresnel + 镜面高光。舌头落水、果蝇落水、用户点击水面都会传播涟漪；最多 20 个涟漪以环形缓冲存储，自动衰减回收。
4. **落水与恢复**：果蝇 y < 0.03 时进入 `drowning`，翅膀快速抖动但位置锁定；青蛙仍可扫食水面个体；4 秒未被吃掉则自动 `removed`，主循环按 `flyCount` 补一只新的。
5. **交互**：左键点击果蝇 = 触发一次强制逃逸；左键点击水面 = 涟漪；拖拽 = 环绕相机；滚轮 = 缩放。右下角状态栏实时显示 已捕获 / 存活 / 落水 / FPS。
6. **参数面板**（右侧，即时生效）：
   - 物理：重力、风速 x/y/z
   - 青蛙：反应延迟、舌头速度、舌头射程、饥饿周期、捕猎视野
   - 果蝇：数量（1–20）、漫游速度、逃逸触发概率、逃逸爆发力、触发半径
   - 视角：环绕 / 俯视 / 侧视 / 青蛙视角

实现文件：`l3_workbench/static/pond.{html,css,js}` + `pond-behavior.js`（状态机与建模） + `pond-water.js`（水面 Shader）；Three.js r162 与 OrbitControls 以 ES module 形式 vendor 在 `static/vendor/`，无需 CDN。服务器路由 `l3_workbench/server.py` 已改为通用 `static/` 映射 + 扩展名白名单 + 路径穿越防护，`/api/*` 分支优先命中。

池塘测试：`./.conda-web/bin/python -m unittest tests.test_http.HTTPTests.test_pond_resources_are_available tests.test_http.HTTPTests.test_static_directory_traversal_blocked -v`。

### 神经元验证扩展（环境→行为回路）

在上面沙盒基础上新增两套逐帧计算的神经元模型，可直接在参数面板里对任一层做消融，观察行为变化。代码入口：`l3_workbench/static/pond-neuron.js`、`pond-odor.js`、`pond-inspector.js`。

1. **L1 嗅觉链路**（ORN → PN → LN → KC）。岸边放一颗腐烂水果，高斯羽流 + 阵风调制；每只果蝇持一个 `OdorCircuit`，四级递推后得到二值 `fire`。fire=1 时向源心施加 `k_odor` 拉力。三个开关：
   - `OR 通道`：关掉后果蝇完全忽略水果
   - `ORN 适应`：关掉后 KC 在稳态气味下持续发放，果蝇死死贴住水果不放
   - `LN 侧抑制`：关掉后 `g_ln=0`，弱背景气味就能推到 KC 阈值，全场果蝇不约而同飞向水果
2. **Giant Fiber 逃逸 LIF**。`dV/dt = sensI − (V − 0)/τ − AHP`，spike 后复位 + 冷却；感觉电流 `sensI` 与舌头尖端距离成反比。两个开关：
   - `GF LIF`：关掉后回退到旧版“距离 + 概率”逃逸，方便对照
   - `致敏/习惯化`：同伴被吃→附近果蝇 θ 下降 8s，同样小刺激就能触发逃逸；自动无害扰动（每 8–16s）或手动“扔落叶”→ subthreshold 刺激累积习惯化，θ 逐次抬高，果蝇逐渐对扰动无反应
3. **神经元检视器**。左键点任意果蝇→底部浮层开启，展示两幅 10s 窗口 sparkline：嗅觉四级曲线 + GF V/θ/AHP 曲线（spike 时刻画红竖线）；右侧数字列实时显示浓度、四级发放、上次 spike 距今。右上角 “下一只” 按钮可逐个切换观察对象；当当前 fly 被吃时自动关闭。

**验证清单**（建议逐个开关看行为反差）：
- 默认参数下，观察果蝇先飞向水果→KC 发放时“专注”、不发放时漫游
- 关闭 `ORN 适应`，30s 后观察所有到达水果的果蝇不再离开
- 关闭 `LN 侧抑制`，观察远离水果的果蝇也开始“无端”集合→ KC 失去稀疏化
- 关闭 `GF LIF` vs 打开，对比“同样青蛙攻击”下的逃逸驯本应一致 → 旧版会每次同统计概率；新版会先 spike，后 AHP 抑制→同距离下后面几次逃逸延迟
- 关闭 `致敏/习惯化`，同一只果蝇对同伴被吃无反应；打开后观察第一次捕食后周围个体“惊弓之鸟”→ 射舌头还没到位就开始逃
- 手动“扔落叶”× 6 次，开启检视器观察某只未被吃的果蝇 θ 逐步上捧→后期即使落叶也不会触发 spike（习惯化）

**行为边界**：这是可视化交互沙盒，果蝇飞行不是气动力学仿真；青蛙视觉是球形范围检测，不模拟真实复眼；果蝇数量与青蛙体型不成比例（视觉需要）。神经元模型采用 L1/LIF 简化，只展示“消融→行为变化”的映射，不追求生物学定量拟合。目的是让「感知 → 神经元计算 → 决策 → 行为」四段闭环可视化、可干预。
