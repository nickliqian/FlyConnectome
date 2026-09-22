# 图片二选一奖励学习 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐项完成。

**Goal:** 可实际训练、独立评估并驱动 L3 果蝇选择的图片实验。
**Architecture:** 独立纯 JS 像素生成及奖励学习模块、页面交互模块、复用现有物理 HTTP API。服务仅增加静态白名单。
**Tech Stack:** 原生 JavaScript、Canvas、Node 内置测试、现有 conda Python HTTP 服务。
**Spec:** docs/superpowers/specs/2026-09-17-visual-learning.md

## Global Constraints
- 中文界面；无新增依赖；原有导航工作台保持可用。
- 训练奖励正确 +1、错误 0；学习器不能接收标签；测试不更新参数。
- 训练、测试、演示随机流分离；测试报告样本数量；不承诺任意图片泛化。
- L3 继续使用真实物理，识别与到达分开；无 Git 仓库，仅提供提交建议。

### Task 1: 像素与奖励学习
Files: `static/learning-core.js`, `tests/test_learning.cjs`。
Interface: `LearningSession(seed)`, `step()`, `evaluate(count)`, `preview()`, `snapshot()`；`encode(pixels)`只读位图。
- [ ] 写测试：奖励后已选动作概率增加、零奖励后下降；同种子相同历史；测试前后 snapshot 严格相等；留出图片上训练后优于初始；图形位置与尺度变化及两动作覆盖。
- [ ] `node --test tests/test_learning.cjs`，确认新增模块缺失导致失败。
- [ ] 实现像素生成、裁剪降采样、softmax 两动作策略梯度与种子随机流。学习更新 `w += lr * (reward - 0.5) * (action - p) * features`。
- [ ] 同一命令验证通过，并用多个种子检查留出集结果。

### Task 2: 页面与 L3 接入
Files: `static/learning.html`, `static/learning.css`, `static/learning.js`, `server.py`, `static/index.html`, `tests/test_http.py`。
- [ ] 增加 HTTP 测试，对四个学习静态资源验证 200，并保留目录穿越拒绝测试。
- [ ] 实现白名单并验证 HTTP 测试。
- [ ] 页面提供训练 1／100／600 轮、停止、种子重置、测试 200 张、导出、当前位图／选择反馈、曲线和记录。
- [ ] 复用 `/api/state` 和 `/api/command`，演示使用冻结选择重置目标、等待 ack 再启动。记录 run_id、处理到达／结束／错误／外部重置，暂停继续，明确共享实验重置提示。
- [ ] 浏览器实际操作训练、测试、导出、重置及真实 L3 演示；检查窄屏。

### Task 3: 验证与交付
Files: `README.md`, `docs/l3-workbench-verification.md`。
- [ ] 执行全部 Node 和 Python 测试、语法检查；检查模型测试无标签泄漏。
- [ ] 记录验证结果、运行边界、启动入口，保留本地服务并打开学习页。
- [ ] 提供 Conventional Commit 建议，不创建 Git 仓库或提交。
