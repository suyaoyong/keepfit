# 本次需求讨论与预审查汇总

日期：2026-01-30
范围：囚徒健身小程序（含登录、排期、推荐计划、训练方法维护）

---

## 一、需求讨论要点（决策结论）

1) 推荐计划（第十二章）
- 五个计划：初试身手 / 渐入佳境 / 炉火纯青 / 闭关修炼 / 登峰造极
- 周频与范围：
  - 初试身手：每周 2 次，四艺（俯卧撑、举腿、引体向上、深蹲）
  - 渐入佳境：每周 3 次，六艺
  - 炉火纯青：每周 6 次，六艺
  - 闭关修炼：每周 6 次，六艺，每动作 3–5 组
  - 登峰造极：每周 6 次，六艺，每动作 10–50 组（耐力导向）
- 当天动作分配：按周次数与四艺/六艺“自动均分到训练日”。

2) 进阶门槛
- 初试身手 → 渐入佳境：四艺均达到第六式。

3) 今日训练规则
- 今日训练必须基于计划自动生成目标。

4) 当周排期调整
- 当周可调换训练日、增删动作/目标。
- 默认仅影响当周排期，不回写长期计划模板。

5) 非计划日训练处理
- 训练日记可以影响进度。
- 若非计划日训练，提示是否交换本周排期。
- 用户拒绝交换：计入进度但排期不变。

6) 训练方法与动作等级
- 动作级别名称与练习方法必须展示。
- 训练方法后续可维护，采用云端版本化。

7) AI 解析接口
- 保留训练记录 AI 解析接口，解析原始文本并填入训练字段。
- 解析失败需兜底为手动填写。

8) 编码要求
- 中文统一 UTF-8。

---

## 二、方法资料整理与维护

- method.md 已转为 UTF-8 并补全全部内容。
- 生成结构化数据：methods-data.json（v1.0.0 / 2026-01-30）。
- 维护策略：method.md → methods-data.json → 云端 methods 集合。
- 版本字段保留以便回滚。

---

## 三、推荐计划规则维护

- 规则文件：plan-rules.md（v1.0.0 / 2026-01-30）。
- 结构化数据：plan-rules.json。
- 维护策略：plan-rules.md → plan-rules.json → 云端 plan_rules 集合。
- 推荐计划生成读取版本化规则。

---

## 四、tasks 审查与优化（两轮）

### 第 1 轮审查结论
- 增补：云端导入 methods 与 plan_rules。
- 增补：排期交换接口服务端任务。
- 明确：AI 解析失败兜底。

### 第 2 轮优化（已落实到 tasks.md）
- 合并文档类任务：生成文件 + 文档对齐。
- 新增：导入 methods / plan_rules 集合任务。
- 新增：排期交换接口任务（服务端）。
- 新增：AI 解析置信度提示与确认流程。
- 总任务数更新为 50。

---

## 五、预审查（改代码前）

### 1) 需求一致性
- Spec → Tasks 覆盖完整，未发现关键需求缺口。

### 2) 数据模型/集合对齐
- db-schema.md 已补齐集合：auth / plan_rules / methods / schedules / diaries 等。
- 索引建议更新：workouts(openid+date+exerciseId)、schedules(openid+date)、diaries(openid+date)、plan_rules(version)、methods(version) 等。

### 3) 关键流程纸面演练
- 首次登录 → 创建计划 → 排期 → 今日训练 → 进度更新。
- 非计划日训练 → 提示交换排期 → 当周更新。
- 重置计划 → 旧计划停用 → 新计划创建。

### 4) 规则一致性审查
- plan-rules 与 method.md 无冲突。
- 组数范围只影响推荐训练量，升级判断以 method.md 为准。

### 5) AI 解析契约草案
- 已写入 contracts/api.yaml（/workout/parse）。
- 包含 rawText + confidence + 失败兜底。

### 6) 文案编码审查
- 规范要求：UTF-8。
- 后续统一文案处理任务保留。

---

## 六、当前阶段输出文件清单

- specs/1-prison-bodyweight-plan/spec.md
- specs/1-prison-bodyweight-plan/tasks.md
- specs/1-prison-bodyweight-plan/plan.md
- specs/1-prison-bodyweight-plan/research.md
- specs/1-prison-bodyweight-plan/plan-rules.md
- specs/1-prison-bodyweight-plan/plan-rules.json
- specs/1-prison-bodyweight-plan/plan-rules-maintenance.md
- specs/1-prison-bodyweight-plan/methods-schema.md
- specs/1-prison-bodyweight-plan/methods-maintenance.md
- specs/1-prison-bodyweight-plan/methods-data.json
- miniprogram/services/db-schema.md
- method.md

---

## 七、状态说明

- 已开始代码阶段：完成 T001–T004（入场/登录页占位 + app.json 注册）。
- 后续代码实现严格按 tasks.md 推进。

