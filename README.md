# KeepFit 囚徒健身训练计划小程序

面向《囚徒健身》训练体系的计划生成与进度跟踪小程序，支持自建计划与推荐计划、按周/月/日历排期、今日训练自动生成、六大动作进度展示与训练日记。

## 主要功能
- 入场/登录：微信授权获取基础信息并建立训练档案
- 计划设置：基础信息 + 起始等级 + 排期（周 / 月 / 日历）
- 推荐计划：按《囚徒健身》第十二章五个计划规则生成
- 今日训练：基于计划自动生成目标，支持记录训练数据
- 进度追踪：六大动作阶段列表展示
- 训练日记：临时加练记录并影响进度
- 训练方法：按动作与级别展示训练方法与升级标准（云端可维护）
- AI 解析入口：训练描述解析占位接口

## 环境要求
- 微信开发者工具（云开发环境已开通）
- Node.js / 云函数依赖由微信开发者工具安装

## 快速开始
1. 使用微信开发者工具打开项目
2. 确认云开发环境 ID（`miniprogram/app.js` 或项目设置中）
3. 部署云函数（右键云函数目录 → 上传并部署）
   - auth / plan / schedule / workout / progress / recommendation / diary / method / ai-parse / profile
4. 创建数据库集合与索引（见 `miniprogram/services/db-schema.md`）
5. 导入维护数据
   - methods：导入 `specs/1-prison-bodyweight-plan/methods-flat.compact.json`
   - plan_rules：导入 `specs/1-prison-bodyweight-plan/plan-rules.compact.json`
6. 预览运行
   - 入场 → 登录 → 计划设置 → 今日训练 → 进度

## 数据维护
- 动作方法与升级标准
  - 源文件：`method.md`
  - 结构化：`specs/1-prison-bodyweight-plan/methods-data.json`
  - 导入文件：`specs/1-prison-bodyweight-plan/methods-flat.compact.json` / `.csv`
- 推荐计划规则
  - 源文件：`specs/1-prison-bodyweight-plan/plan-rules.md`
  - 导入文件：`specs/1-prison-bodyweight-plan/plan-rules.compact.json` / `.csv`

## 项目结构
- `miniprogram/` 小程序前端
- `cloudfunctions/` 云函数
- `specs/` 规格与任务清单

## 重要说明
- 今日训练自动生成依赖排期与计划
- 训练日记会写入进度
- 非计划日训练可提示交换当周排期
- 计划重置会停用旧计划并清理本地缓存

